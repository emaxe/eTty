# eTty Stage 1: Базовая обёртка терминала — План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать минимально рабочее Electron-приложение с полнофункциональным терминалом (xterm.js + node-pty).

**Architecture:** Electron main process управляет PTY-сессиями через node-pty, renderer рендерит терминал через xterm.js. Коммуникация — через IPC с contextBridge (contextIsolation: true). Сборка — electron-vite.

**Tech Stack:** Electron, electron-vite, xterm.js, node-pty, addon-fit, addon-webgl, addon-web-links, addon-search

**Spec:** `docs/superpowers/specs/2026-04-15-terminal-wrapper-stage1-design.md`
**Knowledge base:** `docs/kb/`

---

## Структура файлов

```
src/
├── main/
│   ├── index.js          — app lifecycle, BrowserWindow, IPC handlers
│   └── pty-manager.js    — класс PtyManager: spawn/write/resize/kill PTY-сессий
├── preload/
│   └── index.js          — contextBridge: expose electronAPI в renderer
└── renderer/
    ├── index.html        — кастомный titlebar + контейнер терминала
    ├── index.js          — инициализация xterm.js, аддоны, IPC-привязка
    └── styles.css        — стили titlebar и контейнера
electron.vite.config.mjs  — конфигурация electron-vite
package.json
```

---

## Task 1: Инициализация проекта

**Files:**
- Create: `package.json`
- Create: `electron.vite.config.mjs`

- [ ] **Step 1: Создать package.json**

```json
{
  "name": "etty",
  "version": "0.1.0",
  "description": "Terminal wrapper application",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "postinstall": "electron-rebuild"
  },
  "dependencies": {
    "@xterm/xterm": "^5.5.0",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-webgl": "^0.18.0",
    "@xterm/addon-web-links": "^0.11.0",
    "@xterm/addon-search": "^0.15.0",
    "node-pty": "^1.0.0"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-vite": "^2.4.0",
    "electron-rebuild": "^3.2.0"
  }
}
```

- [ ] **Step 2: Установить зависимости**

Run: `npm install`

Expected: Все пакеты установлены. `postinstall` запускает `electron-rebuild` — node-pty пересобирается под Electron. Вывод содержит `✔ Rebuild Complete`.

Если `electron-rebuild` падает — проверить что установлены Xcode Command Line Tools (`xcode-select --install`).

- [ ] **Step 3: Создать electron.vite.config.mjs**

```js
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {}
})
```

`externalizeDepsPlugin()` исключает нативные модули (node-pty) из бандла main и preload.

- [ ] **Step 4: Создать .gitignore**

```
node_modules/
out/
dist/
.DS_Store
*.log
```

- [ ] **Step 5: Создать директории**

Run: `mkdir -p src/main src/preload src/renderer`

- [ ] **Step 6: Commit**

```bash
git init
git add package.json package-lock.json electron.vite.config.mjs .gitignore
git commit -m "init: project setup with electron-vite, xterm.js, node-pty"
```

---

## Task 2: PTY Manager

**Files:**
- Create: `src/main/pty-manager.js`

- [ ] **Step 1: Написать PtyManager**

```js
import { spawn } from 'node-pty'

const SHELL_PATH = '/bin/zsh'

export class PtyManager {
  constructor() {
    this.sessions = new Map()
  }

  create({ cols, rows, cwd, webContents }) {
    const ptyProcess = spawn(SHELL_PATH, [], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd,
      env: process.env
    })

    this.sessions.set(ptyProcess.pid, { pty: ptyProcess, webContents })

    ptyProcess.onData((data) => {
      if (!webContents.isDestroyed()) {
        webContents.send('pty:data', data)
      }
    })

    ptyProcess.onExit(({ exitCode, signal }) => {
      if (!webContents.isDestroyed()) {
        webContents.send('pty:exit', { pid: ptyProcess.pid, exitCode, signal })
      }
      this.sessions.delete(ptyProcess.pid)
    })

    return { pid: ptyProcess.pid }
  }

  write(pid, data) {
    this.sessions.get(pid)?.pty.write(data)
  }

  resize(pid, cols, rows) {
    this.sessions.get(pid)?.pty.resize(cols, rows)
  }

  kill(pid) {
    const session = this.sessions.get(pid)
    if (session) {
      session.pty.kill()
      this.sessions.delete(pid)
    }
  }

  killAll() {
    for (const [, session] of this.sessions) {
      session.pty.kill()
    }
    this.sessions.clear()
  }
}
```

Ключевые моменты:
- `SHELL_PATH` — константа, заменяется на `process.env.SHELL` в будущем
- `webContents.isDestroyed()` — защита от отправки в закрытое окно
- `sessions` — `Map<pid, { pty, webContents }>`, готово к нескольким сессиям

- [ ] **Step 2: Commit**

```bash
git add src/main/pty-manager.js
git commit -m "feat: add PtyManager for node-pty session management"
```

---

## Task 3: Main Process

**Files:**
- Create: `src/main/index.js`

- [ ] **Step 1: Написать точку входа main процесса**

```js
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import os from 'os'
import { PtyManager } from './pty-manager'

const ptyManager = new PtyManager()

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 400,
    minHeight: 300,
    frame: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(() => {
  ipcMain.handle('pty:create', (event, options) => {
    return ptyManager.create({ ...options, webContents: event.sender })
  })

  ipcMain.on('pty:write', (_, { pid, data }) => {
    ptyManager.write(pid, data)
  })

  ipcMain.on('pty:resize', (_, { pid, cols, rows }) => {
    ptyManager.resize(pid, cols, rows)
  })

  ipcMain.handle('app:homedir', () => os.homedir())

  createWindow()
})

app.on('window-all-closed', () => {
  ptyManager.killAll()
  app.quit()
})
```

Ключевые моменты:
- `frame: false` + `titleBarStyle: 'hiddenInset'` — frameless окно с нативными кнопками macOS
- `ELECTRON_RENDERER_URL` — electron-vite автоматически устанавливает в dev-режиме
- IPC handlers регистрируются до создания окна (чтобы быть готовыми к запросам renderer)
- `app:homedir` — renderer не имеет доступа к `os` из-за contextIsolation

- [ ] **Step 2: Commit**

```bash
git add src/main/index.js
git commit -m "feat: add main process with BrowserWindow and IPC handlers"
```

---

## Task 4: Preload Script

**Files:**
- Create: `src/preload/index.js`

- [ ] **Step 1: Написать preload с contextBridge**

```js
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  ptyCreate: (options) => ipcRenderer.invoke('pty:create', options),
  ptyWrite: (pid, data) => ipcRenderer.send('pty:write', { pid, data }),
  ptyResize: (pid, cols, rows) => ipcRenderer.send('pty:resize', { pid, cols, rows }),
  onPtyData: (cb) => ipcRenderer.on('pty:data', (_, data) => cb(data)),
  onPtyExit: (cb) => ipcRenderer.on('pty:exit', (_, info) => cb(info)),
  getHomedir: () => ipcRenderer.invoke('app:homedir')
})
```

Ключевые моменты:
- `invoke` (двусторонний) для `pty:create` и `app:homedir` — возвращают данные
- `send` (однонаправленный) для `pty:write` и `pty:resize` — fire-and-forget, без задержки

- [ ] **Step 2: Commit**

```bash
git add src/preload/index.js
git commit -m "feat: add preload script with contextBridge IPC API"
```

---

## Task 5: Renderer — HTML и CSS

**Files:**
- Create: `src/renderer/index.html`
- Create: `src/renderer/styles.css`

- [ ] **Step 1: Написать index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>eTty</title>
</head>
<body>
  <div id="titlebar">
    <span id="title">eTty</span>
  </div>
  <div id="terminal-container"></div>
  <script type="module" src="./index.js"></script>
</body>
</html>
```

- [ ] **Step 2: Написать styles.css**

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  height: 100%;
  overflow: hidden;
  background: #1e1e2e;
}

#titlebar {
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #181825;
  color: #cdd6f4;
  font-size: 13px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  -webkit-app-region: drag;
  -webkit-user-select: none;
  user-select: none;
  padding-left: 70px; /* пространство для macOS traffic lights */
}

#terminal-container {
  height: calc(100vh - 36px);
  overflow: hidden;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/index.html src/renderer/styles.css
git commit -m "feat: add renderer HTML with custom titlebar and terminal container"
```

---

## Task 6: Renderer — логика терминала

**Files:**
- Create: `src/renderer/index.js`

- [ ] **Step 1: Написать index.js**

```js
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
```

Ключевые моменты порядка инициализации:
1. Создаём Terminal, загружаем аддоны, монтируем в DOM
2. WebGL — после `term.open()` (нужен canvas в DOM)
3. `fitAddon.fit()` — до создания PTY (чтобы `term.cols/rows` были актуальны)
4. Создаём PTY с текущими cols/rows
5. Регистрируем все обработчики (onData, onResize, onPtyData, onPtyExit, onTitleChange)
6. ResizeObserver — **последним**, чтобы при срабатывании fit → onResize уже был зарегистрирован и pid определён

- [ ] **Step 2: Commit**

```bash
git add src/renderer/index.js
git commit -m "feat: add terminal renderer with xterm.js, addons, and IPC wiring"
```

---

## Task 7: Первый запуск и верификация

- [ ] **Step 1: Запуск в dev-режиме**

Run: `npm run dev`

Expected: Открывается окно приложения с кастомным titlebar "eTty" и терминалом zsh. Prompt отображается корректно.

- [ ] **Step 2: Проверка ввода/вывода**

В терминале выполнить:
```bash
echo "Hello from eTty"
ls -la
pwd
```

Expected: Команды выполняются, вывод отображается. `pwd` показывает домашнюю директорию.

- [ ] **Step 3: Проверка ANSI-цветов**

```bash
ls --color=auto
printf '\e[31mRed \e[32mGreen \e[34mBlue \e[0mNormal\n'
```

Expected: Цвета отображаются корректно в теме Catppuccin Mocha.

- [ ] **Step 4: Проверка UTF-8 и emoji**

```bash
echo "Привет мир 🚀🎉"
```

Expected: Русский текст и emoji отображаются без артефактов.

- [ ] **Step 5: Проверка resize**

Изменить размер окна мышью, затем:
```bash
tput cols
tput lines
```

Expected: Значения cols/lines соответствуют видимому размеру терминала. При каждом resize значения обновляются.

- [ ] **Step 6: Проверка интерактивных программ**

```bash
vim
# (или nano, или less)
```

Expected: vim открывается в полноэкранном режиме, навигация работает, `:q` закрывает. Ctrl+C в шелле работает.

- [ ] **Step 7: Проверка кликабельных ссылок**

```bash
echo "https://github.com"
```

Expected: URL отображается как кликабельная ссылка (подсветка при наведении). Клик открывает в системном браузере.

- [ ] **Step 8: Проверка завершения**

```bash
exit
```

Expected: Терминал показывает `[Process exited with code 0]`, через ~1 секунду окно закрывается.

- [ ] **Step 9: Проверка titlebar**

- Перетаскивание окна за titlebar работает
- Кнопки светофора macOS (close/minimize/maximize) работают
- Заголовок обновляется при `cd` в другую директорию (зависит от настроек шелла)

- [ ] **Step 10: Commit (если были правки при верификации)**

```bash
git add -A
git commit -m "fix: adjustments after initial verification"
```

Если правок не было — пропустить.

