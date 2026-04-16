# Архитектура терминального приложения на Electron

## Основная схема (Main ↔ Renderer)

```
[Electron Main Process]  ←IPC→  [Electron Renderer Process]
       │                           │
   [node-pty]                  [xterm.js]
       │                           │
   [Shell]                      [DOM/Canvas]
(bash, zsh, cmd, powershell)
```

## Компоненты

| Компонент | Роль | Запуск |
|-----------|------|--------|
| **Main Process** | Управление окнами, создание PTY-сессий, жизненный цикл приложения | Один на приложение |
| **Renderer Process** | Отображение UI, рендеринг терминала, обработка ввода с клавиатуры | Один на окно (или вкладку) |
| **node-pty** | Нативный модуль, создаёт псевдотерминал (PTY) и дочерний процесс шелла | В main процессе |
| **xterm.js** | Эмулятор терминала на JS/WebGL, рендерит в `<canvas>` или DOM | В renderer процессе |

## Жизненный цикл сессии

1. **Запуск**: Main создаёт окно → Renderer инициализирует `xterm.js`.
2. **Создание PTY**: Main вызывает `node-pty.spawn()` → получает объект `ptyProcess`.
3. **Привязка**: Renderer отправляет IPC запрос на создание PTY. Main возвращает `pid`.
4. **Вывод**: `ptyProcess.on('data', (data) => { ... })` → отправляет данные в Renderer через IPC.
5. **Ввод**: Renderer ловит `xterm.onData()` → отправляет строку в Main → `ptyProcess.write(data)`.
6. **Изменение размера**: Renderer вызывает `xterm.onResize()` → Main → `ptyProcess.resize(cols, rows)`.
7. **Завершение**: Закрытие окна → Main убивает PTY процесс (`ptyProcess.kill()`).

## Ключевые IPC каналы (пример)

```javascript
// main process
ipcMain.handle('pty:create', (event, {shell, cols, rows, cwd}) => {
  const pty = spawn(shell, [], { cols, rows, cwd, name: 'xterm-256color' });
  pty.onData(data => event.sender.send('pty:data', data));
  return { pid: pty.pid };
});

ipcMain.on('pty:write', (event, data) => { /* получить PTY по pid и вызвать write */ });
ipcMain.on('pty:resize', (event, {pid, cols, rows}) => { /* ... */ });

// renderer process
window.electronAPI.ptyCreate(...);
window.electronAPI.onPtyData((data) => xterm.write(data));
```

## Документация

- [Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)
