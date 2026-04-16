# Работа с node-pty (псевдотерминал)

## Создание сессии PTY в main процессе

```javascript
// main.js
const os = require('os');
const pty = require('node-pty');

const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
const cwd = process.env.HOME || process.env.USERPROFILE;

const ptyProcess = pty.spawn(shell, [], {
  name: 'xterm-256color',
  cols: 80,
  rows: 24,
  cwd: cwd,
  env: process.env,
  // Windows: useConpty = true (по умолчанию, если Windows 10+)
});

// Перехват вывода
ptyProcess.onData((data) => {
  // Отправить в renderer через IPC
  mainWindow.webContents.send('pty-output', data);
});

// Запись ввода
ptyProcess.write('ls -la\r\n');
```

## Управление сессией

| Метод | Описание |
|-------|----------|
| `ptyProcess.write(data)` | Отправить ввод (строку с \r для Enter) |
| `ptyProcess.resize(cols, rows)` | Изменить размер терминала (вызывать при `fitAddon.fit()`) |
| `ptyProcess.kill(signal)` | Убить процесс шелла |
| `ptyProcess.pid` | PID процесса |

## Обработка изменения размера окна

```javascript
// renderer: при изменении размера контейнера
fitAddon.fit();
const { cols, rows } = term;
electronAPI.ptyResize({ pid, cols, rows });

// main: слушаем событие
ipcMain.on('pty-resize', (event, { pid, cols, rows }) => {
  const session = activeSessions.get(pid);
  if (session) session.resize(cols, rows);
});
```

## Поддержка нескольких вкладок/сессий

```javascript
// main: хранилище сессий
const sessions = new Map();

ipcMain.handle('pty-create', (event, options) => {
  const p = pty.spawn(...);
  sessions.set(p.pid, p);
  return p.pid;
});

ipcMain.on('pty-write', (event, { pid, data }) => {
  sessions.get(pid)?.write(data);
});
```

## Обработка завершения шелла

```javascript
ptyProcess.onExit(({ exitCode, signal }) => {
  // Уведомить renderer о закрытии вкладки
  mainWindow.webContents.send('pty-exit', { pid: ptyProcess.pid, exitCode });
  sessions.delete(ptyProcess.pid);
});
```

## Важные особенности

- **Кодировка**: `node-pty` работает с байтами. Для UTF-8 проблем нет.
- **Ctrl+C, Ctrl+Z**: передаются как обычные символы (например, `\x03`). `xterm.js` сам их генерирует.
- **Windows**: использует ConPTY (Windows 10 1809+). Более старая версия использует winpty (может быть медленнее).

## Документация

- [node-pty API Reference](https://github.com/microsoft/node-pty#class-pty)
- [Пример Electron с node-pty](https://github.com/microsoft/node-pty/tree/main/examples/electron)
