import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { FileTree } from './file-tree.js'
import { TabBar } from './tab-bar.js'
import { THEMES } from './themes.js'
import { SettingsPage } from './settings-page.js'
import { StatusBar } from './status-bar.js'
import { GitPanel } from './git-panel.js'
import { EditorPanel } from './editor-panel.js'
import { Icons } from './icons.js'

let currentThemeName = 'dark'
let loadedThemes = THEMES
/** @type {TabBar|null} */
let tabBar = null
/** @type {EditorPanel|null} */
let editorPanel = null

/** Применяет стиль индикатора фокуса через data-атрибут на корневом элементе. */
function applyFocusIndicator(style) {
  document.documentElement.dataset.focusStyle = style || 'none'
}

/** Применяет тему: обновляет CSS-переменные, терминалы и редактор. */
function applyTheme(themeName) {
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

/** Создаёт новую вкладку: Terminal + FitAddon + PTY-сессия. */
async function createTab(cwd, tabId) {
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, "SF Mono", Consolas, "Courier New", monospace',
    scrollback: 10000,
    allowProposedApi: true,
    theme: loadedThemes[currentThemeName].terminal
  })

  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.loadAddon(new WebLinksAddon())
  term.loadAddon(new SearchAddon())

  tabId = tabId || crypto.randomUUID()
  const { config } = await window.electronAPI.settingsLoad()
  const promptStyle = config.terminal?.promptStyle || 'default'
  const { pid } = await window.electronAPI.ptyCreate({ cols: 80, rows: 24, cwd, tabId, promptStyle })

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

  editorPanel = new EditorPanel({
    panelEl: document.getElementById('editor-panel'),
    resizeHandleEl: document.getElementById('resize-handle-right'),
    onResize: () => tabBar.getActive()?.fitAddon.fit(),
    onShow: () => btnToggleEditor.classList.add('active'),
    onHide: () => {
      btnToggleEditor.classList.remove('active')
      tabBar.getActive()?.term.focus()
    },
    writeToPty: writeToPtyActive,
    shellCmdToPty: shellCmdToPtyActive,
    getActiveCwd: () => tabBar.getActive()?.rootPath || startCwd,
  })
  // Apply current theme immediately (applyTheme ran before editorPanel was created)
  const _initialTheme = loadedThemes[currentThemeName]
  if (_initialTheme?.editor) editorPanel.setTheme(_initialTheme.editor)

  const fileTree = new FileTree(fileTreeContainerEl, {
    writeToPty: shellCmdToPtyActive,
    injectToPty: writeToPtyActive,
    focusTerminal: focusActiveTerminal,
    onFileOpen: (filePath) => editorPanel.openFile(filePath),
    runInNewTab: async (filePath) => {
      const tabData = await createTab(tabBar.getActive()?.rootPath || startCwd)
      const tab = tabBar.addTab(tabData)
      tab.isBusy = false
      tab.activeAgentId = null
      setupTabHandlers(tab)
      tab.fitAddon.fit()
      window.electronAPI.ptyWrite(tab.pid, filePath + '\n')
    },
  })
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

  tabBar = new TabBar({
    tabBarEl,
    terminalContainerEl,
    onSwitch: async (tab, prevTab) => {
      if (settingsPage.isVisible()) return
      // Очищаем все watchers перед сменой вкладки
      fileTree.unwatchAll()
      if (prevTab) {
        prevTab.treeExpandedDirs = fileTree.getExpandedDirs()
        prevTab.treeScrollTop = fileTree.getScrollTop()
        prevTab.editorState = editorPanel.suspendState()
        prevTab.gitPanelVisible = gitPanel.isVisible()
      }
      // Скрыть git-панель без side-effects перед переключением
      if (gitPanel.isVisible()) gitPanel.hideQuiet()
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
      }
      document.title = tab.termTitle || 'eTty'
      updateNavButtons()
      syncStatusBarTerminalState()
      statusBar.updateNow()
    },
    onAddTab: async () => {
      if (settingsPage.isVisible()) return
      const active = tabBar.getActive()
      const cwd = active ? active.rootPath : startCwd
      const tabData = await createTab(cwd)
      const tab = tabBar.addTab(tabData)
      tab.isBusy = false
      tab.activeAgentId = null
      setupTabHandlers(tab)
      tab.fitAddon.fit()
    },
    onCloseTab: (index) => {
      if (settingsPage.isVisible()) return
      const tab = tabBar.tabs[index]
      // Destroy suspended editor views to prevent memory leaks
      if (tab.editorState?._detachedTabs) {
        for (const [, etab] of tab.editorState._detachedTabs) {
          etab.view.destroy()
        }
      }
      tabBar.removeTab(index)
      window.electronAPI.ptyKill(tab.pid)
    }
  })

  // Страница настроек
  const settingsPage = new SettingsPage({
    onSettingsChanged: (key, value) => {
      if (key === 'appearance.theme') applyTheme(value)
      if (key === 'appearance.focusIndicator') applyFocusIndicator(value)
      if (key === 'fileTree.collapseChildrenOnClose') fileTree.setCollapseChildrenOnClose(value)
      if (key === 'fileTree.fileOpenMode') fileTree.setFileOpenMode(value)
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
    },
    onClose: () => {
      btnSettings.classList.remove('active')
      tabBar.disabled = false
      focusActiveTerminal()
    }
  })
  await settingsPage.init()

  const gitPanel = new GitPanel({
    overlayEl: document.getElementById('git-overlay'),
    onClose: () => statusBar.updateNow(),
  })

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

  const selectAgentAsActive = (agentId) => {
    const tab = tabBar.getActive()
    if (!tab || !tab.isBusy) return
    tab.activeAgentId = agentId
    syncStatusBarTerminalState()
  }

  const statusBar = new StatusBar({
    btnEl: document.getElementById('btn-git-diff'),
    cwdEl: document.getElementById('status-cwd'),
    nodeEl: document.getElementById('status-node'),
    onOpen: () => gitPanel.show(tabBar.getActive()?.rootPath),
    agentButtons: [...document.querySelectorAll('.status-agent-btn')],
    onLaunchAgent: launchAgentInActiveTab,
    onSelectAgent: selectAgentAsActive,
    agentCommandsPanelEl: document.getElementById('agent-commands-panel'),
    onAgentCommand: (cmd) => {
      const tab = tabBar.getActive()
      if (tab) {
        tab.term.focus()
        window.electronAPI.ptyWrite(tab.pid, `\x1b[200~${cmd + ''}\x1b[201~`)
      }
    },
    proxyToggleEl: document.getElementById('btn-proxy-toggle'),
    onToggleProxy: (enabled) => {
      config.agents.proxyEnabled = enabled
      window.electronAPI.settingsSave(config)
    },
    quickReplies: config.quickReplies || { items: [] }
  })

  const agentsStatus = await window.electronAPI.agentsGetStatus().catch(() => ({ agents: [] }))
  applyAgentCommands(agentsStatus)
  statusBar.setAgentsStatus(agentsStatus)
  statusBar.setForceDisabled(config.agents?.forceDisabled || {})
  statusBar.setProxyConfig({ proxy: config.agents.proxy || '', enabled: config.agents.proxyEnabled })

  statusBar.start(() => tabBar.getActive()?.rootPath)

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

  // Глобальные IPC обработчики — маршрутизируют по pid
  window.electronAPI.onPtyData((pid, data) => {
    const tab = tabBar.tabs.find(t => t.pid === pid)
    if (tab) tab.term.write(data)
  })

  window.electronAPI.onPtyExit(({ pid }) => {
    const index = tabBar.tabs.findIndex(t => t.pid === pid)
    if (index >= 0) tabBar.removeTab(index)
  })

  /**
   * Настраивает обработчики для вкладки:
   * - Kitty keyboard protocol (modifier+Enter)
   * - Non-ASCII символы (кириллица) — ручная отправка в PTY
   * - Terminal → PTY data/resize/title
   * - OSC 7 (cwd sync) и OSC 133 (busy tracking)
   * - WebGL addon
   */
  function setupTabHandlers(tab) {
    // Kitty keyboard protocol: перехватываем modifier+Enter до xterm.js
    tab.term.attachCustomKeyEventHandler((event) => {
      if (event.key === 'Enter') {
        if (event.shiftKey && !event.ctrlKey) {
          if (event.type === 'keydown') window.electronAPI.ptyWrite(tab.pid, '\x1b[13;2u')
          return false
        }
        if (event.ctrlKey && !event.shiftKey) {
          if (event.type === 'keydown') window.electronAPI.ptyWrite(tab.pid, '\x1b[13;5u')
          return false
        }
        if (event.ctrlKey && event.shiftKey) {
          if (event.type === 'keydown') window.electronAPI.ptyWrite(tab.pid, '\x1b[13;6u')
          return false
        }
      }
      // Не-ASCII печатаемые символы (кириллица, акцентированные буквы и т.д.):
      // xterm.js не устанавливает _keyDownHandled корректно в non-screenReader режиме,
      // из-за чего _keyPress повторно обрабатывает событие с неверным charCode на macOS.
      // Отправляем символ вручную и блокируем xterm.js-обработку.
      if (event.key.length === 1 && event.key.charCodeAt(0) > 127 &&
          !event.ctrlKey && !event.altKey && !event.metaKey) {
        if (event.type === 'keydown') window.electronAPI.ptyWrite(tab.pid, event.key)
        return false
      }
      return true
    })

    // Ввод: терминал → PTY
    tab.term.onData((data) => {
      window.electronAPI.ptyWrite(tab.pid, data)
    })

    // Resize: терминал → PTY
    tab.term.onResize(({ cols, rows }) => {
      window.electronAPI.ptyResize(tab.pid, cols, rows)
    })

    // Заголовок окна — только для активного таба
    tab.term.onTitleChange((title) => {
      if (tabBar.getActive()?.pid === tab.pid) {
        document.title = title || 'eTty'
      }
    })

    // OSC 7 — синхронизация директории
    tab.term.parser.registerOscHandler(7, (data) => {
      const match = data.match(/^file:\/\/[^/]*(.+)$/)
      if (match) {
        const newPath = match[1].replace(/\/$/, '') || '/'
        const index = tabBar.tabs.findIndex(t => t.pid === tab.pid)
        if (index >= 0) tabBar.updateRootPath(index, newPath)

        if (tabBar.getActive()?.pid === tab.pid) {
          if (newPath !== fileTree.getCwd()) {
            fileTree.setRoot(newPath)
            window.electronAPI.fsSetRoot(newPath)
          }
          updateNavButtons()
        }
      }
      return false
    })

    // OSC 133 — отслеживание занятости терминала
    tab.term.parser.registerOscHandler(133, (data) => {
      const wasBusy = tab.isBusy
      if (data.startsWith('C')) tab.isBusy = true
      else if (data.startsWith('A')) {
        tab.isBusy = false
        tab.activeAgentId = null
      }
      if (wasBusy !== tab.isBusy && tabBar.getActive()?.pid === tab.pid) {
        updateNavButtons()
        syncStatusBarTerminalState()
      }
      return false
    })

    // WebGL — загружается после term.open()
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

  let sidebarVisible = true
  btnToggleSidebar.classList.add('active')
  btnToggleSidebar.addEventListener('click', () => {
    if (settingsPage.isVisible() || gitPanel.isVisible()) return
    sidebarVisible = !sidebarVisible
    sidebar.style.display = sidebarVisible ? '' : 'none'
    resizeHandle.style.display = sidebarVisible ? '' : 'none'
    btnToggleSidebar.classList.toggle('active', sidebarVisible)
    tabBar.getActive()?.fitAddon.fit()
  })

  btnToggleEditor.addEventListener('click', () => {
    if (settingsPage.isVisible() || gitPanel.isVisible()) return
    editorPanel.toggle()
    btnToggleEditor.classList.toggle('active', editorPanel.isVisible())
  })

  // Горячая клавиша Cmd+E / Ctrl+E — toggle панели редактора
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'e' && !e.shiftKey && !e.altKey) {
      // Не перехватываем, если фокус в CodeMirror (он сам обработает)
      if (document.activeElement?.closest('#editor-body')) return
      if (settingsPage.isVisible() || gitPanel.isVisible()) return
      e.preventDefault()
      editorPanel.toggle()
      btnToggleEditor.classList.toggle('active', editorPanel.isVisible())
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
    if (!titlebarDidDrag && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
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
      const newWidth = Math.max(150, Math.min(600, startWidth + e.clientX - startX))
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
      const newWidth = Math.max(250, Math.min(window.innerWidth * 0.8, startWidth - (e.clientX - startX)))
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
  new ResizeObserver(() => tabBar.getActive()?.fitAddon.fit()).observe(terminalContainerEl)
}

init()
