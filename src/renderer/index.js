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

let currentThemeName = 'catppuccin-mocha'
let tabBar = null
let editorPanel = null

function applyTheme(themeName) {
  const theme = THEMES[themeName]
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

async function createTab(cwd, tabId) {
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, "SF Mono", Consolas, "Courier New", monospace',
    scrollback: 10000,
    allowProposedApi: true,
    theme: THEMES[currentThemeName].terminal
  })

  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.loadAddon(new WebLinksAddon())
  term.loadAddon(new SearchAddon())

  tabId = tabId || crypto.randomUUID()
  const { pid } = await window.electronAPI.ptyCreate({ cols: 80, rows: 24, cwd, tabId })

  return { term, fitAddon, pid, rootPath: cwd, tabId }
}

async function init() {
  // Загружаем настройки до инициализации всего остального
  const settings = await window.electronAPI.settingsLoad()
  applyTheme(settings.appearance.theme)

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

  const focusActiveTerminal = () => {
    const tab = tabBar.getActive()
    if (tab) tab.term.focus()
  }

  const writeToPtyActive = (data) => {
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
    writeToPty: writeToPtyActive,
    getActiveCwd: () => tabBar.getActive()?.rootPath || startCwd,
  })
  // Apply current theme immediately (applyTheme ran before editorPanel was created)
  const _initialTheme = THEMES[currentThemeName]
  if (_initialTheme?.editor) editorPanel.setTheme(_initialTheme.editor)

  const fileTree = new FileTree(fileTreeContainerEl, {
    writeToPty: writeToPtyActive,
    focusTerminal: focusActiveTerminal,
    onFileOpen: (filePath) => editorPanel.openFile(filePath),
  })
  await fileTree.init(startCwd)
  fileTree.setCollapseChildrenOnClose(settings.fileTree.collapseChildrenOnClose)
  fileTree.setFileOpenMode(settings.fileTree.fileOpenMode || 'double')

  function updateNavButtons() {
    const tab = tabBar.getActive()
    const busy = tab?.isBusy ?? false
    btnUp.disabled = busy || (tab?.rootPath === '/')
    btnHome.disabled = busy
    fileTree.setIsBusy(busy)
  }

  tabBar = new TabBar({
    tabBarEl,
    terminalContainerEl,
    onSwitch: async (tab, prevTab) => {
      if (prevTab) {
        prevTab.treeExpandedDirs = fileTree.getExpandedDirs()
        prevTab.treeScrollTop = fileTree.getScrollTop()
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
      document.title = tab.termTitle || 'eTty'
      updateNavButtons()
      statusBar.updateNow()
    },
    onAddTab: async () => {
      const active = tabBar.getActive()
      const cwd = active ? active.rootPath : startCwd
      const tabData = await createTab(cwd)
      const tab = tabBar.addTab(tabData)
      tab.isBusy = false
      setupTabHandlers(tab)
      tab.fitAddon.fit()
    },
    onCloseTab: (index) => {
      const tab = tabBar.tabs[index]
      tabBar.removeTab(index)
      window.electronAPI.ptyKill(tab.pid)
    }
  })

  // Страница настроек
  const settingsPage = new SettingsPage({
    onSettingsChanged: (key, value) => {
      if (key === 'appearance.theme') applyTheme(value)
      if (key === 'fileTree.collapseChildrenOnClose') fileTree.setCollapseChildrenOnClose(value)
      if (key === 'fileTree.fileOpenMode') fileTree.setFileOpenMode(value)
    }
  })
  await settingsPage.init()

  const gitPanel = new GitPanel({
    overlayEl: document.getElementById('git-overlay'),
    onClose: () => statusBar.updateNow(),
  })

  const statusBar = new StatusBar({
    btnEl: document.getElementById('btn-git-diff'),
    onOpen: () => gitPanel.show(tabBar.getActive()?.rootPath),
  })

  statusBar.start(() => tabBar.getActive()?.rootPath)

  btnSettings.addEventListener('click', () => {
    if (settingsPage.isVisible()) {
      settingsPage.hide()
      btnSettings.classList.remove('active')
    } else {
      settingsPage.show()
      btnSettings.classList.add('active')
    }
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
      else if (data.startsWith('A')) tab.isBusy = false
      if (wasBusy !== tab.isBusy && tabBar.getActive()?.pid === tab.pid) {
        updateNavButtons()
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
  window.__exportTabState = () => tabBar.exportState()

  // Restore tabs from saved state (used by menu trigger)
  async function restoreTabs(savedTabs) {
    // Create new tabs first
    const oldCount = tabBar.tabs.length
    let activeIndex = oldCount
    for (let i = 0; i < savedTabs.length; i++) {
      const tabData = await createTab(savedTabs[i].rootPath, savedTabs[i].tabId)
      const tab = tabBar.addTab(tabData)
      tab.isBusy = false
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
          setupTabHandlers(tab)
          tab.fitAddon.fit()
          if (savedTabs[i].isActive) activeIndex = i
        }
        if (savedTabs.length > 0) tabBar.switchTo(activeIndex)
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
    setupTabHandlers(firstTab)
    firstTab.fitAddon.fit()
  }

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

  // Кнопки навигации сайдбара
  btnUp.disabled = startCwd === '/'
  btnUp.addEventListener('click', () => writeToPtyActive('cd ..\n'))
  btnHome.addEventListener('click', () => writeToPtyActive('cd ~\n'))

  let sidebarVisible = true
  btnToggleSidebar.addEventListener('click', () => {
    sidebarVisible = !sidebarVisible
    sidebar.style.display = sidebarVisible ? '' : 'none'
    resizeHandle.style.display = sidebarVisible ? '' : 'none'
    tabBar.getActive()?.fitAddon.fit()
  })

  btnToggleEditor.addEventListener('click', () => {
    editorPanel.toggle()
    btnToggleEditor.classList.toggle('active', editorPanel.isVisible())
  })

  // Горячая клавиша Cmd+E / Ctrl+E — toggle панели редактора
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'e' && !e.shiftKey && !e.altKey) {
      // Не перехватываем, если фокус в CodeMirror (он сам обработает)
      if (document.activeElement?.closest('#editor-body')) return
      e.preventDefault()
      editorPanel.toggle()
      btnToggleEditor.classList.toggle('active', editorPanel.isVisible())
    }
  })

  const eyeOffSVG = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/><line x1="2" y1="2" x2="14" y2="14"/></svg>`
  const eyeOpenSVG = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>`

  btnToggleHidden.innerHTML = eyeOffSVG

  let showHidden = false
  btnToggleHidden.addEventListener('click', () => {
    showHidden = !showHidden
    btnToggleHidden.innerHTML = showHidden ? eyeOpenSVG : eyeOffSVG
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

  // Отменяем click по вкладке если был drag
  titlebarEl.addEventListener('click', (e) => {
    if (titlebarDidDrag) {
      e.stopImmediatePropagation()
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
