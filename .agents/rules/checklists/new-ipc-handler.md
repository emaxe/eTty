# Чеклист: новый IPC-обработчик

Выполняй при добавлении нового IPC-канала между main и renderer процессами.

## Каналы

- [ ] Имена каналов добавлены в `src/shared/ipc-channels.js` — объект `IPC_CHANNELS`
- [ ] Используется формат: `'{domain}:{action}'` (например `'git:get-status'`)
- [ ] Нигде в коде нет строковых литералов для этого канала — только `IPC_CHANNELS.{DOMAIN}.{ACTION}`

## Main process

- [ ] Handler создан в файле `src/main/ipc-handlers/{domain}-handlers.js`
- [ ] Если файл для домена уже есть — handler добавлен в существующий файл
- [ ] Сигнатура функции регистрации: `register{Domain}Handlers(ipcMain, deps)`
- [ ] Зависимости (ptyManager, fileManager и т.д.) приходят через `deps`, не импортируются напрямую
- [ ] Handler добавлен в barrel export `src/main/ipc-handlers/index.js`
- [ ] Handler зарегистрирован в `src/main/index.js` (вызов `register{Domain}Handlers`)

## Preload

- [ ] Метод добавлен в `src/preload/index.js` через `contextBridge.exposeInMainWorld`
- [ ] Используется `ipcRenderer.invoke()` (для request-response) или `ipcRenderer.on()` (для push от main)

## Renderer

- [ ] Обращение через адаптер `src/renderer/core/adapters/electron-api.js`
- [ ] Адаптер обновлён — новый метод проксирует вызов к `window.electronAPI.{method}`
- [ ] Компоненты получают адаптер через DI, не вызывают `window.electronAPI` напрямую
