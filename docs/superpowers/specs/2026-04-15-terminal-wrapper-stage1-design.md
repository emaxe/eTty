# eTty — Этап 1: Базовая обёртка терминала

## Контекст

Цель первого этапа — создать минимально работающий терминал на базе Electron + xterm.js + node-pty. Никакого дополнительного функционала: только полностью функциональный шелл-эмулятор, работающий как обычный терминал. Всё остальное — вкладки, темы, плагины, конфигурация — реализуется на следующих этапах.

**Текущая платформа:** macOS. Архитектурные решения с расчётом на кроссплатформенность в будущем.

---

## Технологический стек

| Слой | Технология |
|------|-----------|
| Фреймворк | Electron (последняя стабильная версия) |
| Сборка | electron-vite |
| Эмулятор терминала | xterm.js (`@xterm/xterm`) |
| PTY-бэкенд | node-pty |
| Аддоны xterm.js | addon-fit, addon-webgl, addon-web-links, addon-search |
| Пересборка нативных модулей | electron-rebuild (через postinstall) |

---

## Структура проекта

```
etTy/
├── src/
│   ├── main/
│   │   ├── index.js          — точка входа: app lifecycle, создание окна
│   │   └── pty-manager.js    — управление PTY-сессиями
│   ├── preload/
│   │   └── index.js          — contextBridge: expose electronAPI в renderer
│   └── renderer/
│       ├── index.html        — HTML: titlebar + контейнер терминала
│       ├── index.js          — инициализация xterm.js, аддоны, IPC-привязка
│       └── styles.css        — стили titlebar и контейнера
├── package.json
└── electron.vite.config.js
```

---

## Архитектура

### Схема потоков данных

```
[Renderer: xterm.js]
    │  onData(input)
    │  onResize(cols, rows)
    ▼
[Preload: contextBridge / electronAPI]
    │  pty:write
    │  pty:resize
    │  pty:create
    ▼
[Main: pty-manager.js]
    │  node-pty spawn / write / resize / kill
    ▼
[Shell: /bin/zsh]
    │
    ▼ output data
[Main] ──pty:data──▶ [Renderer: term.write(data)]
```

### IPC-каналы

| Канал | Тип | Направление | Описание |
|-------|-----|-------------|----------|
| `pty:create` | handle/invoke | renderer → main | Создание PTY, возвращает `{ pid }` |
| `pty:data` | send/on | main → renderer | Вывод PTY-процесса |
| `pty:write` | send/on | renderer → main | Ввод пользователя |
| `pty:resize` | send/on | renderer → main | Изменение размера (`cols`, `rows`) |
| `pty:exit` | send/on | main → renderer | Завершение PTY-процесса |
| `app:homedir` | handle/invoke | renderer → main | Возвращает `os.homedir()` |

**Безопасность IPC:** все каналы проходят через `contextBridge` в preload. `nodeIntegration: false`, `contextIsolation: true`.

---

## Компоненты

### `src/main/index.js` — точка входа

- Создаёт `BrowserWindow` с `frame: false`, `titleBarStyle: 'hiddenInset'`
- Инициализирует `pty-manager`
- При закрытии окна (`window-all-closed`): убивает все PTY-сессии, вызывает `app.quit()`

### `src/main/pty-manager.js` — менеджер PTY

- Хранит сессии в `Map<pid, ptyProcess>`
- `create({ cols, rows, cwd })`: `pty.spawn('/bin/zsh', [], { name: 'xterm-256color', cols, rows, cwd, env: process.env })`
- Shell определяется как `/bin/zsh` (константа `SHELL_PATH` — готово к замене на `process.env.SHELL` в будущем)
- `write(pid, data)`: `sessions.get(pid).write(data)`
- `resize(pid, cols, rows)`: `sessions.get(pid).resize(cols, rows)`
- `kill(pid)`: `sessions.get(pid).kill()`
- На событии `onExit`: удаляет сессию из Map, отправляет `pty:exit` в renderer

### `src/preload/index.js` — contextBridge

Expose `window.electronAPI`:

```js
{
  ptyCreate: (options) => ipcRenderer.invoke('pty:create', options),
  ptyWrite: (data) => ipcRenderer.send('pty:write', data),
  ptyResize: ({ pid, cols, rows }) => ipcRenderer.send('pty:resize', { pid, cols, rows }),
  onPtyData: (cb) => ipcRenderer.on('pty:data', (_, data) => cb(data)),
  onPtyExit: (cb) => ipcRenderer.on('pty:exit', (_, info) => cb(info)),
  getHomedir: () => ipcRenderer.invoke('app:homedir'),  // renderer не имеет доступа к os
}
```

### `src/renderer/index.html` — разметка

```html
<div id="titlebar">   <!-- drag-зона, -webkit-app-region: drag -->
  <span id="title">eTty</span>
</div>
<div id="terminal-container"></div>
```

### `src/renderer/index.js` — логика renderer

1. Создаёт `Terminal` с настройками (cursorBlink, fontSize, тема)
2. Подгружает аддоны: FitAddon, WebglAddon (с fallback на canvas), WebLinksAddon, SearchAddon
3. `term.open(document.getElementById('terminal-container'))`
4. `fitAddon.fit()` + `ResizeObserver` на контейнере
5. Запрашивает домашнюю директорию: `const cwd = await electronAPI.getHomedir()`, затем вызывает `electronAPI.ptyCreate({ cols: term.cols, rows: term.rows, cwd })`
6. `term.onData(data => electronAPI.ptyWrite(data))`
7. `term.onResize(({ cols, rows }) => electronAPI.ptyResize({ pid, cols, rows }))`
8. `electronAPI.onPtyData(data => term.write(data))`
9. `electronAPI.onPtyExit(() => window.close())`
10. `term.onTitleChange(title => document.getElementById('title').textContent = title)`

---

## Настройки xterm.js

```js
{
  cursorBlink: true,
  fontSize: 14,
  fontFamily: 'Menlo, "SF Mono", Consolas, "Courier New", monospace',
  scrollback: 10000,
  allowProposedApi: true,   // требуется для WebGL addon
  theme: {                   // Catppuccin Mocha
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#f5e0dc',
    black: '#45475a', red: '#f38ba8', green: '#a6e3a1',
    yellow: '#f9e2af', blue: '#89b4fa', magenta: '#cba6f7',
    cyan: '#94e2d5', white: '#bac2de',
    brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1',
    brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#cba6f7',
    brightCyan: '#94e2d5', brightWhite: '#a6adc8'
  }
}
```

---

## Окно

| Параметр | Значение |
|----------|----------|
| `frame` | `false` |
| `titleBarStyle` | `'hiddenInset'` (macOS: нативные кнопки светофора) |
| `width` | `900` |
| `height` | `600` |
| `minWidth` | `400` |
| `minHeight` | `300` |
| `webPreferences.contextIsolation` | `true` |
| `webPreferences.nodeIntegration` | `false` |
| `webPreferences.preload` | `path.join(__dirname, '../preload/index.js')` |

Titlebar: CSS `-webkit-app-region: drag` на `#titlebar`, `-webkit-app-region: no-drag` на интерактивных элементах внутри.

---

## Обработка ошибок

| Ситуация | Поведение |
|----------|-----------|
| WebGL недоступен | Ловим ошибку при загрузке WebglAddon, xterm.js автоматически использует canvas, логируем в console |
| PTY завершился неожиданно | `onExit` → `pty:exit` → renderer закрывает окно |
| PTY завершился с ненулевым кодом | Выводим сообщение в терминал перед закрытием: `\r\n[Process exited with code N]\r\n` |
| Зомби-процессы | `app.on('window-all-closed')` убивает все сессии из Map |

---

## Кроссплатформенная закладка

- Shell определён как константа `SHELL_PATH = '/bin/zsh'` в `pty-manager.js` — заменяется на `process.env.SHELL || 'bash'` в будущем
- `titleBarStyle: 'hiddenInset'` — только macOS; для Windows/Linux будет добавлена своя логика через `process.platform`
- ConPTY (Windows 10+) поддерживается node-pty автоматически при запуске на Windows

---

## Верификация (как проверить, что всё работает)

1. `npm install && npx electron-rebuild` — нативные модули собраны без ошибок
2. `npm run dev` — приложение запускается, отображается окно с кастомным titlebar
3. В терминале работает ввод/вывод: команды `ls`, `echo`, `vim`, `htop` — всё отображается корректно
4. Цвета ANSI работают: `ls --color=auto`, `git log --oneline --decorate`
5. UTF-8: вывод команд с русскими символами, emoji
6. Изменение размера окна → терминал подстраивается, `tput cols` возвращает правильное значение
7. `exit` в шелле → окно закрывается
8. Ctrl+C, Ctrl+Z, Ctrl+D работают как ожидается
9. Прокрутка: длинный вывод (`cat /etc/hosts` × 100) — плавная прокрутка
10. URL в терминале кликабелен (открывается в браузере)
