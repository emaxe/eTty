# Чеклист реализации: Синхронизация открытого файла с диском

## Подготовка
- [x] Прочитать spec.md и plan.md
- [x] Работа без отдельной ветки (см. README.md)

## Задачи

### Блок 1 — IPC инфраструктура
- [x] Задача #1: Добавить IPC канал `FS_STAT_FILE` в `src/shared/ipc-channels.js`
- [x] Задача #2: Добавить `statFile()` в `src/main/file-manager.js`
- [x] Задача #3: Добавить handler `FS_STAT_FILE` в `src/main/ipc-handlers/fs-handlers.js`
- [x] Задача #4: Добавить `fsStatFile` в `src/preload/index.js`
- [x] Задача #5: Добавить `fsStatFile` в `src/renderer/core/adapters/electron-api.js`

### Блок 2 — UI элементы
- [x] Задача #6: HTML — кнопка `#btn-sync-file` в `src/renderer/index.html`
- [x] Задача #7: CSS — стили `.editor-sync-btn`, `.sync-outdated`, `.conflict-dialog-*` в `src/renderer/styles.css`

### Блок 3 — Логика EditorPanel
- [x] Задача #8: Хранение `originalMtime` в табе (`src/renderer/editor-panel.js`)
- [x] Задача #9: Автообновление при `openFile` и `_switchToTab`
- [x] Задача #10: Кнопка синхронизации (click handler, подписка, отписка)
- [x] Задача #11: Диалог конфликта (overlay, три кнопки)
- [x] Задача #12: Diff viewer (две read-only панели)
- [x] Задача #13: Cleanup и интеграция (`destroy()`, `suspendState`/`restoreState`)

## Финализация
- [x] Все проверки пройдены (CA-1..CA-10 из spec.md)
- [x] Код закоммичен
- [x] Статус в README.md обновлён на `Done`
