import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { FileTree } from './file-tree.js'
import { TabBar } from './tab-bar.js'

const TERM_THEME = {
  background: '#1e1e2e',
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  selectionBackground: '#585b70',
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#cba6f7',
  cyan: '#94e2d5',
  white: '#bac2de',
  brightBlack: '#585b70',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#cba6f7',
  brightCyan: '#94e2d5',
  brightWhite: '#a6adc8'
}

async function createTab(cwd) {
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, "SF Mono", Consolas, "Courier New", monospace',
    scrollback: 10000,
    allowProposedApi: true,
    theme: TERM_THEME
  })

  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.loadAddon(new WebLinksAddon())
  term.loadAddon(new SearchAddon())

  const { pid } = await window.electronAPI.ptyCreate({ cols: 80, rows: 24, cwd })

  return { term, fitAddon, pid, rootPath: cwd }
}

async function init() {
  const terminalContainerEl = document.getElementById('terminal-container')
  const tabBarEl = document.getElementById('tab-bar')
  const fileTreeContainerEl = document.getElementById('file-tree-container')
  const btnUp = document.getElementById('btn-up')
  const btnHome = document.getElementById('btn-home')
  const btnToggleHidden = document.getElementById('btn-toggle-hidden')

  const { cwd: startCwd } = await window.electronAPI.getCwd()

  // FileTree получает активный writeToPty через замыкание на tabBar
  const writeToPtyActive = (data) => {
    const tab = tabBar.getActive()
    if (tab) window.electronAPI.ptyWrite(tab.pid, '\r\x1b[2K' + data)
  }

  const fileTree = new FileTree(fileTreeContainerEl, writeToPtyActive)
  await fileTree.init(startCwd)

  function updateNavButtons() {
    const tab = tabBar.getActive()
    const busy = tab?.isBusy ?? false
    btnUp.disabled = busy || (tab?.rootPath === '/')
    btnHome.disabled = busy
    fileTree.setIsBusy(busy)
  }

  const tabBar = new TabBar({
    tabBarEl,
    terminalContainerEl,
    onSwitch: (tab) => {
      if (tab.rootPath !== fileTree.getCwd()) {
        fileTree.setRoot(tab.rootPath)
        window.electronAPI.fsSetRoot(tab.rootPath)
      }
      document.title = tab.termTitle || 'eTty'
      updateNavButtons()
    },
    onAddTab: async () => {
      const active = tabBar.getActive()
      const cwd = active ? active.rootPath : startCwd
      const tabData = await createTab(cwd)
      const tab = tabBar.addTab(tabData)
      tab.isBusy = false
      setupTabHandlers(tab)
    },
    onCloseTab: (index) => {
      const tab = tabBar.tabs[index]
      tabBar.removeTab(index)
      window.electronAPI.ptyKill(tab.pid)
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

  // Первый таб
  const firstTabData = await createTab(startCwd)
  const firstTab = tabBar.addTab(firstTabData)
  firstTab.isBusy = false
  setupTabHandlers(firstTab)

  // Кнопки навигации сайдбара
  btnUp.disabled = startCwd === '/'
  btnUp.addEventListener('click', () => writeToPtyActive('cd ..\n'))
  btnHome.addEventListener('click', () => writeToPtyActive('cd ~\n'))

  let showHidden = false
  btnToggleHidden.addEventListener('click', () => {
    showHidden = !showHidden
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
  const sidebar = document.getElementById('sidebar')
  const resizeHandle = document.getElementById('resize-handle')
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

  // ResizeObserver — подгонка активного терминала при изменении размера
  new ResizeObserver(() => tabBar.getActive()?.fitAddon.fit()).observe(terminalContainerEl)
}

init()
