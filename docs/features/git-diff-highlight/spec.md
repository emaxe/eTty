# Спецификация: Подсветка git diff

## Контекст

eTty уже имеет git-интеграцию: статус-бар показывает `± +N -N`, git-panel позволяет делать commit/push/diff. Однако визуальная индикация изменений отсутствует в двух ключевых местах: файловом дереве и редакторе кода. Фича добавляет эту индикацию, опираясь на уже существующие IPC-каналы `git:get-status` и `git:get-diff`, без дублирования polling-логики через новый сервис `GitStatusService`.

Фича активна только при наличии git-репозитория в рабочей директории активной вкладки терминала.

## Требования

**REQ-1.** Файловое дерево подсвечивает файлы по git-статусу:
- Новые (untracked) файлы — зелёным (цвет `--green`)
- Изменённые (modified/staged) файлы — синим (цвет `--accent`)
- Удалённые файлы — красным с зачёркиванием (цвет `--red`)

**REQ-2.** Папки с изменёнными/новыми/удалёнными файлами внутри получают цветной dot-индикатор рядом с именем (цвет определяется по «наихудшему» статусу дочерних файлов: deleted > modified > new).

**REQ-3.** В редакторе (CodeMirror 6) отображается вертикальная цветная полоска (3px) в gutter слева от номеров строк:
- Добавленные строки — зелёная полоска (`--green`)
- Изменённые строки (хank содержит и `+` и `-`) — синяя полоска (`--accent`)
- Позиции удалённых строк — в v1 не отображаются (отложено)

**REQ-4.** Данные git-статуса обновляются:
- Автоматически каждые 5 секунд (polling)
- Немедленно при сохранении файла в редакторе (`Cmd+S`)

**REQ-5.** Polling активен только при наличии git-репозитория в rootPath активной вкладки терминала. При переключении вкладки rootPath обновляется.

**REQ-6.** Diff в редакторе запрашивается только для текущего открытого файла. При переключении файла — запрос обновляется.

**REQ-7.** Если рабочая директория не является git-репозиторием — никакой подсветки нет, дерево и редактор выглядят как сейчас.

**REQ-8.** Подсветка gitignored файлов — не входит в скоуп (v1).

## Ограничения

- Не добавлять новые IPC-каналы: использовать существующие `git:get-status` и `git:get-diff`
- Не изменять git-panel.js — он не участвует в новом polling
- Удалённые строки в редакторе (позиция `-` строк) — отложены на v2
- Polling ведётся только для активной вкладки и активного файла (не background)
- Папки: dot-индикатор только для уже загруженных (развёрнутых) поддиректорий; lazy-load не меняется

## Макеты и референсы

Не применимо (визуальный стиль согласован текстом):
- Файловое дерево: цветной текст имени файла + dot рядом с именем папки
- Редактор: вертикальная полоска 3px в отдельном gutter левее номеров строк, как в VS Code

## Кодстайл и конвенции

- **DI:** `GitStatusService` регистрируется через `container.register('gitStatusService', ...)` в `index.js`; зависимости — через constructor
- **EventBus:** коммуникация между сервисом и компонентами только через `eventBus.emit/on`; нет прямых вызовов методов между компонентами
- **StateStore:** `git.isRepo`, `git.rootPath`, `git.fileStatuses` — новые ключи в store; компоненты подписываются через `store.subscribe`
- **IPC_CHANNELS:** все обращения к git через константы из `shared/ipc-channels.js` (GIT_GET_STATUS, GIT_GET_DIFF, GIT_GET_ROOT)
- **Config:** интервал polling `GIT_STATUS_POLL_INTERVAL: 5000` — в `core/config/app-config.js`
- **Cleanup:** `GitStatusService.destroy()` — `clearInterval` + отписка от EventBus; EditorPanel обновляет `destroy()` для очистки подписки
- **Адаптер:** все IPC-вызовы через `this._api` (ElectronApiAdapter), не через `window.electronAPI` напрямую

## Переиспользуемые решения

- `src/renderer/core/event-bus.js` — EventBus для `git:status-updated` и `editor:file-saved`
- `src/renderer/core/state-store.js` — StateStore, паттерн `store.subscribe` / `store.set`
- `src/renderer/core/container.js` — DI Container, паттерн `container.register` / `container.resolve`
- `src/renderer/core/adapters/electron-api.js` — методы `gitGetStatus`, `gitGetDiff`, `gitGetRoot` уже есть
- `src/renderer/core/config/app-config.js` — добавить `GIT_STATUS_POLL_INTERVAL`
- `src/shared/ipc-channels.js` — `GIT_GET_STATUS`, `GIT_GET_DIFF`, `GIT_GET_ROOT` уже определены
- `src/renderer/git-panel.js` — образец парсинга unified diff (`_renderDiff`) и структуры ответа `gitGetStatus`
- `src/renderer/status-bar.js` — образец polling-паттерна (setInterval + clearInterval + destroy)
- `src/renderer/editor-panel.js` — образец добавления CodeMirror extensions, паттерн `EditorView.dispatch`

## Критерии приёмки

- [ ] Новый файл в git-репозитории отображается зелёным в файловом дереве
- [ ] Изменённый файл отображается синим в файловом дереве
- [ ] Папка с изменёнными файлами получает dot-индикатор
- [ ] При отсутствии git-репозитория — никакой подсветки нет
- [ ] Открытие изменённого файла в редакторе показывает цветные полоски в gutter
- [ ] Добавленные строки — зелёная полоска, изменённые — синяя
- [ ] После `Cmd+S` подсветка обновляется (статус + diff в редакторе)
- [ ] Polling 5s обновляет подсветку дерева и редактора без действий пользователя
- [ ] При переключении вкладки терминала — смена rootPath, статус пересчитывается
- [ ] При переключении файла в редакторе — diff пересчитывается для нового файла
- [ ] Нет memory leak: `destroy()` корректно очищает подписки и интервалы

## Затронутые файлы

**Новые:**
- `src/renderer/services/git-status-service.js` — новый сервис

**Изменяемые:**
- `src/renderer/index.js` — регистрация GitStatusService в DI, подписка на tab switch, добавление `git.*` в начальный state store
- `src/renderer/file-tree.js` — подписка на `git.fileStatuses`, CSS-классы на узлах
- `src/renderer/editor-panel.js` — diff gutter extension, подписка на `git:status-updated`
- `src/renderer/core/config/app-config.js` — константа `GIT_STATUS_POLL_INTERVAL`
- `src/renderer/styles.css` — стили `.git-status-new`, `.git-status-modified`, `.git-status-deleted`, `.diff-gutter-bar`, `.diff-gutter-added`, `.diff-gutter-modified`
