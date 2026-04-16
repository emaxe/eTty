import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import './styles.css'

async function init() {
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, "SF Mono", Consolas, "Courier New", monospace',
    scrollback: 10000,
    allowProposedApi: true,
    theme: {
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
  })

  // Аддоны
  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.loadAddon(new WebLinksAddon())
  term.loadAddon(new SearchAddon())

  // Монтирование в DOM
  const container = document.getElementById('terminal-container')
  term.open(container)

  // WebGL — с fallback на canvas
  try {
    term.loadAddon(new WebglAddon())
  } catch (e) {
    console.warn('WebGL addon failed, using canvas renderer:', e)
  }

  // Начальная подгонка размера
  fitAddon.fit()

  // Создание PTY-сессии
  const cwd = await window.electronAPI.getHomedir()
  const { pid } = await window.electronAPI.ptyCreate({
    cols: term.cols,
    rows: term.rows,
    cwd
  })

  // Ввод: терминал → PTY
  term.onData((data) => {
    window.electronAPI.ptyWrite(pid, data)
  })

  // Resize: терминал → PTY
  term.onResize(({ cols, rows }) => {
    window.electronAPI.ptyResize(pid, cols, rows)
  })

  // Вывод: PTY → терминал
  window.electronAPI.onPtyData((data) => {
    term.write(data)
  })

  // Завершение PTY
  window.electronAPI.onPtyExit(({ exitCode }) => {
    term.write(`\r\n[Process exited with code ${exitCode}]\r\n`)
    setTimeout(() => window.close(), 1000)
  })

  // Обновление заголовка окна
  term.onTitleChange((title) => {
    document.getElementById('title').textContent = title || 'eTty'
  })

  // ResizeObserver — после всех обработчиков, чтобы onResize мог отправить resize в PTY
  new ResizeObserver(() => fitAddon.fit()).observe(container)

  // Фокус на терминал
  term.focus()
}

init()
