/**
 * Renderer process — bootstrap and orchestration.
 * Initializes DI Container, EventBus, StateStore, and all UI components.
 * All component communication goes through EventBus; state lives in StateStore.
 */
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import './styles.css'
import './components/base/context-menu/context-menu.css'
import './components/base/button/button.css'
import { FileTree } from './file-tree.js'
import { TabBar } from './tab-bar.js'
import { THEMES } from './themes.js'
import { SettingsPage, SUPPORTED_AGENTS } from './settings-page.js'
import { StatusBar } from './status-bar.js'
import { GitPanel } from './git-panel.js'
import { EditorPanel } from './editor-panel.js'
import { ProjectSearchDialog } from './project-search.js'
import { NodeVersionDialog } from './node-version-dialog.js'
import { Icons } from './icons.js'
import { TERMINAL_CONFIG } from './core/config/terminal-config.js'
import { APP_CONFIG } from './core/config/app-config.js'
import { TerminalKeyboardHandler } from './features/terminal/terminal-keyboard-handler.js'
import { TerminalOscHandler } from './features/terminal/terminal-osc-handler.js'
import { TerminalScrollButton } from './features/terminal/terminal-scroll-button.js'
import { EventBus } from './core/event-bus.js'
import { StateStore } from './core/state-store.js'
import { ElectronApiAdapter } from './core/adapters/electron-api.js'
import { AppContainer } from './core/container.js'
import { diagnostics } from './core/diagnostics.js'
import { GitStatusService } from './services/git-status-service.js'

let currentThemeName = 'dark'
let loadedThemes = THEMES
/** @type {TabBar|null} */
let tabBar = null
/** @type {EditorPanel|null} */
let editorPanel = null
/** @type {StateStore|null} */
let appStore = null
/** @type {ResizeObserver|null} */
let resizeObserver = null
let resizeDebounceTimer = null
let newTabPlacement = 'modifierAdjacent'

/** Применяет стиль индикатора фокуса через data-атрибут на корневом элементе. */
function applyFocusIndicator(style) {
  appStore?.set('ui.focusIndicator', style || 'none')
}

/** Применяет размер статусбара через data-атрибут. */
function applyStatusBarSize(size) {
  appStore?.set('ui.statusBarSize', size || 'compact')
}

/** Применяет тему: обновляет CSS-переменные, терминалы и редактор. */
function applyTheme(themeName) {
  appStore?.set('ui.theme', themeName)
}

/** Создаёт новую вкладку: Terminal + FitAddon + PTY-сессия. */
async function createTab(api, cwd, tabId) {
  const term = new Terminal({
    cursorBlink: TERMINAL_CONFIG.CURSOR_BLINK,
    fontSize: TERMINAL_CONFIG.FONT_SIZE,
    fontFamily: TERMINAL_CONFIG.FONT_FAMILY,
    scrollback: TERMINAL_CONFIG.SCROLLBACK,
    allowProposedApi: TERMINAL_CONFIG.ALLOW_PROPOSED_API,
    theme: loadedThemes[currentThemeName].terminal,
  })

  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.loadAddon(new WebLinksAddon())
  term.loadAddon(new SearchAddon())

  tabId = tabId || crypto.randomUUID()
  const { config } = await api.settingsLoad()
  const promptStyle = config.terminal?.promptStyle || 'default'
  const { pid } = await api.ptyCreate({
    cols: TERMINAL_CONFIG.DEFAULT_COLS,
    rows: TERMINAL_CONFIG.DEFAULT_ROWS,
    cwd,
    tabId,
    promptStyle,
  })

  return { term, fitAddon, pid, rootPath: cwd, tabId }
}

async function init() {
  const api = new ElectronApiAdapter()

  // Загружаем настройки до инициализации всего остального
  const { config, themes, warnings } = await api.settingsLoad()
  loadedThemes = { ...THEMES, ...themes }
  newTabPlacement = config.terminal?.newTabPlacement || 'modifierAdjacent'
  if (warnings && warnings.length > 0) {
    console.warn('Settings warnings:', ...warnings)
  }
  if (!config.agents) config.agents = {}
  if (typeof config.agents.proxy !== 'string') config.agents.proxy = ''
  if (typeof config.agents.proxyEnabled !== 'boolean') config.agents.proxyEnabled = false
  if (!config.agents.keyboardModes || typeof config.agents.keyboardModes !== 'object') config.agents.keyboardModes = {}
  for (const agent of SUPPORTED_AGENTS) {
    if (!(agent.id in config.agents.keyboardModes)) {
      config.agents.keyboardModes[agent.id] = (agent.id === 'qwen' || agent.id === 'agento') ? 'ctrl-j' : 'kitty'
    }
  }
  for (const agent of config.agents?.custom || []) {
    if (agent?.id && !(agent.id in config.agents.keyboardModes)) {
      config.agents.keyboardModes[agent.id] = 'kitty'
    }
  }

  // Initialize store with current settings
  appStore = new StateStore({
    ui: {
      theme: config.appearance.theme || 'dark',
      focusIndicator: config.appearance.focusIndicator || 'none',
      statusBarSize: config.appearance.statusBarSize || 'compact',
      sidebarVisible: true,
      editorVisible: false,
      gitPanelVisible: false,
    },
    settings: {
      collapseChildrenOnClose: config.fileTree?.collapseChildrenOnClose ?? true,
      fileOpenMode: config.fileTree?.fileOpenMode || 'double',
    },
    terminal: {
      newTabPlacement: config.terminal?.newTabPlacement || 'modifierAdjacent',
    },
    agents: {
      keyboardModes: config.agents?.keyboardModes || {},
      forceDisabled: config.agents?.forceDisabled || {},
      custom: config.agents?.custom || [],
      proxy: config.agents?.proxy || '',
      proxyEnabled: config.agents?.proxyEnabled ?? false,
    },
    quickReplies: {
      items: config.quickReplies?.items || [],
    },
    git: {
      isRepo: false,
      rootPath: null,
      fileStatuses: {},
      ignoredTracked: new Set(),
      ignoredPaths: [],
    }
  })

  // Expose for debugging (remove before production if desired)
  window.__appStore = appStore

  const bus = new EventBus()
  window.__eventBus = bus

  // Theme subscriber — applies CSS variables, updates terminals and editor
  appStore.subscribe((state, path) => {
    if (path === 'ui.theme') {
      const themeName = state.ui.theme
      const theme = loadedThemes[themeName]
      if (!theme) return
      currentThemeName = themeName

      const root = document.documentElement.style
      root.setProperty('--bg', theme.ui.bg)
      root.setProperty('--surface', theme.ui.surface)
      root.setProperty('--border', theme.ui.border)
      root.setProperty('--muted', theme.ui.muted)
      root.setProperty('--text', theme.ui.text)
      root.setProperty('--subtext', theme.ui.subtext)
      root.setProperty('--accent', theme.ui.accent)
      root.setProperty('--green', theme.ui.green)
      root.setProperty('--red', theme.ui.red)
      root.setProperty('--hover', theme.ui.hover)

      // Обновить уже открытые терминалы
      if (tabBar) {
        for (const tab of tabBar.tabs) {
          tab.term.options.theme = theme.terminal
        }
      }

      // Обновить тему редактора
      if (editorPanel && theme.editor) {
        editorPanel.setTheme(theme.editor)
      }
    }
  })

  // Focus indicator subscriber
  appStore.subscribe((state, path) => {
    if (path === 'ui.focusIndicator') {
      document.documentElement.dataset.focusStyle = state.ui.focusIndicator || 'none'
    }
  })

  // Status bar size subscriber
  appStore.subscribe((state, path) => {
    if (path === 'ui.statusBarSize') {
      const statusBar = document.getElementById('status-bar')
      if (statusBar) {
        statusBar.dataset.size = state.ui.statusBarSize || 'compact'
      }
    }
  })

  applyTheme(config.appearance.theme)
  applyFocusIndicator(config.appearance.focusIndicator)
  applyStatusBarSize(config.appearance.statusBarSize)

  const terminalContainerEl = document.getElementById('terminal-container')
  const tabBarEl = document.getElementById('tab-bar')
  const fileTreeContainerEl = document.getElementById('file-tree-container')
  const btnUp = document.getElementById('btn-up')
  const btnHome = document.getElementById('btn-home')
  const btnRefreshTree = document.getElementById('btn-refresh-tree')
  const btnToggleHidden = document.getElementById('btn-toggle-hidden')
  const btnSearchProject = document.getElementById('btn-search-project')
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar')
  const btnSettings = document.getElementById('btn-settings')
  const btnToggleEditor = document.getElementById('btn-toggle-editor')
  const sidebar = document.getElementById('sidebar')
  const resizeHandle = document.getElementById('resize-handle')

  const { cwd: startCwd } = await api.getCwd()

  // — DI Container —
  const container = new AppContainer()
  container.register('store', () => appStore)
  container.register('bus', () => bus)
  container.register('api', () => api)
  container.register('gitStatusService', (r) => new GitStatusService({
    api: r('api'),
    eventBus: r('bus'),
    store: r('store'),
  }))
  const agentCommands = new Map()

  const applyAgentCommands = (statusPayload) => {
    const agents = statusPayload?.agents || []
    for (const agent of agents) {
      if (agent?.id && agent?.launchCommand) {
        agentCommands.set(agent.id, `${agent.launchCommand}\n`)
      }
    }
  }

  const refreshAgents = async () => {
    try {
      const result = await api.agentsRefresh(config.agents?.custom)
      applyAgentCommands(result)
      return result
    } catch {
      return null
    }
  }

  const getNormalizedProxyUrl = () => {
    const raw = (config.agents?.proxy || '').trim()
    if (!raw) return ''
    return raw.endsWith('/') ? raw : `${raw}/`
  }

  const buildAgentCommand = (baseCommand) => {
    const cmd = (baseCommand || '').trim()
    if (!cmd) return ''

    if (!config.agents?.proxyEnabled) return `${cmd}\n`

    const proxyUrl = getNormalizedProxyUrl()
    if (!proxyUrl) return `${cmd}\n`

    return `http_proxy=${proxyUrl} https_proxy=${proxyUrl} all_proxy=${proxyUrl} ${cmd}\n`
  }

  const focusActiveTerminal = () => {
    const tab = tabBar.getActive()
    if (tab) tab.term.focus()
  }

  const writeToPtyActive = (data) => {
    const tab = tabBar.getActive()
    if (tab) {
      api.ptyWrite(tab.pid, data)
      tab.term.focus()
    }
  }

  const shellCmdToPtyActive = (data) => {
    const tab = tabBar.getActive()
    if (tab) {
      api.ptyWrite(tab.pid, '\x15' + data)
      tab.term.focus()
    }
  }

  appStore.set('editor', { files: [], activePath: null })
  appStore.set('tabs', { items: [], activeIndex: -1 })

  // Register components in DI container
  container.register('editorPanel', (r) => new EditorPanel({
    panelEl: document.getElementById('editor-panel'),
    resizeHandleEl: document.getElementById('resize-handle-right'),
    eventBus: r('bus'),
    electronAPI: r('api'),
    getActiveCwd: () => container.resolve('tabBar').getActive()?.rootPath || startCwd,
    store: r('store'),
  }))
  container.register('fileTree', (r) => new FileTree(fileTreeContainerEl, { eventBus: r('bus'), api: r('api'), store: r('store') }))

  editorPanel = container.resolve('editorPanel')
  // Apply current theme immediately (applyTheme ran before editorPanel was created)
  const _initialTheme = loadedThemes[currentThemeName]
  if (_initialTheme?.editor) editorPanel.setTheme(_initialTheme.editor)

  const fileTree = container.resolve('fileTree')
  await fileTree.init(startCwd)
  fileTree.setCollapseChildrenOnClose(config.fileTree.collapseChildrenOnClose)
  fileTree.setFileOpenMode(config.fileTree.fileOpenMode || 'double')

  function updateNavButtons() {
    const tab = tabBar.getActive()
    const busy = tab?.isBusy ?? false
    btnUp.disabled = busy || (tab?.rootPath === '/')
    btnHome.disabled = busy
    fileTree.setIsBusy(busy)
  }

  const syncStatusBarTerminalState = () => {
    const tab = tabBar.getActive()
    statusBar.setTerminalState({
      isBusy: !!tab?.isBusy,
      activeAgentId: tab?.activeAgentId || null
    })
  }

  container.register('tabBar', (r) => new TabBar({
    tabBarEl,
    terminalContainerEl,
    eventBus: r('bus'),
    store: r('store'),
  }))

  tabBar = container.resolve('tabBar')
  window.__tabBar = tabBar

  // Platform class for CSS
  document.body.classList.add(`platform-${api.platform}`)

  // Window controls (Windows / Linux)
  if (api.platform !== 'darwin') {
    const btnMinimize = document.getElementById('btn-minimize')
    const btnMaximize = document.getElementById('btn-maximize')
    const btnRestore = document.getElementById('btn-restore')
    const btnClose = document.getElementById('btn-close')

    btnMinimize?.addEventListener('click', () => api.windowMinimize())
    btnMaximize?.addEventListener('click', () => api.windowMaximize())
    btnRestore?.addEventListener('click', () => api.windowMaximize())
    btnClose?.addEventListener('click', () => api.windowClose())

    api.windowIsMaximized().then(isMax => {
      if (isMax) {
        btnMaximize.style.display = 'none'
        btnRestore.style.display = ''
      }
    })

    api.onMaximizedChange((isMaximized) => {
      if (isMaximized) {
        btnMaximize.style.display = 'none'
        btnRestore.style.display = ''
      } else {
        btnMaximize.style.display = ''
        btnRestore.style.display = 'none'
      }
    })
  }

  container.register('terminalScrollButton', (r) => new TerminalScrollButton({
    eventBus: r('bus'),
    container: terminalContainerEl,
  }))
  container.resolve('terminalScrollButton')

  let _isSwitchingTab = false
  bus.on('tab.switch', async ({ tab, prevTab }) => {
    if (_isSwitchingTab) return
    if (settingsPage.isVisible()) return
    _isSwitchingTab = true
    try {
    // Очищаем все watchers перед сменой вкладки
    fileTree.unwatchAll()
    if (prevTab) {
      // Destroy previously suspended editor views to prevent memory leaks
      // when rapidly switching between tabs.
      if (prevTab.editorState?._detachedTabs) {
        for (const [, etab] of prevTab.editorState._detachedTabs) {
          etab.view.destroy()
        }
      }
      prevTab.treeExpandedDirs = fileTree.getExpandedDirs()
      prevTab.treeScrollTop = fileTree.getScrollTop()
      prevTab.editorState = editorPanel.suspendState()
      prevTab.gitPanelVisible = gitPanel.isVisible()
    }
    // Скрыть git-панель без side-effects перед переключением
    if (gitPanel.isVisible()) {
      gitPanel.hideQuiet()
      appStore.set('ui.gitPanelVisible', false)
    }
    if (tab.rootPath !== fileTree.getCwd()) {
      await fileTree.setRoot(tab.rootPath)
      api.fsSetRoot(tab.rootPath)
    } else {
      fileTree.collapseAll()
    }
    if (tab.treeExpandedDirs && tab.treeExpandedDirs.size > 0) {
      await fileTree.restoreExpandedDirs(tab.treeExpandedDirs)
    }
    fileTree.setScrollTop(tab.treeScrollTop || 0)
    await editorPanel.restoreState(tab.editorState || null)
    // Восстановить git-панель если она была открыта на этой вкладке
    if (tab.gitPanelVisible) {
      gitPanel.show(tab.rootPath)
      appStore.set('ui.gitPanelVisible', true)
    }
    document.title = tab.termTitle || 'eTty'
    updateNavButtons()
    syncStatusBarTerminalState()
    statusBar.updateNow()
    gitStatusService.setRootPath(tab.rootPath || null)
    } finally {
      _isSwitchingTab = false
    }
  })

  bus.on('tab.add', async (payload) => {
    if (settingsPage.isVisible()) return
    const active = tabBar.getActive()
    const cwd = active ? active.rootPath : startCwd
    let tabData
    try {
      tabData = await createTab(api, cwd)
    } catch (e) {
      console.error('[tab.add] Failed to create tab', cwd, e.message)
      return
    }
    const modifierPressed = !!(payload?.metaKey || payload?.ctrlKey)
    const placement = newTabPlacement
    let insertIndex = -1
    if (active && placement === 'modifierAdjacent') {
      insertIndex = modifierPressed ? tabBar.activeIndex + 1 : -1
    } else if (active && placement === 'modifierEnd') {
      insertIndex = modifierPressed ? -1 : tabBar.activeIndex + 1
    }
    const tab = tabBar.addTab(tabData, insertIndex)
    tab.isBusy = false
    tab.activeAgentId = null
    setupTabHandlers(tab)
    tab.fitAddon.fit()
  })

  bus.on('tab.close', ({ index }) => {
    if (settingsPage.isVisible()) return
    const tab = tabBar.tabs[index]
    if (tab._writeRaf) {
      cancelAnimationFrame(tab._writeRaf)
      tab._writeRaf = null
      tab._writeBuffer = null
    }
    if (tab.editorState?._detachedTabs) {
      for (const [, etab] of tab.editorState._detachedTabs) {
        etab.view.destroy()
      }
    }
    tabBar.removeTab(index)
    api.ptyKill(tab.pid)
  })

  // Страница настроек
  container.register('settingsPage', (r) => new SettingsPage({
    eventBus: r('bus'),
    onClose: () => {
      btnSettings.classList.remove('active')
      tabBar.disabled = false
      focusActiveTerminal()
    },
    api: r('api')
  }))
  const settingsPage = container.resolve('settingsPage')
  await settingsPage.init()

  container.register('gitPanel', (r) => new GitPanel({
    overlayEl: document.getElementById('git-overlay'),
    onClose: () => {
      appStore.set('ui.gitPanelVisible', false)
      statusBar.updateNow()
    },
    api: r('api'),
  }))
  const gitPanel = container.resolve('gitPanel')

  container.register('projectSearch', (r) => new ProjectSearchDialog({
    eventBus: r('bus'),
    api: r('api'),
    store: r('store'),
    getActiveCwd: () => container.resolve('tabBar').getActive()?.rootPath || startCwd,
    onClose: () => focusActiveTerminal(),
  }))
  const projectSearch = container.resolve('projectSearch')

  container.register('nodeVersionDialog', (r) => new NodeVersionDialog({
    api: r('api'),
    getActiveCwd: () => container.resolve('tabBar').getActive()?.rootPath || startCwd,
    onClose: () => focusActiveTerminal(),
    onVersionChanged: (version) => {
      const statusBar = container.resolve('statusBar')
      statusBar.setNodeVersion(version, null)
    },
  }))
  const nodeVersionDialog = container.resolve('nodeVersionDialog')

  bus.on('search.show', () => {
    if (settingsPage.isVisible() || gitPanel.isVisible()) return
    projectSearch.show()
  })

  bus.on('node-version:dialog:open', () => {
    if (settingsPage.isVisible() || gitPanel.isVisible()) return
    nodeVersionDialog.show()
  })

  const launchAgentInActiveTab = (agentId) => {
    const tab = tabBar.getActive()
    if (!tab || tab.isBusy) return

    const command = buildAgentCommand(agentCommands.get(agentId))
    if (!command) return

    tab.activeAgentId = agentId
    api.ptyWrite(tab.pid, command)
    syncStatusBarTerminalState()
    tab.term.focus()
  }

  /**
   * Назначает агента активным по double-click из StatusBar.
   * Используется когда терминал занят (busy), но агент не был определён автоматически
   * через OSC 133 (например, запущен вручную или через другое приложение).
   * Не отправляет команду в PTY — только декларативно устанавливает activeAgentId,
   * чтобы StatusBar показал быстрые команды (quick replies) этого агента.
   */
  const selectAgentAsActive = (agentId) => {
    const tab = tabBar.getActive()
    if (!tab || !tab.isBusy) return
    tab.activeAgentId = agentId
    syncStatusBarTerminalState()
  }

  container.register('statusBar', (r) => new StatusBar({
    btnEl: document.getElementById('btn-git-diff'),
    cwdEl: document.getElementById('status-cwd'),
    nodeEl: document.getElementById('status-node'),
    onOpen: () => appStore.set('ui.gitPanelVisible', true),
    onOpenNodeVersion: () => bus.emit('node-version:dialog:open'),
    agentsContainerEl: document.getElementById('status-agents'),
    onLaunchAgent: launchAgentInActiveTab,
    onSelectAgent: selectAgentAsActive,
    agentCommandsPanelEl: document.getElementById('agent-commands-panel'),
    onAgentCommand: (cmd) => {
      const tab = container.resolve('tabBar').getActive()
      if (tab) {
        tab.term.focus()
        r('api').ptyWrite(tab.pid, `\x1b[200~${cmd + ''}\x1b[201~`)
      }
    },
    proxyToggleEl: document.getElementById('btn-proxy-toggle'),
    onToggleProxy: (enabled) => {
      config.agents.proxyEnabled = enabled
      r('api').settingsSave(config)
    },
    quickReplies: config.quickReplies || { items: [] },
    api: r('api'),
  }))
  const statusBar = container.resolve('statusBar')

  const agentResult = await refreshAgents()
  if (agentResult) statusBar.setAgentsStatus(agentResult)
  statusBar.setAgentConfigs([
    ...SUPPORTED_AGENTS.map(a => ({ id: a.id, label: a.label })),
    ...(config.agents?.custom || [])
  ])
  statusBar.setForceDisabled(config.agents?.forceDisabled || {})
  statusBar.setProxyConfig({ proxy: config.agents.proxy || '', enabled: config.agents.proxyEnabled })

  statusBar.start(() => tabBar.getActive()?.rootPath)

  const gitStatusService = container.resolve('gitStatusService')
  gitStatusService.setRootPath(startCwd)

  // — Visibility subscribers (must be after component creation) —
  appStore.subscribe((state, path) => {
    if (path === 'ui.sidebarVisible') {
      const visible = state.ui.sidebarVisible
      sidebar.style.display = visible ? '' : 'none'
      resizeHandle.style.display = visible ? '' : 'none'
      btnToggleSidebar.classList.toggle('active', visible)
      tabBar.getActive()?.fitAddon.fit()
    }
  })

  appStore.subscribe((state, path) => {
    if (path === 'ui.editorVisible') {
      const visible = state.ui.editorVisible
      if (visible) {
        editorPanel.show()
      } else {
        editorPanel.hide()
      }
      btnToggleEditor.classList.toggle('active', visible)
    }
  })

  appStore.subscribe((state, path) => {
    if (path === 'ui.gitPanelVisible') {
      const visible = state.ui.gitPanelVisible
      if (visible) {
        gitPanel.show(tabBar.getActive()?.rootPath)
      } else {
        gitPanel.hide()
      }
    }
  })

  // — Editor EventBus subscribers —
  bus.on('editor.resize', () => tabBar.getActive()?.fitAddon.fit())
  bus.on('editor.show', () => btnToggleEditor.classList.add('active'))
  bus.on('editor.hide', () => {
    btnToggleEditor.classList.remove('active')
    tabBar.getActive()?.term.focus()
  })
  bus.on('editor.sendToTerminal', (lineRef) => {
    const tab = tabBar.getActive()
    if (tab) {
      api.ptyWrite(tab.pid, '\x1b[200~' + lineRef + '\x1b[201~')
    }
  })
  // — FileTree EventBus subscribers —
  bus.on('filetree.shellCmd', async (cmd) => {
    const tab = tabBar.getActive()
    if (!tab) return
    if (tab.isBusy) {
      const tabData = await createTab(api, tab.rootPath || startCwd)
      const newTab = tabBar.addTab(tabData)
      newTab.isBusy = false
      newTab.activeAgentId = null
      setupTabHandlers(newTab)
      newTab.fitAddon.fit()
      api.ptyWrite(newTab.pid, cmd)
    } else {
      api.ptyWrite(tab.pid, '\x15' + cmd)
      tab.term.focus()
    }
  })
  bus.on('filetree.inject', (path) => {
    const tab = tabBar.getActive()
    if (tab) {
      api.ptyWrite(tab.pid, '\x1b[200~' + path + '\x1b[201~')
      tab.term.focus()
    }
  })
  bus.on('terminal.focus', () => {
    tabBar.getActive()?.term.focus()
  })
  bus.on('filetree.openFile', (path) => editorPanel.openFile(path))
  bus.on('filetree.runInNewTab', async (path) => {
    const tabData = await createTab(api, tabBar.getActive()?.rootPath || startCwd)
    const tab = tabBar.addTab(tabData)
    tab.isBusy = false
    tab.activeAgentId = null
    setupTabHandlers(tab)
    tab.fitAddon.fit()
    api.ptyWrite(tab.pid, path + '\n')
  })

  // — Settings EventBus subscriber —
  bus.on('settings.changed', ({ key, value }) => {
    if (key === 'appearance.theme') applyTheme(value)
    if (key === 'appearance.focusIndicator') applyFocusIndicator(value)
    if (key === 'appearance.statusBarSize') applyStatusBarSize(value)
    if (key === 'fileTree.collapseChildrenOnClose') {
      appStore.set('settings.collapseChildrenOnClose', value)
      fileTree.setCollapseChildrenOnClose(value)
    }
    if (key === 'fileTree.fileOpenMode') {
      appStore.set('settings.fileOpenMode', value)
      fileTree.setFileOpenMode(value)
    }
    if (key === 'agents.forceDisabled') statusBar.setForceDisabled(value)
    if (key === 'agents.custom') {
      if (!config.agents) config.agents = {}
      config.agents.custom = value
      statusBar.setAgentConfigs([
        ...SUPPORTED_AGENTS.map(a => ({ id: a.id, label: a.label })),
        ...(value || [])
      ])
      refreshAgents()
    }
    if (key === 'agents.proxy') {
      config.agents.proxy = value
      statusBar.setProxyConfig({ proxy: config.agents.proxy, enabled: config.agents.proxyEnabled })
    }
    if (key === 'agents.keyboardModes') {
      if (!config.agents) config.agents = {}
      config.agents.keyboardModes = value
    }
    if (key === 'terminal.newTabPlacement') {
      newTabPlacement = value
      appStore.set('terminal.newTabPlacement', value)
    }
    if (key === 'quickReplies.items') {
      if (!config.quickReplies) config.quickReplies = { items: [] }
      config.quickReplies.items = value
      statusBar.setQuickReplies({ items: value })
    }
  })

  btnSettings.addEventListener('click', () => {
    if (settingsPage.isVisible()) {
      settingsPage.hide()
      btnSettings.classList.remove('active')
    } else {
      settingsPage.show()
      btnSettings.classList.add('active')
      tabBar.disabled = true
    }
  })

  api.onAgentsSettingsUpdated(({ forceDisabled }) => {
    config.agents.forceDisabled = forceDisabled
    statusBar.setForceDisabled(forceDisabled)
  })

  // Batched PTY write: accumulate incoming data and flush once per frame
  // to reduce xterm.js parse+render cycles when copilot/agents emit many small chunks.
  function batchedWrite(tab, data) {
    if (!tab._writeBuffer) {
      tab._writeBuffer = []
      tab._writeRaf = requestAnimationFrame(() => {
        const combined = tab._writeBuffer.join('')
        tab._writeBuffer = null
        tab._writeRaf = null
        const t0 = performance.now()
        tab.term.write(combined)
        const dt = performance.now() - t0
        if (dt > 16) {
          console.warn(`[xterm] Slow write: ${dt.toFixed(1)}ms for ${combined.length} chars`)
        }
      })
    }
    tab._writeBuffer.push(data)
  }

  // Глобальные IPC обработчики — маршрутизируют по pid
  api.onPtyData((pid, data) => {
    diagnostics.recordPtyData(pid, data.length)
    const tab = tabBar.tabs.find(t => t.pid === pid)
    if (!tab) return
    if (tab._isActive) {
      batchedWrite(tab, data)
    } else {
      tab._pendingData.push(data)
      tab._pendingDataSize += data.length
      if (tab._pendingDataSize > 1024 * 1024) {
        tab._pendingData.splice(0, tab._pendingData.length - 1)
        tab._pendingData[0] = '…[truncated]\n'
        tab._pendingDataSize = tab._pendingData[0].length
      }
    }
    // Track xterm.js buffer state for diagnostics
    try {
      const buffer = tab.term.buffer?.active
      diagnostics.recordXtermState(pid, buffer?.length || 0, buffer?.cursorY || 0, false)
    } catch (e) { /* ignore */ }
  })

  api.onPtyExit(({ pid }) => {
    const index = tabBar.tabs.findIndex(t => t.pid === pid)
    if (index >= 0) {
      const tab = tabBar.tabs[index]
      if (tab._writeRaf) {
        cancelAnimationFrame(tab._writeRaf)
        tab._writeRaf = null
        tab._writeBuffer = null
      }
      tabBar.removeTab(index)
    }
  })

  function setupTabHandlers(tab) {
    // Keyboard handling
    const keyboardHandler = new TerminalKeyboardHandler(
      { write: (pid, data) => api.ptyWrite(pid, data) },
      (pid) => {
        const t = tabBar.tabs.find(t => t.pid === pid)
        const agentId = t?.activeAgentId
        if (!agentId) return 'kitty'
        return config.agents?.keyboardModes?.[agentId] || ((agentId === 'qwen' || agentId === 'agento') ? 'ctrl-j' : 'kitty')
      }
    )
    keyboardHandler.attach(tab.term, tab.pid)

    // Terminal → PTY data
    tab.term.onData((data) => {
      api.ptyWrite(tab.pid, data)
    })

    // Terminal → PTY resize
    tab.term.onResize(({ cols, rows }) => {
      api.ptyResize(tab.pid, cols, rows)
    })

    // Title change — only for active tab
    tab.term.onTitleChange((title) => {
      if (tabBar.getActive()?.pid === tab.pid) {
        document.title = title || 'eTty'
      }
    })

    // OSC handlers
    const oscHandler = new TerminalOscHandler({
      onCwdChange: (newPath, pid) => {
        const index = tabBar.tabs.findIndex(t => t.pid === pid)
        if (index >= 0) tabBar.updateRootPath(index, newPath)

        if (tabBar.getActive()?.pid === pid) {
          if (newPath !== fileTree.getCwd()) {
            fileTree.setRoot(newPath)
            api.fsSetRoot(newPath)
          }
          updateNavButtons()
        }
      },
      onBusyChange: (isBusy, pid, wasBusy) => {
        const targetTab = tabBar.tabs.find(t => t.pid === pid)
        if (!targetTab) return

        targetTab.isBusy = isBusy
        if (!isBusy) targetTab.activeAgentId = null

        if (wasBusy !== isBusy && tabBar.getActive()?.pid === pid) {
          updateNavButtons()
          syncStatusBarTerminalState()
        }
      },
    })
    oscHandler.attach(tab.term, tab.pid)

    // WebGL addon — try to load for better rendering performance, fallback to canvas
    try {
      tab.term.loadAddon(new WebglAddon())
    } catch (e) {
      console.warn('WebGL addon failed, using canvas renderer:', e)
    }
  }

  // Expose tab state export for main process (before-quit)
  window.__exportTabState = () => {
    const tabs = tabBar.exportState()
    const activeTab = tabBar.getActive()
    // Attach editor state to each exported tab
    for (const exported of tabs) {
      const tab = tabBar.tabs.find(t => t.tabId === exported.tabId)
      if (tab) {
        if (tab === activeTab) {
          // Active tab — read live state from editor
          exported.editorState = editorPanel.exportEditorState()
          exported.gitPanelVisible = gitPanel.isVisible()
        } else {
          // Inactive tabs — use suspended state (strip _detachedTabs)
          const s = tab.editorState
          if (s) {
            exported.editorState = { files: s.files, activePath: s.activePath, visible: s.visible }
          }
          exported.gitPanelVisible = tab.gitPanelVisible || false
        }
      }
    }
    return tabs
  }

  // Auto-save tab state on changes + periodic flush
  let autoSaveTimeout = null
  let lastAutoSaveAt = 0
  const flushAutoSave = () => {
    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout)
      autoSaveTimeout = null
    }
    const tabs = window.__exportTabState()
    if (tabs.length > 0) {
      api.tabsAutoSave(tabs)
      lastAutoSaveAt = Date.now()
    }
  }
  const scheduleAutoSave = () => {
    if (autoSaveTimeout) return
    autoSaveTimeout = setTimeout(() => {
      autoSaveTimeout = null
      flushAutoSave()
    }, APP_CONFIG.TAB_STATE_AUTO_SAVE_DEBOUNCE_MS)
  }

  appStore.subscribe((state, path) => {
    if (
      path === null ||
      path.startsWith('tabs.') ||
      path.startsWith('editor.') ||
      path === 'ui.gitPanelVisible'
    ) {
      scheduleAutoSave()
    }
  })

  // Periodic flush every 30s regardless of activity
  const autoSaveInterval = setInterval(() => {
    if (Date.now() - lastAutoSaveAt >= APP_CONFIG.TAB_STATE_AUTO_SAVE_INTERVAL_MS) {
      flushAutoSave()
    }
  }, APP_CONFIG.TAB_STATE_AUTO_SAVE_INTERVAL_MS)

  window.addEventListener('beforeunload', () => {
    clearInterval(autoSaveInterval)
    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout)
      flushAutoSave()
    }
  })

  // Restore tabs from saved state (used by menu trigger)
  async function restoreTabs(savedTabs) {
    // Create new tabs first
    const oldCount = tabBar.tabs.length
    let activeIndex = oldCount
    for (let i = 0; i < savedTabs.length; i++) {
      let tabData
      try {
        tabData = await createTab(api, savedTabs[i].rootPath, savedTabs[i].tabId)
      } catch (e) {
        console.error('[restoreTabs] Failed to restore tab', savedTabs[i].rootPath, e.message)
        continue
      }
      const tab = tabBar.addTab(tabData)
      tab.isBusy = false
      tab.activeAgentId = null
      tab._savedEditorState = savedTabs[i].editorState || null
      tab.gitPanelVisible = savedTabs[i].gitPanelVisible || false
      setupTabHandlers(tab)
      tab.fitAddon.fit()
      if (savedTabs[i].isActive) activeIndex = oldCount + i
    }
    // Switch to restored active tab
    tabBar.switchTo(activeIndex)
    // Remove old tabs (in reverse to keep indices stable)
    for (let i = oldCount - 1; i >= 0; i--) {
      const tab = tabBar.tabs[i]
      api.ptyKill(tab.pid)
      tab.term.dispose()
      tab.container.remove()
      tab.element.remove()
      tabBar.tabs.splice(i, 1)
      if (tabBar.activeIndex > i) tabBar.activeIndex--
    }
    tabBar.switchTo(tabBar.activeIndex)
    // Restore editor files for the active tab
    const activeRestored = tabBar.getActive()
    if (activeRestored?._savedEditorState) {
      await editorPanel.restoreEditorFromSaved(activeRestored._savedEditorState)
      delete activeRestored._savedEditorState
    }
    for (const tab of tabBar.tabs) {
      if (tab !== activeRestored && tab._savedEditorState) {
        tab.editorState = { ...tab._savedEditorState, _detachedTabs: null }
        delete tab._savedEditorState
      }
    }
    // Restore git panel for the active tab
    if (activeRestored?.gitPanelVisible) {
      gitPanel.show(activeRestored.rootPath)
    }
    await api.tabsDeleteSavedState()
    api.tabsStateChanged()
  }

  // Check for saved state on startup
  let restored = false
  const hasSaved = await api.tabsHasSavedState()
  if (hasSaved) {
    const savedTabs = await api.tabsLoadSavedState()
    if (savedTabs && savedTabs.length > 0) {
      const shouldRestore = await api.tabsShowRestoreDialog(savedTabs.length)
      if (shouldRestore) {
        let activeIndex = 0
        for (let i = 0; i < savedTabs.length; i++) {
          let tabData
          try {
            tabData = await createTab(api, savedTabs[i].rootPath, savedTabs[i].tabId)
          } catch (e) {
            console.error('[Init] Failed to restore tab', savedTabs[i].rootPath, e.message)
            continue
          }
          const tab = tabBar.addTab(tabData)
          tab.isBusy = false
          tab.activeAgentId = null
          tab._savedEditorState = savedTabs[i].editorState || null
          tab.gitPanelVisible = savedTabs[i].gitPanelVisible || false
          setupTabHandlers(tab)
          tab.fitAddon.fit()
          if (savedTabs[i].isActive) activeIndex = i
        }
        if (savedTabs.length > 0) tabBar.switchTo(activeIndex)
        // Restore editor files for the active tab
        const activeTab = tabBar.getActive()
        if (activeTab?._savedEditorState) {
          await editorPanel.restoreEditorFromSaved(activeTab._savedEditorState)
          delete activeTab._savedEditorState
        }
        // Stash saved editor state on inactive tabs for lazy restore on switch
        for (const tab of tabBar.tabs) {
          if (tab !== activeTab && tab._savedEditorState) {
            tab.editorState = { ...tab._savedEditorState, _detachedTabs: null }
            delete tab._savedEditorState
          }
        }
        // Restore git panel for the active tab
        if (activeTab?.gitPanelVisible) {
          gitPanel.show(activeTab.rootPath)
        }
        restored = true
      }
      await api.tabsDeleteSavedState()
      api.tabsStateChanged()
    }
  }

  if (!restored) {
    let firstTabData
    try {
      firstTabData = await createTab(api, startCwd)
    } catch (e) {
      console.error('[Init] Failed to create initial tab', startCwd, e.message)
    }
    if (firstTabData) {
      const firstTab = tabBar.addTab(firstTabData)
      firstTab.isBusy = false
      firstTab.activeAgentId = null
      setupTabHandlers(firstTab)
      firstTab.fitAddon.fit()
    }
  }

  syncStatusBarTerminalState()

  // Cleanup orphaned history files
  const activeTabIds = tabBar.tabs.map(t => t.tabId).filter(Boolean)
  api.historyCleanup(activeTabIds)

  // Menu: restore tabs trigger
  api.onTabsTriggerRestore(async () => {
    const savedTabs = await api.tabsLoadSavedState()
    if (savedTabs && savedTabs.length > 0) {
      await restoreTabs(savedTabs)
    }
  })

  // Fullscreen: убираем padding titlebar
  api.onFullscreenChange((isFullscreen) => {
    document.body.classList.toggle('fullscreen', isFullscreen)
  })

  // Индикатор фокуса: подсвечиваем активную панель, снимаем при потере фокуса
  const editorPanelEl = document.getElementById('editor-panel')
  const updateFocusIndicator = (target) => {
    const inTerminal = !!target.closest('#terminal-container')
    const inEditor = !!target.closest('#editor-panel')
    terminalContainerEl.classList.toggle('panel-focused', inTerminal)
    editorPanelEl.classList.toggle('panel-focused', inEditor)
  }
  function onFocusIn(e) { updateFocusIndicator(e.target) }
  function onMouseDown(e) { updateFocusIndicator(e.target) }
  function onWindowBlur() {
    terminalContainerEl.classList.remove('panel-focused')
    editorPanelEl.classList.remove('panel-focused')
  }
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('mousedown', onMouseDown)
  window.addEventListener('blur', onWindowBlur)

  // Кнопки навигации сайдбара
  btnUp.disabled = startCwd === '/'
  btnUp.addEventListener('click', () => shellCmdToPtyActive('cd ..\n'))
  btnHome.addEventListener('click', () => shellCmdToPtyActive('cd ~\n'))

  btnToggleSidebar.classList.add('active')
  btnToggleSidebar.addEventListener('click', () => {
    if (settingsPage.isVisible() || gitPanel.isVisible()) return
    appStore.set('ui.sidebarVisible', !appStore.get('ui.sidebarVisible'))
  })

  btnToggleEditor.addEventListener('click', () => {
    if (settingsPage.isVisible() || gitPanel.isVisible()) return
    appStore.set('ui.editorVisible', !appStore.get('ui.editorVisible'))
  })

  // Горячая клавиша Cmd+E / Ctrl+E — toggle панели редактора
  // Cmd+F / Ctrl+F — открыть поиск по проекту
  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'e' && !e.shiftKey && !e.altKey) {
      // Не перехватываем, если фокус в CodeMirror (он сам обработает)
      if (document.activeElement?.closest('#editor-body')) return
      if (settingsPage.isVisible() || gitPanel.isVisible()) return
      e.preventDefault()
      appStore.set('ui.editorVisible', !appStore.get('ui.editorVisible'))
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'f' && !e.shiftKey && !e.altKey) {
      // Не перехватываем, если фокус в CodeMirror (у CodeMirror свой поиск)
      if (document.activeElement?.closest('#editor-body')) return
      if (settingsPage.isVisible() || gitPanel.isVisible()) return
      e.preventDefault()
      bus.emit('search.show')
    }
  }
  document.addEventListener('keydown', onKeyDown)

  // Двойное нажатие Shift — открыть поиск по проекту
  let lastShiftTime = 0
  function onShiftKeyDown(e) {
    if (e.key === 'Shift' && !e.repeat) {
      const now = Date.now()
      if (now - lastShiftTime < APP_CONFIG.SEARCH_DOUBLE_SHIFT_TIMEOUT_MS) {
        if (settingsPage.isVisible() || gitPanel.isVisible() || projectSearch.isVisible()) return
        e.preventDefault()
        bus.emit('search.show')
        lastShiftTime = 0
      } else {
        lastShiftTime = now
      }
    }
  }
  document.addEventListener('keydown', onShiftKeyDown)

  btnRefreshTree.innerHTML = Icons.refresh

  btnRefreshTree.addEventListener('click', async () => {
    btnRefreshTree.classList.add('spinning')
    const startTime = Date.now()
    try {
      await fileTree.refresh()
    } finally {
      const elapsed = Date.now() - startTime
      const minSpin = 1200
      const remaining = Math.max(0, minSpin - elapsed)
      setTimeout(() => {
        btnRefreshTree.classList.remove('spinning')
      }, remaining)
    }
  })

  btnToggleHidden.innerHTML = Icons.eyeOff

  let showHidden = false
  btnToggleHidden.addEventListener('click', () => {
    showHidden = !showHidden
    btnToggleHidden.innerHTML = showHidden ? Icons.eye : Icons.eyeOff
    btnToggleHidden.classList.toggle('active', showHidden)
    btnToggleHidden.title = showHidden ? 'Скрыть скрытые файлы' : 'Показать скрытые файлы'
    fileTree.setShowHidden(showHidden)
  })

  btnSearchProject.innerHTML = Icons.search
  btnSearchProject.addEventListener('click', () => {
    if (settingsPage.isVisible() || gitPanel.isVisible()) return
    bus.emit('search.show')
  })

  // Кастомный drag тайтлбара — работает даже когда вкладки заполняют всю ширину
  const titlebarEl = document.getElementById('titlebar')
  let dragState = null
  let titlebarDidDrag = false

  titlebarEl.addEventListener('mousedown', async (e) => {
    if (e.button !== 0) return
    titlebarDidDrag = false
    const [winX, winY] = await api.windowGetPosition()
    dragState = { startScreenX: e.screenX, startScreenY: e.screenY, startWinX: winX, startWinY: winY }
  })

  function onMouseMove(e) {
    if (!dragState) return
    const dx = e.screenX - dragState.startScreenX
    const dy = e.screenY - dragState.startScreenY
    if (!titlebarDidDrag && (Math.abs(dx) > APP_CONFIG.TITLEBAR_DRAG_THRESHOLD_PX || Math.abs(dy) > APP_CONFIG.TITLEBAR_DRAG_THRESHOLD_PX)) {
      titlebarDidDrag = true
    }
    if (titlebarDidDrag) {
      api.windowMove(dragState.startWinX + dx, dragState.startWinY + dy)
    }
  }

  function onMouseUp() { dragState = null }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)

  // Отменяем click по тайтлбару если был drag, но не блокируем клики по вкладкам и кнопкам tab-bar
  titlebarEl.addEventListener('click', (e) => {
    if (titlebarDidDrag) {
      if (!e.target.closest('#tab-bar')) {
        e.stopImmediatePropagation()
      }
      titlebarDidDrag = false
    }
  }, true)

  // Resize handle — изменение ширины сайдбара
  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault()
    resizeHandle.classList.add('dragging')
    const startX = e.clientX
    const startWidth = sidebar.offsetWidth
    const onMove = (e) => {
      const newWidth = Math.max(
        APP_CONFIG.SIDEBAR_MIN_WIDTH,
        Math.min(APP_CONFIG.SIDEBAR_MAX_WIDTH, startWidth + e.clientX - startX)
      )
      sidebar.style.width = newWidth + 'px'
      tabBar.getActive()?.fitAddon.fit()
    }
    const onUp = () => {
      resizeHandle.classList.remove('dragging')
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })

  // Resize handle для правой панели редактора
  const resizeHandleRight = document.getElementById('resize-handle-right')
  resizeHandleRight.addEventListener('mousedown', (e) => {
    e.preventDefault()
    resizeHandleRight.classList.add('dragging')
    const startX = e.clientX
    const startWidth = editorPanel._panelEl.offsetWidth
    const onMove = (e) => {
      // Перетаскиваем влево — редактор расширяется
      const newWidth = Math.max(
        APP_CONFIG.EDITOR_MIN_WIDTH,
        Math.min(window.innerWidth * APP_CONFIG.EDITOR_MAX_WIDTH_RATIO, startWidth - (e.clientX - startX))
      )
      editorPanel._panelEl.style.width = newWidth + 'px'
      tabBar.getActive()?.fitAddon.fit()
    }
    const onUp = () => {
      resizeHandleRight.classList.remove('dragging')
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })

  // ResizeObserver — подгонка активного терминала при изменении размера
  // Debounced: fitAddon.resize → pty:resize цепочка не должна молотить при
  // анимациях или быстрых resize-событиях (sidebar drag, fullscreen toggle).
  function debounce(fn, ms) {
    return (...args) => {
      clearTimeout(resizeDebounceTimer)
      resizeDebounceTimer = setTimeout(() => fn(...args), ms)
    }
  }
  resizeObserver = new ResizeObserver(debounce(() => tabBar.getActive()?.fitAddon.fit(), APP_CONFIG.RESIZE_OBSERVER_DEBOUNCE_MS))
  resizeObserver.observe(terminalContainerEl)

  // Cleanup function: disconnect observer, clear timer, remove global listeners, destroy container
  function cleanupRenderer() {
    clearTimeout(resizeDebounceTimer)
    resizeDebounceTimer = null
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
    document.removeEventListener('focusin', onFocusIn)
    document.removeEventListener('mousedown', onMouseDown)
    window.removeEventListener('blur', onWindowBlur)
    document.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('keydown', onShiftKeyDown)
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    gitStatusService.destroy()
    projectSearch.destroy()
    container.destroy()
  }

  window.addEventListener('beforeunload', cleanupRenderer)

  // Performance diagnostics — disabled by default, enable via window.__diagnostics.start()
  // (querySelectorAll('*') every 3s can cause style recalculation and UI stutter)
  window.__diagnostics = diagnostics
}

init()
