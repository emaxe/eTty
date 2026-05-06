# Спецификация: Синхронизация открытого файла с диском

## Контекст

В текущей реализации панель редактора (`editor-panel.js`) загружает содержимое файла в момент открытия и больше не проверяет его актуальность. Если сторонний процесс изменит файл на диске (git checkout, другой редактор, скрипт), пользователь в редакторе продолжит видеть старую версию. При сохранении (`Ctrl+S`) пользователь перезапишет внешние изменения без предупреждения.

Дерево файлов (`file-tree.js`) уже имеет механизм `fs.watch` и автоматически обновляет список файлов/папок, но не уведомляет редактор о изменениях содержимого.

## Требования

### REQ-1: Автоматическая синхронизация при повторном открытии файла
При вызове `openFile(filePath)` для уже открытого файла:
- Если `modified === false` (пользователь не вносил правок): перечитать содержимое с диска, обновить CodeMirror документ, `originalContent`, `originalMtime`.
- Если `modified === true`: показать диалог конфликта (REQ-4).

### REQ-2: Автоматическая проверка при активации таба / показе панели
При `_switchToTab(filePath)` если `modified === false`:
- Проверить `mtime` на диске через `fsStatFile`.
- Если `mtime` изменился: перезагрузить содержимое автоматически.

Если `modified === true` и `mtime` на диске новее:
- Подсветить кнопку синхронизации в статус-баре (индикатор изменения на диске).
- **Не** показывать модальный диалог автоматически.

### REQ-3: Кнопка ручной синхронизации в статус-баре
В `#editor-status` добавить кнопку `<button id="btn-sync-file">` с иконкой `Icons.refresh` (справа от `#editor-status-file`).
- `title`: «Синхронизировать с диском».
- При нажатии: проверить `mtime` активного файла.
  - Если чистый (`modified === false`) и `mtime` новее: перезагрузить содержимое.
  - Если грязный (`modified === true`) и `mtime` новее: показать диалог конфликта (REQ-4).
  - Если `mtime` не изменился: ничего не делать.
- Индикатор: когда файл на диске новее `originalMtime` и таб грязный — кнопка подсвечивается цветом `var(--accent)` (CSS класс `.sync-outdated`).

### REQ-4: Диалог разрешения конфликтов
Появляется в следующих случаях:
- `openFile()` для уже открытого грязного файла с изменившимся `mtime`.
- Ручная синхронизация грязного файла с изменившимся `mtime`.

Диалог — модальный overlay внутри editor-panel (паттерн `_showLinkError` / `.settings-dialog-overlay`).
Содержит три кнопки:
1. **«Оставить мои изменения»** — закрыть диалог, ничего не менять в редакторе.
2. **«Загрузить с диска»** — перезаписать CodeMirror содержимое версией с диска, обновить `originalContent` и `originalMtime`, сбросить `modified = false`.
3. **«Показать diff»** — в том же overlay переключиться на двухпанельный просмотр: верхняя панель — текущее содержимое редактора (read-only), нижняя панель — содержимое с диска (read-only). Под панелями — кнопки «Оставить мои» и «Загрузить с диска».

### REQ-5: Отслеживание mtime
- Для каждого таба в Map хранить `originalMtime` (timestamp в мс, от `fs.stat().mtimeMs`).
- При открытии файла: вызывать `fsStatFile(filePath)` и записать `originalMtime`.
- При сохранении файла: обновить `originalMtime` (записать текущее время или перечитать stat).
- При проверке синхронности: сравнивать `originalMtime` с `mtimeMs` с диска.

### REQ-6: IPC инфраструктура для stat
- Новый канал `FS_STAT_FILE: 'fs:stat-file'` в `shared/ipc-channels.js`.
- Новый метод `statFile(filePath)` в `main/file-manager.js`: возвращает `{ success: true, mtimeMs, size }` или `{ success: false, error }`.
- Новый IPC handler в `main/ipc-handlers/fs-handlers.js`.
- Новый preload bridge `fsStatFile` в `preload/index.js`.
- Новый адаптер `fsStatFile(path)` в `renderer/core/adapters/electron-api.js`.

## Ограничения

- **Нет фонового polling.** Проверка только при явных действиях: `openFile`, `_switchToTab`, нажатие кнопки синхронизации, показ панели.
- **Нет per-file watchers.** Существующий `fs.watch` на директории используется только деревом файлов.
- **Нет новых npm-зависимостей.** Diff viewer реализуется простым двухпанельным UI без внешних библиотек.
- **Минимальные изменения вне EditorPanel и IPC.**
- Конфликтный диалог — inline overlay внутри `#editor-panel`, не глобальный модал.

## Макеты и референсы

> Не применимо — поведенческая фича без новых UI-экранов, используем существующие паттерны панели редактора.
> Референс: диалог в `settings-page.js` (`.settings-dialog-overlay`, `.settings-dialog-*`), overlay в `editor-panel.js` (`_showLinkError`).

## Кодстайл и конвенции

- **DI:** зависимости — через DI Container (constructor injection), не через глобалы.
- **EventBus:** коммуникация между компонентами — через EventBus, не прямые вызовы.
- **StateStore:** shared state — через StateStore; `originalMtime` внутри таба — private field.
- **IPC_CHANNELS:** все IPC-каналы — только через `shared/ipc-channels.js`, нет строковых литералов.
- **Config:** магические числа (например, max file size) — в `core/config/`, не инлайн.
- **Cleanup:** каждый новый listener/DOM элемент имеет удаление в `destroy()`.
- **Adapter:** не обращаться к `window.electronAPI` напрямую — через `core/adapters/electron-api.js`.

## Переиспользуемые решения

| Что | Где | Как использовать |
|-----|-----|------------------|
| Паттерн inline overlay | `src/renderer/editor-panel.js` `_showLinkError()` (lines 757–788) | За основу DOM-структуры конфликтного overlay |
| CSS диалога | `src/renderer/styles.css` `.settings-dialog-overlay`, `.settings-dialog`, `.settings-dialog-header`, `.settings-dialog-body`, `.settings-dialog-footer`, `.settings-dialog-btn-primary`, `.settings-dialog-btn-secondary` | Стили для backdrop, контейнера и кнопок диалога |
| Иконка refresh | `src/renderer/icons.js` `Icons.refresh` | Для кнопки синхронизации в статус-баре |
| Button component | `src/renderer/components/base/button/button.js` | Опционально для кнопок диалога (можно использовать простые `<button>` для консистентности с `_showLinkError`) |

## Критерии приёмки

- [ ] **CA-1:** Открытый файл изменён внешним процессом, редактор чистый (`modified === false`) → при переключении на таб или повторном `openFile` содержимое автоматически обновляется.
- [ ] **CA-2:** Открытый файл изменён внешним процессом, редактор грязный (`modified === true`) → при переключении на таб появляется индикатор (подсветка кнопки синхронизации), модальный диалог **не** показывается автоматически.
- [ ] **CA-3:** При нажатии кнопки синхронизации для грязного файла с изменившимся `mtime` → появляется диалог с тремя кнопками («Оставить мои», «Загрузить с диска», «Показать diff»).
- [ ] **CA-4:** В режиме «Показать diff» видны две панели: текущее содержимое редактора и версия с диска (обе read-only).
- [ ] **CA-5:** При выборе «Загрузить с диска» — содержимое редактора обновляется, флаг `modified` снимается, `originalMtime` обновляется.
- [ ] **CA-6:** При выборе «Оставить мои изменения» — редактор не меняется, при следующей проверке диалог появляется снова.
- [ ] **CA-7:** Кнопка синхронизации отображается в статус-баре (`#editor-status`) и работает для активного файла.
- [ ] **CA-8:** Все новые IPC каналы объявлены в `shared/ipc-channels.js`, адаптер обновлён.
- [ ] **CA-9:** Компонент корректно очищается в `destroy()` (overlay удаляется, listener кнопки отписывается).
- [ ] **CA-10:** При сохранении файла (`Ctrl+S`) `originalMtime` обновляется, индикатор синхронизации сбрасывается.

## Затронутые файлы

| Файл | Изменения |
|------|-----------|
| `src/shared/ipc-channels.js` | Добавить `FS_STAT_FILE` |
| `src/main/file-manager.js` | Добавить `statFile(filePath)` |
| `src/main/ipc-handlers/fs-handlers.js` | Добавить handler для `FS_STAT_FILE` |
| `src/preload/index.js` | Добавить `fsStatFile` в expose |
| `src/renderer/core/adapters/electron-api.js` | Добавить `fsStatFile(path)` |
| `src/renderer/editor-panel.js` | Основная логика: хранение `originalMtime`, проверки, диалог, кнопка, diff viewer |
| `src/renderer/index.html` | Добавить `#btn-sync-file` в `#editor-status` |
| `src/renderer/styles.css` | Стили для `.editor-sync-btn`, `.sync-outdated`, `.settings-dialog-*` (если нужны дополнительные) |
