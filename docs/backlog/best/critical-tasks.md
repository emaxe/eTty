# Критические задачи по устранению замечаний аудита

**Дата:** 2024-05-04 (актуализировано 2026-05-06)  
**Приоритет:** Критический → Высокий → Низкий  

---

## Блок A: Cleanup и утечки памяти (Sprint 1)

### A1. Добавить `destroy()` во все компоненты renderer
**Статус:** ✅ Завершено  
**Приоритет:** 🔴 Critical  
**Сложность:** M  
**Время:** 4-6ч

**Анализ (2026-05-06):**
Все перечисленные компоненты получили методы `destroy()` или `detach()`:
- `TabBar` — `destroy()` отписывает DOM (через AbortController), вызывает `DraggableTabs.destroy()` + `ContextMenu.destroy()`, очищает ссылки
- `FileTree` — `destroy()` вызывает `unwatchAll()`, отписывает IPC (`onFsDirChanged`), удаляет `_hoverOverlay`, очищает таймеры и ссылки
- `EditorPanel` — `destroy()` вызывает `view.destroy()` для всех табов, `DraggableTabs.destroy()` + `ContextMenu.destroy()`, очищает ссылки
- `StatusBar` — `destroy()` вызывает `stop()`, отписывает DOM (AbortController), очищает ссылки
- `SettingsPage` — `destroy()` очищает `_saveTimer`, удаляет `_overlay` из DOM, очищает ссылки
- `GitPanel` — `destroy()` очищает `_errorTimer`, отписывает DOM (AbortController), очищает ссылки
- `TerminalKeyboardHandler` — `detach()` снимает `attachCustomKeyEventHandler(null)` и очищает ссылки
- `TerminalOscHandler` — `detach()` вызывает `dispose()` на OSC-handlers и очищает ссылки
- `Diagnostics` — `destroy()` вызывает `stop()`, очищает `_samples`, `_ptyDataCounter`, `_xtermStates`
- `ContextMenu` — `destroy()` вызывает `hide()`, очищает `_onDocClick`

**Компоненты для покрытия:**
- [x] `TabBar` — отписка от DOM-обработчиков, `DraggableTabs.destroy()`, `ContextMenu.destroy()`
- [x] `FileTree` — очистка `_dirTimers`, `unwatchAll()`, удаление `_hoverOverlay`, отписка от `keydown`/`scroll`
- [x] `EditorPanel` — `destroy()` всех `_tabs.view`, `DraggableTabs.destroy()`, `ContextMenu.destroy()`
- [x] `StatusBar` — объединить `stop()` в полноценный `destroy()`, удалить DOM-обработчики
- [x] `SettingsPage` — очистка `_saveTimer`, удаление DOM-оверлея
- [x] `GitPanel` — очистка `_errorTimer`, удаление DOM-обработчиков
- [x] `TerminalKeyboardHandler` — `detach()` метод
- [x] `TerminalOscHandler` — `detach()` метод
- [x] `Diagnostics` — `destroy()` (вызов `stop()` + очистка `_samples`)
- [x] `ContextMenu` — добавить `destroy()` (вызов `hide()` + очистка ссылки)

**Критерий приёмки:**
- [x] Все классы из списка имеют метод `destroy()` (или `detach()` для хендлеров)
- [x] `AppContainer.destroy()` корректно вызывает `destroy()` на всех зарегистрированных компонентах
- [ ] После вызова `destroy()` — нет утечек DOM nodes (проверить через DevTools → Memory → Take heap snapshot)
- [ ] После вызова `destroy()` — нет активных `setTimeout`/`setInterval` (проверить через DevTools → Sources → Watch)
- [ ] Нет прямых обращений к `window.electronAPI` — только через адаптер (будет сделано в B1)
- [x] Все DOM listeners отписываются (AbortController / explicit remove), все ссылки на DOM-элементы (`this._el`, etc.) очищаются (`= null`)
- [x] Все подписки на `EventBus` и `StateStore` отменяются (компоненты не подписывались напрямую, подписки в `index.js`)

---

### A2. Добавить cleanup при закрытии приложения
**Статус:** ✅ Завершено  
**Приоритет:** 🔴 Critical  
**Сложность:** S  
**Время:** 2-3ч  

**Анализ (2026-05-06):**
- `ResizeObserver.disconnect()` — реализовано в `cleanupRenderer()` (`src/renderer/index.js:1033`)
- `removeEventListener` для глобальных обработчиков — реализовано (`index.js:1036-1041`)
- `diagnosticsInterval` очищен в `window-all-closed` (`src/main/index.js:83-88`)
- `before-quit` обработчик в `AppService` — реализовано (`index.js:91-97`)

**Что сделано:**
- [x] Сохранить ссылку на `ResizeObserver` в переменную и вызвать `.disconnect()` перед закрытием
- [x] Удалить глобальные обработчики `document.addEventListener`/`window.addEventListener` через `removeEventListener`
- [x] Очистить `diagnosticsInterval` в `main/index.js` в обработчике `window-all-closed`
- [x] Добавить `before-quit` обработчик в `AppService` для graceful shutdown

**Критерий приёмки:**
- После закрытия окна в dev-режиме (Cmd+W) нет dangling listeners
- `main/index.js` — `diagnosticsInterval` очищен

---

### A3. Очистка временных ZDOTDIR в `PtyManager`
**Статус:** ✅ Завершено  
**Приоритет:** 🔴 Critical  
**Сложность:** S  
**Время:** 1-2ч  

**Анализ (2026-05-06):**
- `zdotdir` сохраняется в session-объекте (`src/main/pty-manager.js:99`)
- `kill()` удаляет директорию (`pty-manager.js:161-167`)
- `killAll()` удаляет все tmp-директории (`pty-manager.js:171-184`)
- Ошибки удаления логируются через `electron-log`, приложение не падает

**Что сделано:**
- [x] Сохранить путь к `zdotdir` в session-объекте
- [x] В `kill()` и `killAll()` — удалять директорию через `fs.rmSync(zdotdir, { recursive: true, force: true })`
- [x] Обработать ошибки удаления (логировать, не падать)

**Критерий приёмки:**
- После закрытия вкладки `/tmp/etty-XXXXXX` удалена
- При `killAll()` (закрытие приложения) — все tmp-директории очищены

---

### A4. Очистка FileTree watchers и таймеров
**Статус:** ❌ Не завершено  
**Приоритет:** 🔴 Critical  
**Сложность:** S  
**Время:** 1-2ч  

**Анализ (2026-05-06):**
`FileTree` не имеет метода `destroy()`. Все cleanup-задачи остаются открытыми:
- `_dirTimers` не очищаются при уничтожении
- `_hoverOverlay` не удаляется из DOM
- Обработчики `scroll` на `_container` не отписываются
- Обработчики `keydown`/`keyup`/`blur` на `document`/`window` не отписываются

**Что сделать:**
- [ ] В `destroy()` — вызвать `unwatchAll()`
- [ ] В `destroy()` — очистить все `_dirTimers` через `clearTimeout`
- [ ] В `destroy()` — удалить `_hoverOverlay` из DOM
- [ ] В `destroy()` — отписать `_container` от `scroll`
- [ ] В `destroy()` — отписать `document` от `keydown`/`keyup`/`blur` (mod keys)

**Критерий приёмки:**
- После `fileTree.destroy()` — нет активных fs.watch и setTimeout

---

## Блок B: Архитектурные инварианты (Sprint 2)

### B1. Рефакторинг прямых вызовов `window.electronAPI` → адаптер
**Статус:** ✅ Завершено  
**Приоритет:** 🔴 Critical  
**Сложность:** L  
**Время:** 6-8ч  

**Анализ (2026-05-06):**
```
$ grep -r "window\.electronAPI" src/renderer/ | wc -l
3  (только в core/adapters/electron-api.js)
```

Основные нарушители (исправлены):
- `src/renderer/index.js` — ~35 вызовов → `api.*`
- `src/renderer/file-tree.js` — ~18 вызовов → `this._api.*`
- `src/renderer/status-bar.js` — 3 вызова → `this._api.*`
- `src/renderer/git-panel.js` — 9 вызовов → `this._api.*`

**Что сделано:**
- [x] `src/renderer/index.js` — все вызовы `window.electronAPI.*` заменены на `api.*`, `api = container.resolve('api')`
- [x] `src/renderer/file-tree.js` — все вызовы заменены на `this._api.*`
- [x] `src/renderer/status-bar.js` — добавлен `api` в constructor, все вызовы заменены на `this._api.*`
- [x] `src/renderer/git-panel.js` — добавлен `api` в constructor, все вызовы заменены на `this._api.*`
- [x] `core/adapters/electron-api.js` — дополнен недостающими методами (`fsUnwatchDir`, `fsMove`, `gitGetRoot`, `nodeVersion`, `onFsDirChanged`, `fsWatchDir` исправлен)
- [x] DI-регистрации обновлены: `GitPanel`, `StatusBar` получают `api: r('api')`

**Критерий приёмки:**
- [x] `grep -r "window.electronAPI" src/renderer/` возвращает ровно 3 результата (в `core/adapters/electron-api.js`)
- [x] `npm run build` проходит без ошибок
- [x] Все компоненты получают `api` через constructor (DI)
- [x] Приложение запускается, терминал работает, дерево файлов отображается, Git-панель открывается (ручной smoke-test — 2026-05-06)
- [ ] Приложение запускается, терминал работает, дерево файлов отображается, Git-панель открывается (ручной smoke-test)

---

### B2. Устранение глобальных переменных в `renderer/index.js`
**Статус:** ❌ Не завершено  
**Приоритет:** 🔴 Critical  
**Сложность:** M  
**Время:** 4-5ч  

**Анализ (2026-05-06):**
Все переменные и window-прикрепления на месте:
- `currentThemeName` (строка 33)
- `loadedThemes` (строка 34)
- `tabBar`, `editorPanel`, `appStore` (строки 36-40)
- `window.__appStore`, `window.__eventBus`, `window.__tabBar` (строки 118, 121, 302)

**Что сделать:**
- [ ] `currentThemeName` → перенести в `StateStore` (ключ `ui.currentTheme`)
- [ ] `loadedThemes` → перенести в `StateStore` (ключ `ui.themes`) или в DI-контейнер
- [ ] `tabBar`, `editorPanel`, `appStore` — убрать `let`-переменные, использовать только `container.resolve()`
- [ ] Убрать `window.__appStore`, `window.__eventBus`, `window.__tabBar` — заменить на явный `diagnostics` инжектор, если нужен дебаг

**Критерий приёмки:**
- В `renderer/index.js` нет `let`-переменных верхнего уровня (кроме констант/конфигов)
- Все компоненты получаются через `container.resolve()`

---

## Блок C: Безопасность и надёжность (Sprint 3)

### C1. Устранение symlink attack в `FileManager.validatePath`
**Статус:** ✅ Завершено (2026-05-06)  
**Приоритет:** 🔴 Critical  
**Сложность:** M  
**Время:** 30-60мин  

**Анализ (2026-05-06):**
`FileManager.validatePath` (`src/main/file-manager.js:28-33`) использует `path.resolve()` без `fs.realpath()`. Симлинк может обойти проверку `startsWith(this.cwd)`.

**Что сделано:**
- [x] `validatePath()` переведён в async, использует `fs.realpath()` перед проверкой `startsWith(this.cwd)`
- [x] Добавлена нормализация CWD (trailing slash) для защиты от prefix-атак
- [x] Все вызовы `validatePath()` обновлены с `await`
- [x] Добавлен интеграционный тест на symlink escape (`src/main/__tests__/file-manager.test.mjs`)
- [x] Добавлен JSDoc с описанием ограничений защиты (TOCTOU, hard links)
- [x] CHANGELOG.md обновлён

**Критерий приёмки:**
- [x] `validatePath()` отклоняет пути, проходящие через symlink за пределы CWD
- [x] Есть unit-test на symlink attack

---

### C2. Добавить try/catch в async IPC вызовы renderer
**Статус:** ❌ Не завершено  
**Приоритет:** 🔴 Critical  
**Сложность:** M  
**Время:** 3-4ч  

**Анализ (2026-05-06):**
Множество `await window.electronAPI.*` (или `api.*` после B1) не обёрнуты в `try/catch`. Особенно критично в `file-tree.js` (inline input handlers, DnD drop handlers).

**Что сделать:**
- [ ] Обёрнуть все `await window.electronAPI.*` (или `api.*` после B1) в `try/catch`
- [ ] Добавить централизованный обработчик ошибок IPC (например, `api.callWithErrorHandling()`)
- [ ] Показывать toast/notification при критических ошибках (fs write failed, git error и т.д.)

**Критерий приёмки:**
- Ни один async IPC вызов не выбрасывает unhandled rejection
- Ошибки логируются и показываются пользователю

---

## Блок D: Дедупликация и рефакторинг (Sprint 4)

### D1. Удалить дублирование `countDiffLines`
**Статус:** ✅ Завершено (2026-05-06)  
**Приоритет:** 🔴 Critical  
**Сложность:** XS  
**Время:** 30мин  

**Анализ (2026-05-06):**
Функция дублируется в двух файлах:
- `src/main/ipc-handlers/git-handlers.js:9-17`
- `src/main/git-service.js:4-12`

**Что сделано:**
- [x] Удалена локальная `countDiffLines` из `git-handlers.js`
- [x] Добавлен импорт `countDiffLines` из `../git-service.js`
- [x] `npm run build` проходит без ошибок

**Критерий приёмки:**
- [x] `grep -r "countDiffLines" src/main/` показывает только одно определение (в `git-service.js`)

---

### D2. Унификация тем — устранить дублирование
**Статус:** ❌ Не завершено  
**Приоритет:** 🟡 High  
**Сложность:** M  
**Время:** 3-4ч  

**Анализ (2026-05-06):**
Темы `dark` и `light` полностью дублируются между:
- `src/renderer/themes.js` (THEMES)
- `src/main/theme-loader.js` (BUILT_IN_THEMES)

**Что сделать:**
- [ ] Вынести все темы из `theme-loader.js` в отдельные JSON-файлы (`src/main/themes/*.json`)
- [ ] Использовать `fs.readFile` для загрузки в runtime
- [ ] `src/renderer/themes.js` — импортировать из shared JSON или через IPC

**Критерий приёмки:**
- Нет дублирования тем между `themes.js` и `theme-loader.js`
- Все темы хранятся в одном месте

---

### D3. Устранить дублирование restore-tabs logic
**Статус:** ❌ Не завершено  
**Приоритет:** 🟡 High  
**Сложность:** S  
**Время:** 2-3ч  

**Анализ (2026-05-06):**
В `src/renderer/index.js` код создания и настройки вкладок дублируется между:
- `restoreTabs()` (строки 734-780)
- `init()` (строки 790-824)
- Обработчик `bus.on('tab.add')` (строки 355-365)

**Что сделать:**
- [ ] Вынести цикл создания вкладок из `init()` и `restoreTabs()` в отдельную функцию `createAndSetupTabs(tabsData)`
- [ ] Использовать эту функцию в обоих местах

**Критерий приёмки:**
- `init()` и `restoreTabs()` вызывают общую функцию
- Код создания вкладок — в одном месте

---

## Блок E: Разбиение файлов и декомпозиция (Sprint 5)

### E1. Разбить `renderer/index.js`
**Статус:** ❌ Не завершено — **1052 строки**  
**Приоритет:** 🟡 High  
**Сложность:** L  
**Время:** 6-8ч  

**Анализ (2026-05-06):**
Файл вырос до 1052 строк. Всё ещё содержит:
- `createTab()`
- `setupTabHandlers()`
- `restoreTabs()`
- Event bus wiring
- DOM event handlers (titlebar drag, resize handles, focus indicator)
- Settings/GitPanel subscribers

**Что сделать:**
- [ ] Вынести `createTab()` → `features/terminal/tab-factory.js`
- [ ] Вынести `setupTabHandlers()` → `features/terminal/tab-handlers.js`
- [ ] Вынести `restoreTabs()` → `features/terminal/tab-restore.js`
- [ ] Вынести event bus wiring → `app/event-wiring.js` или аналогичный модуль
- [ ] `init()` должен остаться ~100-150 строк (bootstrap only)

**Критерий приёмки:**
- `renderer/index.js` < 200 строк
- Каждый вынесенный модуль < 200 строк
- Функциональность не изменилась

---

### E2. Разбить `file-tree.js`
**Статус:** ❌ Не завершено — **1351 строка**  
**Приоритет:** 🟡 High  
**Сложность:** L  
**Время:** 6-8ч  

**Анализ (2026-05-06):**
Файл вырос до 1351 строки. Содержит смешанную логику:
- DnD (drag & drop)
- Multi-select
- Inline input (create/rename)
- Context menus
- Hover overlay
- fs.watch coordination

**Что сделать:**
- [ ] Вынести DnD логику → `features/file-tree/dnd-manager.js`
- [ ] Вынести multi-select → `features/file-tree/selection-manager.js`
- [ ] Вынести inline input (create/rename) → `features/file-tree/inline-input.js`
- [ ] Вынести context menus → `features/file-tree/context-menus.js`
- [ ] Вынести hover overlay → `features/file-tree/hover-overlay.js`

**Критерий приёмки:**
- `file-tree.js` < 300 строк (только orchestration)
- Каждый вынесенный модуль самодостаточен

---

## Блок F: Конфигурация и hardcoded значения (Sprint 6)

### F1. Вынести hardcoded константы в конфиг
**Статус:** ❌ Не завершено  
**Приоритет:** 🟡 High  
**Сложность:** S  
**Время:** 2-3ч  

**Анализ (2026-05-06):**
Константы всё ещё hardcoded:
- `SHELL_PATH = '/bin/zsh'` в `src/main/pty-manager.js:8` — не в конфиге
- `MAX_WATCHERS = 100` в `src/main/file-manager.js:13` — не в конфиге
- `GLOBAL_LIMIT = 5000` в `src/main/history-manager.js:6` — не в конфиге
- `minSpin = 1200` в `src/renderer/index.js:910` — не в конфиге
- `DOUBLE_CLICK_THRESHOLD_MS` — уже в `APP_CONFIG`, используется корректно

**Что сделать:**
- [ ] `SHELL_PATH` в `PtyManager` → конфиг с fallback detection (`which zsh` / `which bash`)
- [ ] `MAX_WATCHERS` в `FileManager` → `core/config/fs-config.js`
- [ ] `GLOBAL_LIMIT` в `HistoryManager` → `core/config/history-config.js`
- [ ] `minSpin = 1200` в `FileTree` → `core/config/ui-config.js`
- [ ] `DOUBLE_CLICK_THRESHOLD_MS` уже в `APP_CONFIG` — проверить, что везде используется

**Критерий приёмки:**
- Нет magic numbers вне `core/config/`
- Все константы вынесены и задокументированы

---

## Блок G: Прочие улучшения

### G1. Добавить `engines` в `package.json`
**Статус:** ❌ Не завершено  
**Приоритет:** 🟢 Low  
**Сложность:** XS  
**Время:** 10мин  

**Анализ (2026-05-06):**
В `package.json` отсутствует поле `engines`.

```json
"engines": {
  "node": ">=14.17.0"
}
```

---

### G2. Защита от рекурсии в `EventBus.emit`
**Статус:** ❌ Не завершено  
**Приоритет:** 🟡 High  
**Сложность:** XS  
**Время:** 30мин  

**Анализ (2026-05-06):**
`EventBus.emit` (`src/renderer/core/event-bus.js:47-57`) не имеет защиты от рекурсивного вызова. Handler может вызвать `emit()` того же события → stack overflow.

**Что сделать:**
- [ ] Добавить флаг `_emitting` в `EventBus`
- [ ] Игнорировать или кидать ошибку при рекурсивном `emit`

---

### G3. Глубокая заморозка в `StateStore`
**Статус:** ❌ Не завершено  
**Приоритет:** 🟡 High  
**Сложность:** XS  
**Время:** 30мин  

**Анализ (2026-05-06):**
`StateStore` (`src/renderer/core/state-store.js:60`) использует `Object.freeze(newState)`, но это shallow freeze. Вложенные объекты остаются mutable.

**Что сделать:**
- [ ] Использовать `deepFreeze` вместо `Object.freeze`
- [ ] Или вернуть shallow copies в `get()`

---

## Итоговая оценка

| Блок | Задачи | Сложность | Оценка времени | Завершено |
|------|--------|-----------|----------------|-----------|
| A — Cleanup | 4 | S-M | 8-13ч | 2/4 |
| B — Адаптер/DI | 2 | M-L | 10-13ч | 1/2 |
| C — Безопасность | 2 | M | 6-8ч | 0/2 |
| D — Дедупликация | 3 | XS-M | 6-8ч | 1/3 |
| E — Разбиение | 2 | L | 12-16ч | 0/2 |
| F — Конфиг | 1 | S | 2-3ч | 0/1 |
| G — Прочее | 3 | XS | 1-1.5ч | 0/3 |
| **Итого** | **17** | | **45-62.5ч** | **4/17** |

**Рекомендуемый порядок:** A → C → B → D → F → E → G  
*(Сначала устраняем утечки и баги, потом рефакторим.)*

**Примечания к актуализации:**
- Задачи A2 и A3 завершены и работают корректно.
- Задача A1 была ошибочно помечена как ✅ — ни один компонент не имеет `destroy()`.
- Файлы `index.js` и `file-tree.js` продолжают расти (1052 и 1351 строк соответственно), что увеличивает приоритет E1/E2.
- Блок B (адаптер) блокирует блок C2 (try/catch) — рекомендуется B1 → C2.
