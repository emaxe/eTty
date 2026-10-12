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
import { GitPanel } from './features/git/git-panel.js'
import { SshPanel } from './features/ssh/ssh-panel.js'
import { SshTabOverlay } from './features/ssh/ssh-tab-overlay.js'
import { EditorPanel } from './editor-panel.js'
import { ProjectSearchDialog } from './project-search.js'
import { NodeVersionDialog } from './node-version-dialog.js'
import { ConfirmDialog } from './confirm-dialog.js'
import { Icons } from './icons.js'
import { TERMINAL_CONFIG } from './core/config/terminal-config.js'
import { APP_CONFIG } from './core/config/app-config.js'
import { TerminalKeyboardHandler } from './features/terminal/terminal-keyboard-handler.js'
import { TerminalImagePaste } from './features/terminal/terminal-image-paste.js'
import { showToast } from './components/toast/toast.js'
import { TerminalOscHandler } from './features/terminal/terminal-osc-handler.js'
import { TerminalWheelHandler } from './features/terminal/terminal-wheel-handler.js'
import { TerminalScrollButton } from './features/terminal/terminal-scroll-button.js'
import { EventBus } from './core/event-bus.js'
import { StateStore } from './core/state-store.js'
import { ElectronApiAdapter } from './core/adapters/electron-api.js'
import { createScopedFsApi } from './core/adapters/scoped-fs-api.js'
import { AppContainer } from './core/container.js'
import { diagnostics } from './core/diagnostics.js'
import { GitStatusService } from './services/git-status-service.js'
import { buildSessionNameBase, pickFreeSessionName } from '../shared/ssh-session-name.js'
import { resolveSshPersistence } from '../shared/ssh-persistence.js'

let currentThemeName = 'dark'
let loadedThemes = THEMES
/** @type {TabBar|null} */
let tabBar = null
/** @type {EditorPanel|null} */
let editorPanel = null
/** @type {SshPanel|null} */
let sshPanel = null
let sshPanelPosition = 'off'
/** @type {StateStore|null} */
let appStore = null
/** @type {ResizeObserver|null} */
let resizeObserver = null
let resizeDebounceTimer = null
let newTabPlacement = 'modifierAdjacent'
let tabSwitchHotkey = 'none'
let isRestoringTabs = false

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

/** Применяет позицию панели SSH (left/right/off) — фактическое перемещение DOM см. в подписчике на ssh.panelPosition. */
function applySshPanelPosition(pos) {
  appStore?.set('ssh.panelPosition', pos || 'off')
}

/**
 * Создаёт новую вкладку: Terminal + FitAddon + PTY-сессия.
 * @param {object} [ssh] — { connectionId, label }. Если передан, PTY не создаётся сразу —
 *   вкладка стартует неподключённой, подключение выполняет `connectSshTab()` (main index.js).
 */
async function createTab(api, cwd, tabId, ssh) {
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

  if (ssh) {
    // remoteCwd — последний известный удалённый cwd при восстановлении вкладки (см.
    // tab-bar.js exportState/restore-циклы ниже); не часть ssh.connectionId/label самих по себе.
    const { remoteCwd, ...sshInfo } = ssh
    // Имя tmux-сессии генерируется ОДИН раз здесь, а не при каждом connectSshTab: стабильно при
    // восстановлении вкладки by construction (детерминировано от tabId) и всегда проходит
    // SESSION_NAME_RE. Только для режима tmux — обычная SSH-вкладка (persistence !== 'tmux')
    // имени не получает. Если sessionName уже пришёл (восстановление, наследование по «+») —
    // не трогаем: main сам решает, использовать ли его (см. resolveSshPersistence).
    if (sshInfo.persistence === 'tmux' && !sshInfo.sessionName) {
      const tabIdHex = tabId.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || Math.random().toString(16).slice(2, 10)
      sshInfo.sessionName = `${buildSessionNameBase(sshInfo.connectionId)}-${tabIdHex}`.slice(0, 64)
    }
    return { term, fitAddon, pid: null, rootPath: cwd, tabId, ssh: sshInfo, remoteCwd: remoteCwd || null }
  }

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
  tabSwitchHotkey = config.terminal?.tabSwitchHotkey || 'none'
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
      sshPanelVisible: false,
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
      groups: config.quickReplies?.groups || [],
    },
    git: {
      isRepo: false,
      rootPath: null,
      fileStatuses: {},
      branch: null,
      totalAdditions: 0,
      totalDeletions: 0,
      ignoredTracked: new Set(),
      ignoredPaths: [],
    },
    ssh: {
      panelPosition: config.ssh?.panelPosition || 'off',
      connections: [],
    },
    // Текущий FS-контекст активной вкладки — читает scoped-fs-api.js, обновляется в
    // bus.on('tab.switch')/connectSshTab/onSshFsReady/onPtyExit (см. ниже).
    fs: {
      context: { kind: 'local' },
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

      // Git diff — токены подсветки синтаксиса (features/git/diff-highlighter.js)
      if (theme.editor) {
        const e = theme.editor
        root.setProperty('--dt-keyword', e.keyword)
        root.setProperty('--dt-string', e.string)
        root.setProperty('--dt-number', e.number)
        root.setProperty('--dt-comment', e.comment)
        root.setProperty('--dt-function', e.function)
        root.setProperty('--dt-type', e.type)
        root.setProperty('--dt-variable', e.variable)
        root.setProperty('--dt-operator', e.operator)
        root.setProperty('--dt-property', e.property)
        root.setProperty('--dt-tag', e.tag)
        root.setProperty('--dt-attribute', e.attribute)
        root.setProperty('--dt-bracket', e.bracket)
      }

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
  const btnToggleSsh = document.getElementById('btn-toggle-ssh')
  const sidebar = document.getElementById('sidebar')
  const resizeHandle = document.getElementById('resize-handle')
  const workspaceEl = document.getElementById('workspace')
  const resizeHandleSsh = document.getElementById('resize-handle-ssh')

  const { cwd: startCwd } = await api.getCwd()

  // — DI Container —
  const container = new AppContainer()
  container.register('store', () => appStore)
  container.register('bus', () => bus)
  container.register('api', () => api)
  container.register('scopedApi', (r) => createScopedFsApi(api, () => r('store').get('fs.context')))
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

  /**
   * Сопоставляет foreground-команду tmux-панели (`pane_current_command`) с id агента eTty.
   * Нужно для восстановленных tmux-вкладок: OSC 133 при re-attach к живой сессии не
   * переизлучается (шелл не перезапускается), поэтому наличие запущенного агента выводим
   * из имени текущей команды панели.
   * @param {string} command
   * @returns {string|null}
   */
  const resolveAgentIdByCommand = (command) => {
    const name = String(command || '').trim().split(/\s+/)[0].split('/').pop()
    if (!name) return null
    for (const agent of SUPPORTED_AGENTS) {
      if (agent.id === name) return agent.id
    }
    for (const agent of config.agents?.custom || []) {
      if (agent?.id === name) return agent.id
    }
    for (const [id, cmd] of agentCommands) {
      const base = String(cmd).trim().split(/\s+/)[0].split('/').pop()
      if (base && base === name) return id
    }
    return null
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
    electronAPI: r('scopedApi'),
    getActiveCwd: () => container.resolve('tabBar').getActive()?.rootPath || startCwd,
    store: r('store'),
  }))
  // Регистрация здесь (не рядом с остальными resolve('confirmDialog') ниже) — FileTree
  // резолвится намного раньше и уже сейчас нуждается в confirmDialog для подтверждения удаления.
  container.register('confirmDialog', () => new ConfirmDialog())
  container.register('fileTree', (r) => new FileTree(fileTreeContainerEl, { eventBus: r('bus'), api: r('scopedApi'), store: r('store'), confirmDialog: r('confirmDialog') }))

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
    // Кнопку ручного сброса busy показываем и для честно-неопределённого состояния:
    // busy выставлен оптимистично (SSH), либо OSC мог быть потерян при усечении буфера фоновой вкладки.
    statusBar.setTerminalState({
      isBusy: !!tab?.isBusy,
      activeAgentId: tab?.activeAgentId || null,
      busyOptimistic: !!(tab?._busyOptimistic || (tab?.isBusy && tab?._oscMaybeLost))
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
    // Контекст ДО unwatchAll()/setRoot() — иначе последний fsUnwatchDir() прошлой вкладки
    // уйдёт уже в новый ctx. Для SSH без готового удалённого FS (ещё подключается/провалилось)
    // контекст не трогаем вовсе — дерево на секунду сохраняет вид прошлой вкладки, но НЕ
    // показывает чужие данные под видом текущей (тот самый баг, который чинит Этап 0/4).
    const nextCtx = tab.ssh
      ? (tab._sshFsAvailable === true ? { kind: 'ssh', sessionId: tab.pid } : null)
      : { kind: 'local' }
    if (nextCtx) appStore.set('fs.context', nextCtx)
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
    if (nextCtx && (tab.rootPath !== fileTree.getCwd() || !fileTree.isSameContext(nextCtx))) {
      await fileTree.setRoot(tab.rootPath, nextCtx)
      api.fsSetRoot(tab.rootPath, nextCtx)
    } else if (nextCtx) {
      fileTree.collapseAll()
    }
    if (tab.treeExpandedDirs && tab.treeExpandedDirs.size > 0) {
      await fileTree.restoreExpandedDirs(tab.treeExpandedDirs)
    }
    fileTree.setScrollTop(tab.treeScrollTop || 0)
    await editorPanel.restoreState(tab.editorState || null)
    // Восстановить git-панель если она была открыта на этой вкладке
    if (tab.gitPanelVisible) {
      openGitPanelForTab(tab)
      appStore.set('ui.gitPanelVisible', true)
    }
    document.title = tab.termTitle || 'eTty'
    updateNavButtons()
    syncStatusBarTerminalState()
    statusBar.updateNow()
    retargetGit(tab)
    // Lazy connect: восстановленная SSH-вкладка подключается при первом переключении на неё.
    // Не срабатывает во время пакетного восстановления вкладок (isRestoringTabs) — иначе
    // каждая промежуточная addTab()→switchTo() открыла бы реальное SSH-соединение.
    if (!isRestoringTabs && tab.ssh && tab.pid == null && !tab._sshEverConnected && !tab._sshConnecting) {
      connectSshTab(tab)
    }
    } finally {
      _isSwitchingTab = false
    }
  })

  /**
   * Имена tmux-сессий, занятые ВСЕМИ открытыми вкладками этого подключения — в т.ч. отключёнными
   * (pid не задан): такая вкладка может переподключиться, и если её имя достанется новой вкладке,
   * `new-session -A -D` перехватит сессию.
   */
  function claimedSessionNames(connectionId) {
    return tabBar.tabs
      .filter(t => t.ssh?.connectionId === connectionId && t.ssh.sessionName)
      .map(t => t.ssh.sessionName)
  }

  /**
   * Имя tmux-сессии для подключения/переподключения. По умолчанию — детерминированное от
   * connectionId: «одна постоянная сессия на подключение» — закрыли вкладку, подключились
   * заново (клик в панели SSH или "+") — вернулись в ту же сессию, а не создали пустую новую
   * (см. docs/features/ssh-persistent-sessions/, баг: сессия не находилась после переподключения).
   * Если это имя уже занято ЖИВОЙ вкладкой (в т.ч. при «+ Новая сессия» из панели, передающей
   * `knownNames` — известные с сервера имена) — берём первое свободное `<base>-2`, `-3`, …,
   * иначе `new-session -A -D` у tmux отцепил бы уже открытую вкладку.
   * @param {string} connectionId
   * @param {string[]} [knownNames] — дополнительные занятые имена (сессии с сервера — панель
   *   передаёт актуальный список при «+ Новая сессия», см. features/ssh/ssh-panel.js)
   */
  function pickNewTmuxSessionName(connectionId, knownNames = []) {
    const base = buildSessionNameBase(connectionId)
    const taken = [...claimedSessionNames(connectionId), ...knownNames]
    return pickFreeSessionName(base, taken)
  }

  bus.on('tab.add', async (payload) => {
    if (settingsPage.isVisible()) return
    const active = tabBar.getActive()
    const cwd = active ? active.rootPath : startCwd
    // Активная SSH-вкладка + "+" → новая вкладка того же подключения (REQ: наследование SSH).
    // persistence — от активной вкладки; для tmux всегда НОВОЕ имя сессии (не переиспользуем
    // текущее — иначе new-session -A -D отцепил бы вкладку-источник).
    const sshInherit = active?.ssh
      ? {
          connectionId: active.ssh.connectionId,
          label: active.ssh.label,
          persistence: active.ssh.persistence,
          sessionName: active.ssh.persistence === 'tmux'
            ? pickNewTmuxSessionName(active.ssh.connectionId, sshPanel.getKnownSessionNames(active.ssh.connectionId))
            : null
        }
      : null
    let tabData
    try {
      tabData = await createTab(api, cwd, null, sshInherit)
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
    if (sshInherit) connectSshTab(tab)
  })

  /**
   * Клик по подключению/сессии в SshPanel — новая SSH-вкладка + подключение.
   * @param {{ connectionId: string, persistence?: 'off'|'tmux', sessionName?: string,
   *   knownSessionNames?: string[], forceNew?: boolean }} payload — `persistence`/`sessionName` —
   *   из режима панели (SSH/tmux, клик по конкретной сессии в списке); не заданы — main решает
   *   сам по `connection.persistence` (обратная совместимость, см. ssh/ssh-persistence.js).
   *   `knownSessionNames` — известные с сервера имена сессий (панель передаёт их для
   *   «+ Новая сессия», чтобы не столкнуться с сессией без открытой вкладки).
   *   `forceNew` — «+ Новая сессия»: без `sessionName` это НЕ «подключись к дефолтной сессии»,
   *   а «создай новую со свободным именем».
   */
  bus.on('ssh.connect', async ({ connectionId, persistence, sessionName, knownSessionNames, forceNew }) => {
    if (settingsPage.isVisible()) return
    const connection = sshPanel.getConnection(connectionId)
    if (!connection) return
    // Уже открытая живая вкладка этой же (или дефолтной) сессии — переключаемся на неё вместо
    // второго подключения: иначе new-session -A -D отцепило бы собственную вкладку пользователя
    // (см. план, «важная деталь»). При forceNew без имени дефолтной сессии не подразумевается —
    // иначе вторая «новая» сессия всегда упиралась бы в вкладку с базовым именем.
    const targetName = sessionName || (persistence === 'tmux' && !forceNew ? buildSessionNameBase(connectionId) : null)
    if (targetName) {
      const already = tabBar.tabs.find(t => t.ssh?.connectionId === connectionId && t.ssh.sessionName === targetName && t.pid != null)
      if (already) {
        tabBar.switchTo(tabBar.tabs.indexOf(already))
        return
      }
    }
    const active = tabBar.getActive()
    const cwd = active ? active.rootPath : startCwd
    let tabData
    try {
      tabData = await createTab(api, cwd, null, {
        connectionId: connection.id,
        label: connection.label,
        persistence,
        sessionName: sessionName || (persistence === 'tmux' ? pickNewTmuxSessionName(connectionId, knownSessionNames) : null)
      })
    } catch (e) {
      console.error('[ssh.connect] Failed to create tab', e.message)
      return
    }
    const tab = tabBar.addTab(tabData)
    tab.isBusy = false
    tab.activeAgentId = null
    setupTabHandlers(tab)
    tab.fitAddon.fit()
    connectSshTab(tab)
  })

  // Сессию переименовали из контекстного меню панели (ssh-panel.js) — если у неё есть открытая
  // вкладка, обновляем её sessionName. Без этого следующий реконнект создал бы НОВУЮ пустую
  // сессию под старым (уже не существующим) именем вместо attach к переименованной.
  bus.on('ssh.session.renamed', ({ connectionId, from, to }) => {
    const tab = tabBar.tabs.find(t => t.ssh?.connectionId === connectionId && t.ssh.sessionName === from)
    if (!tab) return
    tab.ssh.sessionName = to
    tabBar.setTabTmux(tab, tab.ssh.persistence === 'tmux')
    tabBar._updateTabLabel(tab)
    tabBar.syncStore()
  })

  // Регистрация вынесена выше (см. рядом с fileTree) — здесь просто резолвим тот же singleton.
  const confirmDialog = container.resolve('confirmDialog')

  // Закрывает конкретную вкладку (по ссылке — устойчиво к сдвигу индексов
  // при закрытии нескольких вкладок подряд): cleanup + удаление из TabBar + kill PTY.
  const closeTabByRef = (tab) => {
    const index = tabBar.tabs.indexOf(tab)
    if (index < 0) return
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
    tab._sshOverlay?.destroy()
    tabBar.removeTab(index)
    if (tab.pid != null) api.ptyKill(tab.pid)
    // Закрытие tmux-вкладки = detach: панели не ждать полла, чтобы погасить индикатор «подключена».
    // pty:exit для этой вкладки уже не найдёт (удалена выше) — второго события не будет.
    if (tab.pid != null && tab._sshPersistent && tab.ssh) bus.emit('ssh.session.activity', { connectionId: tab.ssh.connectionId })
  }

  // Низкоуровневый исполнитель закрытия (без подтверждения) — на случай прочих эмитентов.
  bus.on('tab.close', ({ index }) => {
    if (settingsPage.isVisible()) return
    const tab = tabBar.tabs[index]
    if (tab) closeTabByRef(tab)
  })

  // Пользовательские пути закрытия («×», контекстное меню) идут сюда: если среди
  // закрываемых вкладок есть вкладка с активным процессом (tab.isBusy) — запрашиваем
  // подтверждение перед тем, как убить PTY.
  bus.on('tab.close.request', async ({ index, tabs } = {}) => {
    if (settingsPage.isVisible()) return
    const targets = (tabs && tabs.length ? tabs : [tabBar.tabs[index]]).filter(Boolean)
    if (targets.length === 0) return

    // Персистентная (tmux) SSH-вкладка не подтверждается: закрытие — это detach, а не kill
    // (см. план, Этап 3), процесс на сервере не убивается, предупреждение вводило бы в заблуждение.
    const busyTabs = targets.filter(t => t.isBusy && !t._sshPersistent)
    if (busyTabs.length > 0) {
      let message
      if (targets.length === 1) {
        const agentLabel = SUPPORTED_AGENTS.find(a => a.id === targets[0].activeAgentId)?.label
        message = agentLabel
          ? `В этой вкладке выполняется активный процесс (${agentLabel}). Закрыть вкладку?`
          : 'В этой вкладке выполняется активный процесс. Закрыть вкладку?'
      } else {
        message = `Среди закрываемых вкладок ${busyTabs.length} с активным процессом. Закрыть всё равно?`
      }
      const confirmed = await confirmDialog.open({
        title: targets.length === 1 ? 'Закрыть вкладку?' : 'Закрыть вкладки?',
        message,
      })
      if (!confirmed) {
        focusActiveTerminal()
        return
      }
    }

    for (const tab of targets) closeTabByRef(tab)
  })

  // Страница настроек
  container.register('settingsPage', (r) => new SettingsPage({
    eventBus: r('bus'),
    onClose: () => {
      btnSettings.classList.remove('active')
      tabBar.disabled = false
      focusActiveTerminal()
    },
    api: r('api'),
    confirmDialog: r('confirmDialog')
  }))
  const settingsPage = container.resolve('settingsPage')
  await settingsPage.init()

  container.register('gitPanel', (r) => new GitPanel({
    overlayEl: document.getElementById('git-overlay'),
    onClose: () => {
      appStore.set('ui.gitPanelVisible', false)
      statusBar.updateNow()
      focusActiveTerminal()
    },
    eventBus: r('bus'),
    store: r('store'),
    api: r('api'),
    confirmDialog: r('confirmDialog'),
  }))
  const gitPanel = container.resolve('gitPanel')

  /**
   * Открывает git-панель для данной вкладки. SSH-вкладка работает с удалённым репозиторием
   * через ssh-канал (git-runner), как только готова удалённая ФС; до этого — уведомление.
   */
  function openGitPanelForTab(tab) {
    if (!tab) return
    if (tab.ssh) {
      if (tab._sshFsAvailable !== true) {
        gitPanel.showUnavailable('Удалённая сессия ещё не готова — git станет доступен после подключения')
        return
      }
      gitPanel.show(tab.rootPath, { kind: 'ssh', sessionId: tab.pid })
      return
    }
    gitPanel.show(tab.rootPath)
  }

  /**
   * Направляет git-сервис (ветка, статусы дерева, gutter) на репозиторий активной вкладки:
   * локальный путь либо удалённый (ssh-ctx). Вызывается при переключении вкладки и при каждой
   * смене cwd/готовности удалённой ФС. Дебаунс — OSC 7 приходит на каждый промпт.
   */
  var _retargetGitTimer = null
  function retargetGit(tab, { immediate = true } = {}) {
    clearTimeout(_retargetGitTimer)
    const apply = () => {
      if (!tab || tabBar.getActive() !== tab) return
      if (tab.ssh) {
        if (tab._sshFsAvailable === true && tab.pid != null && tab.rootPath) {
          gitStatusService.setRootPath(tab.rootPath, { kind: 'ssh', sessionId: tab.pid })
        } else {
          // Удалённая ФС ещё не готова: локальный rootPath SSH-вкладки — не её репозиторий
          gitStatusService.setRootPath(null)
        }
        return
      }
      gitStatusService.setRootPath(tab.rootPath || null)
    }
    if (immediate) apply()
    else _retargetGitTimer = setTimeout(apply, 300)
  }

  container.register('sshPanel', (r) => new SshPanel({
    panelEl: document.getElementById('ssh-panel'),
    resizeHandleEl: resizeHandleSsh,
    eventBus: r('bus'),
    store: r('store'),
    api: r('api'),
    confirmDialog: r('confirmDialog'),
    initialMode: config.ssh?.panelMode === 'tmux' ? 'tmux' : 'ssh',
    onModeChange: (mode) => {
      if (!config.ssh) config.ssh = {}
      config.ssh.panelMode = mode
      api.settingsSave(config)
    },
    onClose: () => appStore.set('ui.sshPanelVisible', false),
  }))
  sshPanel = container.resolve('sshPanel')
  // Список подключений нужен сразу — для восстановления SSH-вкладок и наследования по "+",
  // даже если панель ни разу не открывалась пользователем в этой сессии.
  await sshPanel.refresh()

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
    confirmDialog: r('confirmDialog'),
    getContext: () => {
      const tab = container.resolve('tabBar').getActive()
      return {
        cwd: tab?.rootPath || startCwd,
        ctx: tab?.ssh ? { kind: 'ssh', sessionId: tab.pid } : { kind: 'local' },
        isSsh: !!tab?.ssh,
        currentVersion: tab?.nodeVersion || null,
        shellCtx: tab ? tabShellCtx(tab) : undefined,
      }
    },
    // Переключение — командой в терминал вкладки: менять версию нужно в её шелле (PATH),
    // а не в одноразовом процессе. Следующий промпт пришлёт новый путь к node (OSC 6973).
    onUseVersion: (manager, version) => {
      const tab = container.resolve('tabBar').getActive()
      if (!tab || tab.pid == null) return { ok: false, reason: 'Нет активного терминала' }
      if (tab.isBusy) return { ok: false, reason: 'Терминал занят — дождитесь завершения команды' }
      if (!/^[\w.*/-]+$/.test(version) || version.startsWith('-')) return { ok: false, reason: 'Некорректная версия' }
      const command = { nvm: `nvm use ${version}`, fnm: `fnm use ${version}`, asdf: `asdf shell nodejs ${version}` }[manager]
      if (!command) return { ok: false, reason: 'Менеджер версий не определён' }
      // \x15 (Ctrl+U) — очистить уже набранный в строке текст перед командой
      api.ptyWrite(tab.pid, `\x15${command}\r`)
      return { ok: true }
    },
    onClose: () => focusActiveTerminal(),
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
    // OSC 133 не приходит с SSH-вкладок без инжектированных хуков (см. Этап 2 плана) —
    // без оптимистичного busy панель быстрых команд никогда бы не появилась. Честный
    // OSC 133 (если хуки всё-таки заработали) перекрывает это состояние в onBusyChange.
    if (tab.ssh || tab._sshHooksMissing) {
      tab.isBusy = true
      tab._busyOptimistic = true
    }
    syncStatusBarTerminalState()
    tab.term.focus()
  }

  /**
   * Назначает агента активным по double-click из StatusBar.
   * Используется когда терминал занят (busy), но агент не был определён автоматически
   * через OSC 133 (например, запущен вручную или через другое приложение).
   * Не отправляет команду в PTY — только декларативно устанавливает activeAgentId,
   * чтобы StatusBar показал быстрые команды (quick replies) этого агента.
   * Для SSH-вкладок (см. launchAgentInActiveTab) работает и без предшествующего busy —
   * там честного OSC 133 может не быть вовсе.
   */
  const selectAgentAsActive = (agentId) => {
    const tab = tabBar.getActive()
    if (!tab) return
    if (!tab.isBusy && !tab.ssh && !tab._sshHooksMissing) return
    const wasBusy = tab.isBusy
    tab.isBusy = true
    if (!wasBusy) tab._busyOptimistic = true
    tab.activeAgentId = agentId
    syncStatusBarTerminalState()
  }

  /**
   * Явный сброс busy, когда он неопределён (крестик в панели быстрых команд, см. StatusBar):
   * оптимистичное состояние SSH-вкладки, либо возможная потеря OSC 133 при усечении буфера.
   */
  const clearOptimisticBusy = () => {
    const tab = tabBar.getActive()
    if (!tab || (!tab._busyOptimistic && !tab._oscMaybeLost)) return
    tab.isBusy = false
    tab._busyOptimistic = false
    tab._oscMaybeLost = false
    tab.activeAgentId = null
    syncStatusBarTerminalState()
    updateNavButtons()
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
    onClearOptimisticBusy: clearOptimisticBusy,
    proxyToggleEl: document.getElementById('btn-proxy-toggle'),
    onToggleProxy: (enabled) => {
      config.agents.proxyEnabled = enabled
      r('api').settingsSave(config)
    },
    quickReplies: config.quickReplies || { items: [], groups: [] },
    api: r('api'),
    store: r('store'),
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

  statusBar.start(() => tabBar.getActive()?.rootPath, () => tabBar.getActive()?.nodeVersion)

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
        openGitPanelForTab(tabBar.getActive())
      } else {
        gitPanel.hide()
      }
    }
  })

  appStore.subscribe((state, path) => {
    if (path === 'ui.sshPanelVisible') {
      const visible = state.ui.sshPanelVisible
      if (visible) sshPanel.show()
      else sshPanel.hide()
      btnToggleSsh.classList.toggle('active', visible)
    }
  })

  // Позиция панели SSH: 'off' скрывает кнопку тулбара и саму панель;
  // 'left'/'right' перемещает panelEl + resizeHandleEl внутри #workspace.
  appStore.subscribe((state, path) => {
    if (path !== 'ssh.panelPosition') return
    const pos = state.ssh.panelPosition
    sshPanelPosition = pos
    const panelEl = sshPanel._panelEl

    if (pos === 'left') {
      workspaceEl.insertBefore(panelEl, sidebar)
      workspaceEl.insertBefore(resizeHandleSsh, sidebar)
      panelEl.classList.remove('pos-right')
      panelEl.classList.add('pos-left')
    } else {
      workspaceEl.appendChild(resizeHandleSsh)
      workspaceEl.appendChild(panelEl)
      panelEl.classList.remove('pos-left')
      panelEl.classList.add('pos-right')
    }

    if (pos === 'off') {
      btnToggleSsh.classList.add('hidden')
      if (appStore.get('ui.sshPanelVisible')) appStore.set('ui.sshPanelVisible', false)
    } else {
      btnToggleSsh.classList.remove('hidden')
    }
  })
  applySshPanelPosition(config.ssh?.panelPosition)

  // — Editor EventBus subscribers —
  bus.on('editor.resize', () => tabBar.getActive()?.fitAddon.fit())
  bus.on('ssh.resize', () => tabBar.getActive()?.fitAddon.fit())
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
    if (key === 'ssh.panelPosition') {
      if (!config.ssh) config.ssh = {}
      config.ssh.panelPosition = value
      applySshPanelPosition(value)
    }
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
    if (key === 'terminal.tabSwitchHotkey') {
      tabSwitchHotkey = value
    }
    if (key === 'terminal.defaultKeyboardMode') {
      if (!config.terminal) config.terminal = {}
      config.terminal.defaultKeyboardMode = value
    }
    if (key === 'quickReplies') {
      config.quickReplies = { items: value.items || [], groups: value.groups || [] }
      appStore.set('quickReplies', config.quickReplies)
      statusBar.setQuickReplies(config.quickReplies)
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
    if (tab._sshOverlay) {
      // Первый байт от PTY — скрываем прелоадер подключения (виден prompt пароля/yes-no от ssh)
      tab._sshOverlay.destroy()
      tab._sshOverlay = null
    }
    if (tab._isActive) {
      batchedWrite(tab, data)
    } else {
      tab._pendingData.push(data)
      tab._pendingDataSize += data.length
      if (tab._pendingDataSize > 1024 * 1024) {
        tab._pendingData.splice(0, tab._pendingData.length - 1)
        tab._pendingData[0] = '…[truncated]\n'
        tab._pendingDataSize = tab._pendingData[0].length
        // OSC-последовательности (133;A и т.п.) из вырезанного куска потеряны — busy этой
        // вкладки мог зависнуть без честного сигнала о завершении. Даёт право на ручной сброс.
        tab._oscMaybeLost = true
      }
    }
    // Track xterm.js buffer state for diagnostics
    try {
      const buffer = tab.term.buffer?.active
      diagnostics.recordXtermState(pid, buffer?.length || 0, buffer?.cursorY || 0, false)
    } catch (e) { /* ignore */ }
  })

  api.onPtyExit(({ pid, exitCode }) => {
    const index = tabBar.tabs.findIndex(t => t.pid === pid)
    if (index >= 0) {
      const tab = tabBar.tabs[index]
      if (tab._writeRaf) {
        cancelAnimationFrame(tab._writeRaf)
        tab._writeRaf = null
        tab._writeBuffer = null
      }
      // SSH-сессия: не закрываем вкладку, показываем ошибку с возможностью переподключиться
      if (tab.ssh) {
        tab.pid = null
        // Провайдер удалённой ФС жил в SshSessionRegistry по СТАРОМУ pid и уже уничтожен
        // (PtyManager.onExit → sshSessionRegistry.dispose) — новый придёт через ssh:fs-ready
        // при следующем connectSshTab. До тех пор дерево не должно считать сессию доступной.
        tab._sshFsAvailable = false
        tabBar.syncStore()
        if (tab._sshHookDetectTimer) {
          clearTimeout(tab._sshHookDetectTimer)
          tab._sshHookDetectTimer = null
        }
        if (!tab._sshOverlay) tab._sshOverlay = new SshTabOverlay(tab.container)

        // Обрыв/перехват tmux-вкладки меняет число клиентов сессии — панель обновляет индикатор.
        if (tab._sshPersistent) bus.emit('ssh.session.activity', { connectionId: tab.ssh.connectionId })

        // Персистентная сессия, перехваченная другим клиентом (`new-session -A -D` отцепляет
        // прежнего) — локальный ssh получает exitCode 0, а не разрыв. Существующий авто-реконнект
        // ниже требует exitCode !== 0 и на это условие не сработает — отдельная ветка с понятным
        // сообщением вместо «разорвано (код 0)» (см. план, Этап 3).
        if (tab._sshPersistent && exitCode === 0 && tab._sshEverConnected) {
          tab._sshOverlay.showDetached(tab.ssh.label, () => connectSshTab(tab))
          return
        }

        // Инжект хуков (Этап 2) мог конфликтовать с RemoteCommand в ~/.ssh/config пользователя
        // или ForceCommand на сервере — один безусловный реконнект без remote-команды,
        // прежде чем показать ошибку. injectedHooks читается ДО детект-таймаута (8с), поэтому
        // при быстром падении (<3с) достоверно отражает, инжектились ли хуки для ЭТОЙ попытки.
        // В tmux-режиме remote-команда остаётся (см. ssh-command.js: persistence тянет её за
        // собой независимо от хуков) — ретрай лишь выключает OSC/ZDOTDIR-хуки, сама сессия жива.
        const injectedHooks = !tab._sshHooksMissing
        const failedFast = exitCode !== 0
          && tab._sshConnectedAt
          && (Date.now() - tab._sshConnectedAt) < APP_CONFIG.SSH_HOOK_FAIL_FAST_MS
        if (injectedHooks && failedFast && !tab._sshHookRetried) {
          tab._sshHookRetried = true
          connectSshTab(tab, { skipShellIntegration: true })
          return
        }
        // Персистентные (tmux) вкладки иногда быстро падают (exitCode≠0, пустой терминал, без
        // единого байта вывода) именно КОГДА к этому же подключению уже открыта другая вкладка —
        // воспроизведено на практике; пропадает, как только остаётся одна живая вкладка этого
        // подключения, и не решается одной мгновенной попыткой (см. ретрай выше — он тоже может
        // попасть в то же окно). Это не гонка записи общих файлов хуков в $HOME/.cache/etty —
        // проверено адверсариальным стресс-тестом. Один из подтверждённых источников такого
        // симптома — удалённый rootPath активной SSH-вкладки, попавший в локальный cwd `ssh`
        // (исправлено в PtyManager.resolveSshSpawnCwd); повтор С ЗАДЕРЖКОЙ оставлен для
        // остальных быстрых падений — даём несколько попыток, прежде чем показать ошибку насовсем.
        if (tab._sshPersistent && failedFast && (tab._sshTmuxRaceRetries || 0) < APP_CONFIG.SSH_TMUX_RACE_MAX_RETRIES) {
          tab._sshTmuxRaceRetries = (tab._sshTmuxRaceRetries || 0) + 1
          const attempt = tab._sshTmuxRaceRetries
          tab._sshOverlay.showConnecting(tab.ssh.label)
          setTimeout(() => {
            // Пользователь мог сам переподключить/закрыть вкладку, пока мы ждали — не мешаем.
            if (tab.pid == null && tabBar.tabs.includes(tab)) connectSshTab(tab, { isTmuxRaceRetry: true })
          }, APP_CONFIG.SSH_TMUX_RACE_RETRY_DELAY_MS * attempt)
          return
        }
        tab._sshOverlay.showError(tab.ssh.label, exitCode, () => connectSshTab(tab))
        return
      }
      tabBar.removeTab(index)
    }
  })

  /** Пересчитывает fs.context для активной вкладки и (пере)открывает дерево на её корне. */
  function syncActiveFsContext() {
    const tab = tabBar.getActive()
    if (!tab) return
    const ctx = tab.ssh
      ? (tab._sshFsAvailable === true ? { kind: 'ssh', sessionId: tab.pid } : null)
      : { kind: 'local' }
    if (!ctx) return
    appStore.set('fs.context', ctx)
    if (tab.rootPath !== fileTree.getCwd() || !fileTree.isSameContext(ctx)) {
      fileTree.setRoot(tab.rootPath, ctx)
      api.fsSetRoot(tab.rootPath, ctx)
    }
  }

  // Готовность ControlMaster-канала удалённой ФС (см. src/main/ssh/ssh-control-channel.js).
  api.onSshFsReady(({ pid, available, reason, caps }) => {
    const tab = tabBar.tabs.find(t => t.pid === pid)
    if (!tab) return
    tab._sshFsAvailable = available
    tab._sshFsReason = available ? null : (reason || null)
    // caps.tmuxPassthrough — используется в onSshSessionState для решения, доверять ли pane_path
    // как доказательству живых хуков (см. там же).
    if (caps) tab._sshFsCaps = caps
    // Служебный канал поднят = авторизация прошла, tmux-клиент вот-вот подцепится — поздний,
    // более точный сигнал для панели, чем момент ptyCreate (см. connectSshTab).
    if (tab._sshPersistent) bus.emit('ssh.session.activity', { connectionId: tab.ssh.connectionId })
    if (available) {
      // caps.home — стартовый корень удалённого дерева (см. F в плане); remoteCwd сохраняется
      // отдельно, чтобы восстановленная вкладка не «прыгала» обратно в $HOME при реконнекте.
      tab.remoteCwd = tab.remoteCwd || caps?.home || '/'
      tab.rootPath = tab.remoteCwd
      tabBar.syncStore()
    }
    if (tabBar.getActive() === tab) {
      syncActiveFsContext()
      retargetGit(tab)
    }
  })

  // Ресинк персистентной (tmux) сессии сразу после attach (Этап 2) — без него вкладка не знает
  // cwd/busy до следующего промпта. `pathFromOsc` — то, что tmux сам забрал из НАШЕГО OSC 7,
  // рабочий фолбэк, даже когда `markSshHooksAlive` ниже не срабатывает (tmux < 3.3/passthrough
  // недоступен) — тогда `_sshHooksMissing` намеренно остаётся true, чтобы не терять существующий
  // оптимистичный busy-фолбэк.
  api.onSshSessionState(({ pid, currentPath, pathFromOsc, currentCommand }) => {
    const tab = tabBar.tabs.find(t => t.pid === pid)
    if (!tab || !tab.ssh) return

    const newPath = currentPath || pathFromOsc
    if (newPath) {
      tab.remoteCwd = newPath
      tab.rootPath = newPath
      tabBar._updateTabLabel(tab)
      if (tabBar.getActive() === tab) {
        syncActiveFsContext()
        retargetGit(tab, { immediate: false })
        updateNavButtons()
      }
    }

    // Признак busy — эвристика: текущая команда панели не похожа на login-shell. Ручной сброс
    // (_busyOptimistic, см. StatusBar._createClearOptimisticBusyButton) остаётся доступен.
    if (!currentCommand) {
      // Команду панели получить не удалось — состояние оставляем как есть (не гадаем).
    } else if (/^-?(zsh|bash|sh|fish|csh|tcsh|dash)$/.test(currentCommand)) {
      // Шелл на переднем плане = панель свободна. Для восстановленной tmux-вкладки это ещё и
      // доказательство, что запущенный ранее агент завершился — снимаем устаревшее состояние,
      // восстановленное из tabs-state.json (applySavedAgentState).
      tab.isBusy = false
      tab._busyOptimistic = false
      tab.activeAgentId = null
      if (tabBar.getActive() === tab) syncStatusBarTerminalState()
    } else {
      tab.isBusy = true
      tab._busyOptimistic = true
      // Восстановление агента: если панель занята известным агентом eTty — назначаем его активным,
      // чтобы вернуть панель быстрых команд (StatusBar) после рестарта.
      const inferredAgentId = resolveAgentIdByCommand(currentCommand)
      if (inferredAgentId) tab.activeAgentId = inferredAgentId
      tabBar._updateTabLabel(tab)
      if (tabBar.getActive() === tab) syncStatusBarTerminalState()
    }

    // pane_path (tmux сам забрал его из нашего OSC 7) доказывает, что хуки исполнились —
    // засчитываем это, только если DCS-passthrough вообще доступен (caps из ssh:fs-ready,
    // см. onSshFsReady ниже): иначе OSC 133 наружу всё равно не пройдёт, и снятие
    // _sshHooksMissing здесь лишило бы вкладку оптимистичного busy-фолбэка без замены.
    if (pathFromOsc && tab._sshFsCaps?.tmuxPassthrough) markSshHooksAlive(tab)
  })

  // Постоянные сессии запрошены, но tmux на сервере не найден (Этап 1) — main уже распознал
  // менеджер пакетов и прислал готовую команду (см. tmux-install.js). Ничего не выполняется
  // от имени пользователя без явного согласия; сама команда вводится в ЭТОТ ЖЕ терминал —
  // если нужен sudo-пароль, пользователь вводит его как обычно, вживую.
  api.onSshTmuxMissing(({ pid, installCmd }) => {
    const tab = tabBar.tabs.find(t => t.pid === pid)
    if (!tab || !tab.ssh || tab._sshTmuxInstallOffered) return
    tab._sshTmuxInstallOffered = true
    confirmDialog.open({
      title: 'tmux не найден на сервере',
      message: `На «${tab.ssh.label}» включены постоянные сессии, но tmux не установлен. `
        + `Ввести в этом терминале команду:\n${installCmd}\n\n`
        + 'Если появится запрос пароля sudo — введите его как обычно.',
      confirmText: 'Установить',
      cancelText: 'Не сейчас',
    }).then((confirmed) => {
      if (!confirmed || tab.pid !== pid) return
      api.ptyWrite(pid, installCmd + '\n')
      tab._sshTmuxInstallPending = true
    })
  })

  /**
   * Создаёт и привязывает keyboardHandler/oscHandler для текущего tab.pid, сохраняя ссылки
   * на tab._keyboardHandler/_oscHandler. Вынесено из setupTabHandlers, чтобы переиспользовать
   * при переподключении SSH-вкладки (новый pid — оба хендлера захватывают pid в замыкание
   * при attach() и не видят последующих изменений tab.pid; их `detach()` необратимо обнуляет
   * зависимости из конструктора, так что для смены pid создаём новые инстансы, а не detach+attach).
   */
  /**
   * Отмечает, что инжектированные на SSH-хосте remote-хуки (Этап 2, remote-shell-hooks.js)
   * действительно ожили — снимает детект-таймаут в connectSshTab и оптимистичный fallback (Этап 1).
   */
  function markSshHooksAlive(tab) {
    if (!tab || tab._sshHooksAlive) return
    tab._sshHooksAlive = true
    tab._sshHooksMissing = false
    if (tab._sshHookDetectTimer) {
      clearTimeout(tab._sshHookDetectTimer)
      tab._sshHookDetectTimer = null
    }
  }

  /** ctx для main-процесса: удалённый шелл — через SSH-канал вкладки, локальный — без ctx. */
  function tabShellCtx(tab) {
    return tab.ssh ? { kind: 'ssh', sessionId: tab.pid } : undefined
  }

  /**
   * Обновляет версию node вкладки по пути к бинарю, присланному хуком шелла (OSC 6973 на каждый
   * промпт). Версия из пути (nvm/fnm/asdf) определяется без запуска процесса; для shim'ов и
   * системных установок main спрашивает сам бинарь — не чаще раза в 3 с на вкладку.
   */
  async function updateTabNodeVersion(tab, nodePath) {
    const changed = nodePath !== tab.nodePath
    if (!changed && (tab.nodeVersionSource === 'path' || Date.now() - (tab._nodeResolvedAt || 0) < 3000)) return
    tab.nodePath = nodePath
    tab._nodeResolvedAt = Date.now()

    let resolved = null
    if (nodePath) {
      try { resolved = await api.nodeVersionResolve(nodePath, tabShellCtx(tab)) } catch { /* не критично */ }
    }
    if (tab.nodePath !== nodePath) return // за время запроса путь сменился
    tab.nodeVersion = resolved?.version || null
    tab.nodeVersionSource = resolved?.source || null
    if (tabBar.getActive() === tab) statusBar.setNodeVersion(tab.nodeVersion, null)
  }

  function attachPidHandlers(tab) {
    // При переподключении освобождаем disposables предыдущего oscHandler (регистрируются
    // на term.parser и не заменяются сами — в отличие от attachCustomKeyEventHandler)
    tab._oscHandler?.detach()
    tab._imagePaste?.detach()

    const imagePaste = new TerminalImagePaste({ api, getTab: () => tab, notify: showToast })
    imagePaste.attach(tab.term)
    tab._imagePaste = imagePaste

    const keyboardHandler = new TerminalKeyboardHandler(
      { write: (pid, data) => api.ptyWrite(pid, data) },
      (pid) => {
        const t = tabBar.tabs.find(t => t.pid === pid)
        const agentId = t?.activeAgentId
        const defaultMode = config.terminal?.defaultKeyboardMode || 'kitty'
        if (!agentId) return defaultMode
        return config.agents?.keyboardModes?.[agentId] || ((agentId === 'qwen' || agentId === 'agento') ? 'ctrl-j' : defaultMode)
      },
      () => imagePaste.handleCtrlV()
    )
    keyboardHandler.attach(tab.term, tab.pid)
    tab._keyboardHandler = keyboardHandler

    const wheelHandler = new TerminalWheelHandler({ write: (pid, data) => api.ptyWrite(pid, data) })
    wheelHandler.attach(tab.term, tab.pid, { isTmux: !!tab._sshPersistent })
    tab._wheelHandler = wheelHandler

    const oscHandler = new TerminalOscHandler({
      onCwdChange: (newPath, pid) => {
        const index = tabBar.tabs.findIndex(t => t.pid === pid)
        const changedTab = tabBar.tabs[index]
        if (!changedTab) return

        if (changedTab.ssh) {
          // OSC 7 подтверждает, что инжектированные хуки (Этап 2) ожили. Обновляем
          // remoteCwd/rootPath (без переименования вкладки — см. updateRootPath/label) и,
          // если хуки уже дали доступ к удалённой ФС (Этап 4), синхронизируем дерево.
          markSshHooksAlive(changedTab)
          changedTab.remoteCwd = newPath
          changedTab.rootPath = newPath
          tabBar._updateTabLabel(changedTab)
          if (tabBar.getActive() === changedTab) {
            syncActiveFsContext()
            retargetGit(changedTab, { immediate: false })
            updateNavButtons()
          }
          return
        }

        tabBar.updateRootPath(index, newPath)
        if (tabBar.getActive()?.pid === pid) {
          if (newPath !== fileTree.getCwd() || !fileTree.isSameContext({ kind: 'local' })) {
            fileTree.setRoot(newPath, { kind: 'local' })
            api.fsSetRoot(newPath, { kind: 'local' })
          }
          retargetGit(tabBar.tabs[index], { immediate: false })
          updateNavButtons()
        }
      },
      onNodeChange: (nodePath, pid) => {
        const nodeTab = tabBar.tabs.find(t => t.pid === pid)
        if (nodeTab) updateTabNodeVersion(nodeTab, nodePath)
      },
      onBusyChange: (isBusy, pid, wasBusy) => {
        const targetTab = tabBar.tabs.find(t => t.pid === pid)
        if (!targetTab) return

        targetTab.isBusy = isBusy
        // Честный OSC 133 всегда перекрывает оптимистичное/неопределённое busy (см.
        // launchAgentInActiveTab, onPtyData): если сигнал дошёл, состояние снова достоверно.
        targetTab._busyOptimistic = false
        targetTab._oscMaybeLost = false
        if (targetTab.ssh) markSshHooksAlive(targetTab)
        if (!isBusy) targetTab.activeAgentId = null

        // Установка tmux (см. onSshTmuxMissing ниже) завершилась — команда вернула управление
        // shell'у (busy → done). Не переподключаем молча: установка могла упасть, спросить
        // надёжнее, чем гадать по коду выхода команды через OSC.
        if (targetTab._sshTmuxInstallPending && wasBusy && !isBusy) {
          targetTab._sshTmuxInstallPending = false
          confirmDialog.open({
            title: 'Установка tmux завершена?',
            message: 'Если команда установки отработала успешно — переподключиться и включить постоянные сессии?',
            confirmText: 'Переподключиться',
            cancelText: 'Не сейчас',
          }).then((confirmed) => { if (confirmed) connectSshTab(targetTab) })
        }

        if (wasBusy !== isBusy && tabBar.getActive()?.pid === pid) {
          updateNavButtons()
          syncStatusBarTerminalState()
        }
      },
    })
    oscHandler.attach(tab.term, tab.pid)
    tab._oscHandler = oscHandler
  }

  function setupTabHandlers(tab) {
    attachPidHandlers(tab)

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

    // WebGL addon — try to load for better rendering performance, fallback to canvas
    try {
      tab.term.loadAddon(new WebglAddon())
    } catch (e) {
      console.warn('WebGL addon failed, using canvas renderer:', e)
    }
  }

  /**
   * (Пере)подключает SSH-вкладку: создаёт PTY-сессию через существующий pty:create
   * (с ssh.connectionId) и пересоздаёт keyboardHandler/oscHandler под новый pid
   * (см. attachPidHandlers).
   * @param {object} tab
   * @param {{ skipShellIntegration?: boolean, isTmuxRaceRetry?: boolean }} [opts] —
   *   `skipShellIntegration` форсирует ОДНУ попытку без инжекта remote-хуков (Этап 2);
   *   используется авто-реконнектом из onPtyExit при подозрении на конфликт с
   *   RemoteCommand/ForceCommand на сервере. `isTmuxRaceRetry` — этот вызов сам является
   *   отложенным авто-повтором из onPtyExit (см. там же) — не сбрасывает счётчики ретраев,
   *   иначе они бы обнулялись на каждой собственной попытке и ограничение стало бы бессмысленным.
   */
  async function connectSshTab(tab, { skipShellIntegration = false, isTmuxRaceRetry = false } = {}) {
    if (!tab.ssh || tab._sshConnecting) return
    tab._sshConnecting = true
    try {
      const connection = sshPanel.getConnection(tab.ssh.connectionId)
      if (!tab._sshOverlay) tab._sshOverlay = new SshTabOverlay(tab.container)

      if (!connection) {
        tab._sshOverlay.showMissing(() => bus.emit('tab.close.request', { tabs: [tab] }))
        return
      }

      tab.ssh.label = connection.label
      tab.folderName = connection.label
      // Режим ЭТОГО запуска — явный tab.ssh.persistence (выбран в панели SSH/tmux при создании
      // вкладки), иначе fallback на connection.persistence (обратная совместимость с
      // восстановленными вкладками/старым кодом панели, см. shared/ssh-persistence.js).
      // Вычисляем заново на каждый (ре)коннект — нужно синхронно, ДО ответа ptyCreate, для
      // распознавания «сессию перехватил другой клиент» (exitCode 0, см. onPtyExit) — то условие,
      // которое обычный auto-reconnect не покрывает (он ждёт exitCode !== 0).
      const resolvedPersistence = resolveSshPersistence(tab.ssh, connection)
      tab.ssh.persistence = resolvedPersistence
      tab._sshPersistent = resolvedPersistence === 'tmux'
      tabBar.setTabTmux(tab, tab._sshPersistent)
      tabBar._updateTabLabel(tab)
      tab._sshOverlay.showConnecting(connection.label)
      tab.term.reset()

      if (tab._sshHookDetectTimer) {
        clearTimeout(tab._sshHookDetectTimer)
        tab._sshHookDetectTimer = null
      }
      // Обычная (не авто-реконнектная) попытка — даём шанс на новый авто-реконнект,
      // если и эта тоже быстро упадёт. Собственные отложенные повторы (isTmuxRaceRetry) не
      // сбрасывают ни этот, ни tmux-race-счётчик ниже — иначе ограничение попыток было бы
      // бессмысленным (обнулялось бы прямо перед использованием).
      if (!skipShellIntegration && !isTmuxRaceRetry) tab._sshHookRetried = false
      if (!isTmuxRaceRetry) tab._sshTmuxRaceRetries = 0

      let result
      try {
        result = await api.ptyCreate({
          cols: tab.term.cols || TERMINAL_CONFIG.DEFAULT_COLS,
          rows: tab.term.rows || TERMINAL_CONFIG.DEFAULT_ROWS,
          cwd: tab.rootPath,
          tabId: tab.tabId,
          ssh: { connectionId: connection.id, skipShellIntegration, sessionName: tab.ssh.sessionName, persistence: resolvedPersistence },
        })
      } catch (e) {
        result = { error: e.message }
      }

      if (!result || result.error) {
        console.error('[connectSshTab] Failed to connect', tab.ssh.connectionId, result?.error)
        tab._sshOverlay.showError(connection.label, null, () => connectSshTab(tab))
        return
      }

      tab.pid = result.pid
      tab._sshEverConnected = true
      tab._sshConnectedAt = Date.now()
      tab._sshHooksAlive = false
      // Main — источник истины на случай fallback-разночтения (см. resolveSshPersistence) —
      // маловероятно после resolvedPersistence выше, но самосогласованность важнее допущения.
      if (result.persistence && result.persistence !== tab.ssh.persistence) {
        tab.ssh.persistence = result.persistence
        tab._sshPersistent = result.persistence === 'tmux'
        tabBar.setTabTmux(tab, tab._sshPersistent)
      }
      // Панель SSH/tmux: клиент на сервере появится чуть позже (auth + attach) — панель сама
      // выдерживает паузу и дебаунсит вместе с ssh:fs-ready ниже по цепочке.
      if (tab._sshPersistent) bus.emit('ssh.session.activity', { connectionId: connection.id })
      // Новый pid — предыдущий результат ssh:fs-ready относился к прошлой попытке
      tab._sshFsAvailable = undefined
      tab._sshFsReason = null
      // Новая попытка подключения — если пользователь отказался ставить tmux в прошлый раз,
      // предложение должно появиться снова (сервер мог измениться, или человек передумал).
      tab._sshTmuxInstallOffered = false
      tab._sshTmuxInstallPending = false
      // Хуки отключены для этой попытки (авто-реконнект) либо для подключения целиком —
      // сразу включаем оптимистичный busy (Этап 1), не дожидаясь детект-таймаута.
      tab._sshHooksMissing = skipShellIntegration || connection.injectShellIntegration === false
      tabBar.syncStore()
      attachPidHandlers(tab)

      if (!tab._sshHooksMissing) {
        const connectedPid = result.pid
        tab._sshHookDetectTimer = setTimeout(() => {
          tab._sshHookDetectTimer = null
          if (!tab._sshHooksAlive && tab.pid === connectedPid) {
            tab._sshHooksMissing = true
          }
        }, APP_CONFIG.SSH_HOOK_DETECT_TIMEOUT_MS)
      }
    } finally {
      tab._sshConnecting = false
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

  /**
   * Восстанавливает состояние ИИ-агента вкладки из tabs-state.json (activeAgentId/isBusy,
   * см. tab-bar.js exportState). Применяется ТОЛЬКО для tmux-вкладок: лишь персистентная
   * сессия сохраняет живой процесс агента между запусками eTty. Для локальных и обычных
   * SSH-вкладок шелл при рестарте создаётся заново — состояние агента сбрасывается.
   * Фактическое наличие агента позже подтверждает ресинк tmux (onSshSessionState).
   */
  const applySavedAgentState = (tab, saved) => {
    const isTmux = saved?.ssh?.persistence === 'tmux'
    if (!isTmux) {
      tab.isBusy = false
      tab.activeAgentId = null
      return
    }
    tab.isBusy = !!saved.isBusy
    tab.activeAgentId = saved.activeAgentId || null
    // busy tmux-вкладки всегда оптимистичный (честного OSC 133 при re-attach не бывает) —
    // даёт право на ручной сброс крестиком в панели быстрых команд.
    tab._busyOptimistic = tab.isBusy
  }

  // Restore tabs from saved state (used by menu trigger)
  async function restoreTabs(savedTabs) {
    // Create new tabs first
    const oldCount = tabBar.tabs.length
    let activeIndex = oldCount
    let addedCount = 0
    isRestoringTabs = true
    try {
      for (let i = 0; i < savedTabs.length; i++) {
        let tabData
        try {
          const sshInfo = savedTabs[i].ssh ? { ...savedTabs[i].ssh, remoteCwd: savedTabs[i].remoteCwd || null } : null
          tabData = await createTab(api, savedTabs[i].rootPath, savedTabs[i].tabId, sshInfo)
        } catch (e) {
          console.error('[restoreTabs] Failed to restore tab', savedTabs[i].rootPath, e.message)
          continue
        }
        const tab = tabBar.addTab(tabData)
        applySavedAgentState(tab, savedTabs[i])
        tab._savedEditorState = savedTabs[i].editorState || null
        tab.gitPanelVisible = savedTabs[i].gitPanelVisible || false
        setupTabHandlers(tab)
        tab.fitAddon.fit()
        addedCount++
        if (savedTabs[i].isActive) activeIndex = oldCount + i
      }
      // Ни одной вкладки не удалось создать (например, PTY недоступен) — оставляем
      // старые вкладки нетронутыми вместо того, чтобы удалить их и остаться без ничего.
      if (addedCount === 0) return
      // Switch to restored active tab
      tabBar.switchTo(activeIndex)
      // Remove old tabs (in reverse to keep indices stable)
      for (let i = oldCount - 1; i >= 0; i--) {
        const tab = tabBar.tabs[i]
        tab._sshOverlay?.destroy()
        if (tab.pid != null) api.ptyKill(tab.pid)
        tab.term.dispose()
        tab.container.remove()
        tab.element.remove()
        tabBar.tabs.splice(i, 1)
        if (tabBar.activeIndex > i) tabBar.activeIndex--
      }
      tabBar.switchTo(tabBar.activeIndex)
    } finally {
      isRestoringTabs = false
    }
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
      openGitPanelForTab(activeRestored)
    }
    // Подключаем только активную восстановленную SSH-вкладку (см. isRestoringTabs выше)
    if (activeRestored?.ssh && !activeRestored._sshEverConnected) {
      connectSshTab(activeRestored)
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
        isRestoringTabs = true
        try {
          for (let i = 0; i < savedTabs.length; i++) {
            let tabData
            try {
              const sshInfo = savedTabs[i].ssh ? { ...savedTabs[i].ssh, remoteCwd: savedTabs[i].remoteCwd || null } : null
              tabData = await createTab(api, savedTabs[i].rootPath, savedTabs[i].tabId, sshInfo)
            } catch (e) {
              console.error('[Init] Failed to restore tab', savedTabs[i].rootPath, e.message)
              continue
            }
            const tab = tabBar.addTab(tabData)
            applySavedAgentState(tab, savedTabs[i])
            tab._savedEditorState = savedTabs[i].editorState || null
            tab.gitPanelVisible = savedTabs[i].gitPanelVisible || false
            setupTabHandlers(tab)
            tab.fitAddon.fit()
            if (savedTabs[i].isActive) activeIndex = i
          }
          if (savedTabs.length > 0) tabBar.switchTo(activeIndex)
        } finally {
          isRestoringTabs = false
        }
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
          openGitPanelForTab(activeTab)
        }
        // Подключаем только активную восстановленную SSH-вкладку (lazy connect для остальных)
        if (activeTab?.ssh && !activeTab._sshEverConnected) {
          connectSshTab(activeTab)
        }
        // Если все вкладки не удалось восстановить (см. catch выше), tabBar пуст —
        // считаем, что восстановление не удалось, и даём шанс запасному локальному табу ниже.
        restored = tabBar.tabs.length > 0
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

  btnToggleSsh.addEventListener('click', () => {
    if (settingsPage.isVisible() || gitPanel.isVisible()) return
    appStore.set('ui.sshPanelVisible', !appStore.get('ui.sshPanelVisible'))
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
    // Cmd+Shift+G / Ctrl+Shift+G — toggle git-панели (открыть/закрыть)
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'g') {
      if (document.activeElement?.closest('#editor-body')) return
      if (settingsPage.isVisible()) return
      e.preventDefault()
      appStore.set('ui.gitPanelVisible', !appStore.get('ui.gitPanelVisible'))
    }
    if (tabSwitchHotkey !== 'none' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const modMatch =
        (tabSwitchHotkey === 'cmd-option' && e.metaKey && e.altKey && !e.ctrlKey && !e.shiftKey) ||
        (tabSwitchHotkey === 'cmd-shift' && e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey)
      if (modMatch) {
        // Не перехватываем в редакторе — там стрелки с модификатором двигают курсор
        if (document.activeElement?.closest('#editor-body')) return
        if (settingsPage.isVisible() || gitPanel.isVisible()) return
        e.preventDefault()
        tabBar.switchRelative(e.key === 'ArrowRight' ? 1 : -1)
      }
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

  // Resize handle для панели SSH — направление зависит от текущей позиции (left/right)
  resizeHandleSsh.addEventListener('mousedown', (e) => {
    e.preventDefault()
    resizeHandleSsh.classList.add('dragging')
    const startX = e.clientX
    const startWidth = sshPanel._panelEl.offsetWidth
    const isLeft = sshPanelPosition === 'left'
    const onMove = (e) => {
      const delta = isLeft ? (e.clientX - startX) : -(e.clientX - startX)
      const newWidth = Math.max(
        APP_CONFIG.SSH_PANEL_MIN_WIDTH,
        Math.min(APP_CONFIG.SSH_PANEL_MAX_WIDTH, startWidth + delta)
      )
      sshPanel._panelEl.style.width = newWidth + 'px'
      tabBar.getActive()?.fitAddon.fit()
    }
    const onUp = () => {
      resizeHandleSsh.classList.remove('dragging')
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
