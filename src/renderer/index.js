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
import './styles.css'
import './components/base/context-menu/context-menu.css'
import './components/base/button/button.css'
import { FileTree } from './file-tree.js'
import { TabBar } from './tab-bar.js'
import { THEMES } from './themes.js'
import { SettingsPage } from './settings-page.js'
import { StatusBar } from './status-bar.js'
import { GitPanel } from './git-panel.js'
import { EditorPanel } from './editor-panel.js'
import { Icons } from './icons.js'
import { TERMINAL_CONFIG } from './core/config/terminal-config.js'
import { APP_CONFIG } from './core/config/app-config.js'
import { TerminalKeyboardHandler } from './features/terminal/terminal-keyboard-handler.js'
import { TerminalOscHandler } from './features/terminal/terminal-osc-handler.js'
import { EventBus } from './core/event-bus.js'
import { StateStore } from './core/state-store.js'
import { ElectronApiAdapter } from './core/adapters/electron-api.js'
import { AppContainer } from './core/container.js'
import { diagnostics } from './core/diagnostics.js'

let currentThemeName = 'dark'
let loadedThemes = THEMES
/** @type {TabBar|null} */
let tabBar = null
/** @type {EditorPanel|null} */
let editorPanel = null
/** @type {StateStore|null} */
let appStore = null

/** Применяет стиль индикатора фокуса через data-атрибут на корневом элементе. */
function applyFocusIndicator(style) {
  appStore?.set('ui.focusIndicator', style || 'none')
}

/** Применяет тему: обновляет CSS-переменные, терминалы и редактор. */
function applyTheme(themeName) {
  appStore?.set('ui.theme', themeName)
}

/** Создаёт новую вкладку: Terminal + FitAddon + PTY-сессия. */
async function createTab(cwd, tabId) {
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
  const { config } = await window.electronAPI.settingsLoad()
  const promptStyle = config.terminal?.promptStyle || 'default'
  const { pid } = await window.electronAPI.ptyCreate({
    cols: TERMINAL_CONFIG.DEFAULT_COLS,
    rows: TERMINAL_CONFIG.DEFAULT_ROWS,
    cwd,
    tabId,
    promptStyle,
  })

  return { term, fitAddon, pid, rootPath: cwd, tabId }
}

async function init() {
  // Загружаем настройки до инициализации всего остального
  const { config, themes, warnings } = await window.electronAPI.settingsLoad()
  loadedThemes = { ...THEMES, ...themes }
  if (warnings && warnings.length > 0) {
    console.warn('Settings warnings:', ...warnings)
  }
  if (!config.agents) config.agents = {}
  if (typeof config.agents.proxy !== 'string') config.agents.proxy = ''
  if (typeof config.agents.proxyEnabled !== 'boolean') config.agents.proxyEnabled = false

  // Initialize store with current settings
  appStore = new StateStore({
    ui: {
      theme: config.appearance.theme || 'dark',
      focusIndicator: config.appearance.focusIndicator || 'none',
      sidebarVisible: true,
      editorVisible: false,
      gitPanelVisible: false,
    },
    settings: {
      collapseChildrenOnClose: config.fileTree?.collapseChildrenOnClose ?? true,
      fileOpenMode: config.fileTree?.fileOpenMode || 'double',
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

  applyTheme(config.appearance.theme)
  applyFocusIndicator(config.appearance.focusIndicator)

  const terminalContainerEl = document.getElementById('terminal-container')
  const tabBarEl = document.getElementById('tab-bar')
  const fileTreeContainerEl = document.getElementById('file-tree-container')
  const btnUp = document.getElementById('btn-up')
  const btnHome = document.getElementById('btn-home')
  const btnToggleHidden = document.getElementById('btn-toggle-hidden')
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar')
  const btnSettings = document.getElementById('btn-settings')
  const btnToggleEditor = document.getElementById('btn-toggle-editor')
  const sidebar = document.getElementById('sidebar')
  const resizeHandle = document.getElementById('resize-handle')

  // — DI Container —
  const container = new AppContainer()
  container.register('store', () => appStore)
  container.register('bus', () => bus)
  container.register('api', () => new ElectronApiAdapter())

  const { cwd: startCwd } = await window.electronAPI.getCwd()
  const agentCommands = {
    claude: 'claude\n',
    codex: 'codex\n',
    copilot: 'gh copilot\n',
    agent: 'agent\n',
    opencode: 'opencode\n'
  }

  const applyAgentCommands = (statusPayload) => {
    const agents = statusPayload?.agents || []
    for (const agent of agents) {
      if (agent?.id && agent?.launchCommand) {
        agentCommands[agent.id] = `${agent.launchCommand}\n`
      }
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
      window.electronAPI.ptyWrite(tab.pid, data)
      tab.term.focus()
    }
  }

  const shellCmdToPtyActive = (data) => {
    const tab = tabBar.getActive()
    if (tab) {
      window.electronAPI.ptyWrite(tab.pid, '\x15' + data)
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
  container.register('fileTree', (r) => new FileTree(fileTreeContainerEl, { eventBus: r('bus'), api: r('api') }))

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
      window.electronAPI.fsSetRoot(tab.rootPath)
    } else {
      fileTree.collapseAll()
    }
    if (tab.treeExpandedDirs && tab.treeExpandedDirs.size > 0) {
      await fileTree.restoreExpandedDirs(tab.treeExpandedDirs)
    }
    fileTree.setScrollTop(tab.treeScrollTop || 0)
    editorPanel.restoreState(tab.editorState || null)
    // Восстановить git-панель если она была открыта на этой вкладке
    if (tab.gitPanelVisible) {
      gitPanel.show(tab.rootPath)
      appStore.set('ui.gitPanelVisible', true)
    }
    document.title = tab.termTitle || 'eTty'
    updateNavButtons()
    syncStatusBarTerminalState()
    statusBar.updateNow()
    } finally {
      _isSwitchingTab = false
    }
  })

  bus.on('tab.add', async () => {
    if (settingsPage.isVisible()) return
    const active = tabBar.getActive()
    const cwd = active ? active.rootPath : startCwd
    const tabData = await createTab(cwd)
    const tab = tabBar.addTab(tabData)
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
    window.electronAPI.ptyKill(tab.pid)
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
  }))
  const gitPanel = container.resolve('gitPanel')

  const launchAgentInActiveTab = (agentId) => {
    const tab = tabBar.getActive()
    if (!tab || tab.isBusy) return

    const command = buildAgentCommand(agentCommands[agentId])
    if (!command) return

    tab.activeAgentId = agentId
    window.electronAPI.ptyWrite(tab.pid, command)
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
    agentButtons: [...document.querySelectorAll('.status-agent-btn')],
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
    quickReplies: config.quickReplies || { items: [] }
  }))
  const statusBar = container.resolve('statusBar')

  const agentsStatus = await window.electronAPI.agentsGetStatus().catch(() => ({ agents: [] }))
  applyAgentCommands(agentsStatus)
  statusBar.setAgentsStatus(agentsStatus)
  statusBar.setForceDisabled(config.agents?.forceDisabled || {})
  statusBar.setProxyConfig({ proxy: config.agents.proxy || '', enabled: config.agents.proxyEnabled })

  statusBar.start(() => tabBar.getActive()?.rootPath)

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
      window.electronAPI.ptyWrite(tab.pid, '\x1b[200~' + lineRef + '\x1b[201~')
    }
  })
  bus.on('editor.openExternal', (cmd) => {
    const tab = tabBar.getActive()
    if (tab) {
      window.electronAPI.ptyWrite(tab.pid, '\x15' + cmd)
      tab.term.focus()
    }
  })

  // — FileTree EventBus subscribers —
  bus.on('filetree.shellCmd', (cmd) => {
    const tab = tabBar.getActive()
    if (tab) {
      window.electronAPI.ptyWrite(tab.pid, '\x15' + cmd)
      tab.term.focus()
    }
  })
  bus.on('filetree.inject', (path) => {
    const tab = tabBar.getActive()
    if (tab) {
      window.electronAPI.ptyWrite(tab.pid, '\x1b[200~' + path + '\x1b[201~')
      tab.term.focus()
    }
  })
  bus.on('terminal.focus', () => {
    tabBar.getActive()?.term.focus()
  })
  bus.on('filetree.openFile', (path) => editorPanel.openFile(path))
  bus.on('filetree.runInNewTab', async (path) => {
    const tabData = await createTab(tabBar.getActive()?.rootPath || startCwd)
    const tab = tabBar.addTab(tabData)
    tab.isBusy = false
    tab.activeAgentId = null
    setupTabHandlers(tab)
    tab.fitAddon.fit()
    window.electronAPI.ptyWrite(tab.pid, path + '\n')
  })

  // — Settings EventBus subscriber —
  bus.on('settings.changed', ({ key, value }) => {
    if (key === 'appearance.theme') applyTheme(value)
    if (key === 'appearance.focusIndicator') applyFocusIndicator(value)
    if (key === 'fileTree.collapseChildrenOnClose') {
      appStore.set('settings.collapseChildrenOnClose', value)
      fileTree.setCollapseChildrenOnClose(value)
    }
    if (key === 'fileTree.fileOpenMode') {
      appStore.set('settings.fileOpenMode', value)
      fileTree.setFileOpenMode(value)
    }
    if (key === 'agents.forceDisabled') statusBar.setForceDisabled(value)
    if (key === 'agents.proxy') {
      config.agents.proxy = value
      statusBar.setProxyConfig({ proxy: config.agents.proxy, enabled: config.agents.proxyEnabled })
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

  window.electronAPI.onAgentsSettingsUpdated(({ forceDisabled }) => {
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
  window.electronAPI.onPtyData((pid, data) => {
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

  window.electronAPI.onPtyExit(({ pid }) => {
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
    const keyboardHandler = new TerminalKeyboardHandler({
      write: (pid, data) => window.electronAPI.ptyWrite(pid, data),
    })
    keyboardHandler.attach(tab.term, tab.pid)

    // Terminal → PTY data
    tab.term.onData((data) => {
      window.electronAPI.ptyWrite(tab.pid, data)
    })

    // Terminal → PTY resize
    tab.term.onResize(({ cols, rows }) => {
      window.electronAPI.ptyResize(tab.pid, cols, rows)
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
            window.electronAPI.fsSetRoot(newPath)
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

  // Restore tabs from saved state (used by menu trigger)
  async function restoreTabs(savedTabs) {
    // Create new tabs first
    const oldCount = tabBar.tabs.length
    let activeIndex = oldCount
    for (let i = 0; i < savedTabs.length; i++) {
      const tabData = await createTab(savedTabs[i].rootPath, savedTabs[i].tabId)
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
      window.electronAPI.ptyKill(tab.pid)
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
    await window.electronAPI.tabsDeleteSavedState()
    window.electronAPI.tabsStateChanged()
  }

  // Check for saved state on startup
  let restored = false
  const hasSaved = await window.electronAPI.tabsHasSavedState()
  if (hasSaved) {
    const savedTabs = await window.electronAPI.tabsLoadSavedState()
    if (savedTabs && savedTabs.length > 0) {
      const shouldRestore = await window.electronAPI.tabsShowRestoreDialog(savedTabs.length)
      if (shouldRestore) {
        let activeIndex = 0
        for (let i = 0; i < savedTabs.length; i++) {
          const tabData = await createTab(savedTabs[i].rootPath, savedTabs[i].tabId)
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
      await window.electronAPI.tabsDeleteSavedState()
      window.electronAPI.tabsStateChanged()
    }
  }

  if (!restored) {
    const firstTabData = await createTab(startCwd)
    const firstTab = tabBar.addTab(firstTabData)
    firstTab.isBusy = false
    firstTab.activeAgentId = null
    setupTabHandlers(firstTab)
    firstTab.fitAddon.fit()
  }

  syncStatusBarTerminalState()

  // Cleanup orphaned history files
  const activeTabIds = tabBar.tabs.map(t => t.tabId).filter(Boolean)
  window.electronAPI.historyCleanup(activeTabIds)

  // Menu: restore tabs trigger
  window.electronAPI.onTabsTriggerRestore(async () => {
    const savedTabs = await window.electronAPI.tabsLoadSavedState()
    if (savedTabs && savedTabs.length > 0) {
      await restoreTabs(savedTabs)
    }
  })

  // Fullscreen: убираем padding titlebar
  window.electronAPI.onFullscreenChange((isFullscreen) => {
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
  document.addEventListener('focusin', (e) => updateFocusIndicator(e.target))
  document.addEventListener('mousedown', (e) => updateFocusIndicator(e.target))
  window.addEventListener('blur', () => {
    terminalContainerEl.classList.remove('panel-focused')
    editorPanelEl.classList.remove('panel-focused')
  })

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
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'e' && !e.shiftKey && !e.altKey) {
      // Не перехватываем, если фокус в CodeMirror (он сам обработает)
      if (document.activeElement?.closest('#editor-body')) return
      if (settingsPage.isVisible() || gitPanel.isVisible()) return
      e.preventDefault()
      appStore.set('ui.editorVisible', !appStore.get('ui.editorVisible'))
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

  // Кастомный drag тайтлбара — работает даже когда вкладки заполняют всю ширину
  const titlebarEl = document.getElementById('titlebar')
  let dragState = null
  let titlebarDidDrag = false

  titlebarEl.addEventListener('mousedown', async (e) => {
    if (e.button !== 0) return
    titlebarDidDrag = false
    const [winX, winY] = await window.electronAPI.windowGetPosition()
    dragState = { startScreenX: e.screenX, startScreenY: e.screenY, startWinX: winX, startWinY: winY }
  })

  document.addEventListener('mousemove', (e) => {
    if (!dragState) return
    const dx = e.screenX - dragState.startScreenX
    const dy = e.screenY - dragState.startScreenY
    if (!titlebarDidDrag && (Math.abs(dx) > APP_CONFIG.TITLEBAR_DRAG_THRESHOLD_PX || Math.abs(dy) > APP_CONFIG.TITLEBAR_DRAG_THRESHOLD_PX)) {
      titlebarDidDrag = true
    }
    if (titlebarDidDrag) {
      window.electronAPI.windowMove(dragState.startWinX + dx, dragState.startWinY + dy)
    }
  })

  document.addEventListener('mouseup', () => { dragState = null })

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
    let timer
    return (...args) => {
      clearTimeout(timer)
      timer = setTimeout(() => fn(...args), ms)
    }
  }
  new ResizeObserver(debounce(() => tabBar.getActive()?.fitAddon.fit(), APP_CONFIG.RESIZE_OBSERVER_DEBOUNCE_MS)).observe(terminalContainerEl)

  // Performance diagnostics — disabled by default, enable via window.__diagnostics.start()
  // (querySelectorAll('*') every 3s can cause style recalculation and UI stutter)
  window.__diagnostics = diagnostics
}

init()
