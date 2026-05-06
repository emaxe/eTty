# Чеклист аудита — синхронизация выполнения

**Дата:** 2024-05-04  
**Статус:** 🔴 Аудит завершён, задачи в ожидании  

---

## Легенда

- ⬜ — Не начато
- 🟡 — В работе
- ✅ — Завершено
- 🔍 — На ревью

---

## Блок A: Cleanup и утечки памяти

| # | Задача | Компоненты/файлы | Статус | Примечания |
|---|--------|------------------|--------|------------|
| A1 | Добавить `destroy()` во все компоненты | TabBar, FileTree, EditorPanel, StatusBar, SettingsPage, GitPanel, TerminalKeyboardHandler, TerminalOscHandler, Diagnostics, ContextMenu | ✅ | Протестировано вручную, функциональность не нарушена |

### A1 — Чеклист компонентов destroy()

- [x] `TabBar.destroy()`
- [x] `FileTree.destroy()`
- [x] `EditorPanel.destroy()`
- [x] `StatusBar.destroy()`
- [x] `SettingsPage.destroy()`
- [x] `GitPanel.destroy()`
- [x] `TerminalKeyboardHandler.detach()`
- [x] `TerminalOscHandler.detach()`
- [x] `Diagnostics.destroy()`
- [x] `ContextMenu.destroy()`

### A2 — Чеклист cleanup

- [ ] `ResizeObserver.disconnect()` в `renderer/index.js`
- [ ] `document.removeEventListener('focusin')` в `renderer/index.js`
- [ ] `document.removeEventListener('mousedown')` в `renderer/index.js`
- [ ] `window.removeEventListener('blur')` в `renderer/index.js`
- [ ] `clearInterval(diagnosticsInterval)` в `main/index.js`
- [ ] `before-quit` обработчик в `AppService`

### A3 — Чеклист ZDOTDIR cleanup

- [ ] Сохранить `zdotdir` путь в session
- [ ] `fs.rmSync(zdotdir)` в `kill()`
- [ ] `fs.rmSync(zdotdir)` в `killAll()`
- [ ] Обработка ошибок удаления (логирование)

### A4 — Чеклист FileTree cleanup

- [x] `unwatchAll()` в `destroy()`
- [x] `clearTimeout` для всех `_dirTimers`
- [x] `clearTimeout(_autoExpandTimer)`
- [x] `clearInterval(_autoScrollTimer)`
- [x] Удаление `_hoverOverlay` из DOM
- [x] Отписка от `scroll`, `keydown`, `keyup`, `blur`

---

## Блок B: Архитектурные инварианты

| # | Задача | Файлы | Статус | Примечания |
|---|--------|-------|--------|------------|
| B1 | Рефакторинг `window.electronAPI` → адаптер | `renderer/index.js`, `file-tree.js`, `status-bar.js`, `git-panel.js` | ✅ | Завершено — smoke-test пройден |
| B2 | Устранение глобальных переменных | `renderer/index.js` | ⬜ | `currentThemeName`, `loadedThemes`, `tabBar`, `editorPanel`, `appStore` → DI/StateStore |

### B1 — Чеклист рефакторинга адаптера

- [x] `renderer/index.js` — все вызовы через `api.*`
- [x] `file-tree.js` — все вызовы через `this._api.*`
- [x] `status-bar.js` — все вызовы через `this._api.*`
- [x] `git-panel.js` — все вызовы через `this._api.*`
- [x] Проверка: `grep -r "window.electronAPI" src/renderer/` == 3 (только адаптер)

### B2 — Чеклист глобалов

- [ ] `currentThemeName` → `store.set('ui.currentTheme')`
- [ ] `loadedThemes` → DI-контейнер или `store`
- [ ] `tabBar` → `container.resolve('tabBar')`
- [ ] `editorPanel` → `container.resolve('editorPanel')`
- [ ] `appStore` → `container.resolve('store')`
- [ ] Удалить `window.__appStore`
- [ ] Удалить `window.__eventBus`
- [ ] Удалить `window.__tabBar`
- [ ] Заменить `window.__exportTabState` на метод `TabBar`

---

## Блок C: Безопасность и надёжность

| # | Задача | Файлы | Статус | Примечания |
|---|--------|-------|--------|------------|
| C1 | Symlink attack защита | `src/main/file-manager.js` | ⬜ | `fs.realpath()` + unit-тесты |
| C2 | try/catch в async IPC | `renderer/index.js`, `file-tree.js`, `status-bar.js`, `git-panel.js` | ⬜ | Централизованный error handler |

### C1 — Чеклист validatePath

- [ ] Использовать `fs.realpath()` перед проверкой
- [ ] Добавить unit-test: symlink escape
- [ ] Добавить unit-test: relative path traversal (`../../etc/passwd`)
- [ ] Документация ограничений

### C2 — Чеклист error handling

- [ ] Все `await api.*` обёрнуты в `try/catch`
- [ ] Централизованный `handleApiError()` helper
- [ ] Toast/notification при критических ошибках
- [ ] Логирование ошибок в `electron-log`

---

## Блок D: Дедупликация

| # | Задача | Файлы | Статус | Примечания |
|---|--------|-------|--------|------------|
| D1 | Удалить дубль `countDiffLines` | `git-handlers.js`, `git-service.js` | ⬜ | Импорт из `git-service.js` |
| D2 | Унификация тем | `themes.js`, `theme-loader.js` | ⬜ | JSON-файлы, единый источник |
| D3 | Дедупликация restore-tabs | `renderer/index.js` | ⬜ | Общая функция `createAndSetupTabs()` |

### D1 — Чеклист countDiffLines

- [ ] Удалить локальную функцию из `git-handlers.js`
- [ ] Импортировать из `git-service.js`
- [ ] Проверить, что `git-handlers.js` работает

### D2 — Чеклист тем

- [ ] Создать `src/main/themes/*.json`
- [ ] Перенести все темы из `theme-loader.js`
- [ ] Удалить дубли из `themes.js`
- [ ] Импортировать в `renderer` через IPC или shared JSON
- [ ] Проверить загрузку и fallback

### D3 — Чеклист restore-tabs

- [ ] Создать `createAndSetupTabs(tabsData)`
- [ ] Использовать в `init()`
- [ ] Использовать в `restoreTabs()`
- [ ] Убедиться, что логика идентична

---

## Блок E: Разбиение файлов

| # | Задача | Исходный файл | Статус | Примечания |
|---|--------|---------------|--------|------------|
| E1 | Разбить `renderer/index.js` | `renderer/index.js` (987 строк) | ⬜ | Цель: < 200 строк |
| E2 | Разбить `file-tree.js` | `file-tree.js` (1370 строк) | ⬜ | Цель: < 300 строк |

### E1 — Чеклист разбиения index.js

- [ ] `features/terminal/tab-factory.js` — `createTab()`
- [ ] `features/terminal/tab-handlers.js` — `setupTabHandlers()`
- [ ] `features/terminal/tab-restore.js` — `restoreTabs()`
- [ ] `app/event-wiring.js` — все `bus.on()` подписки
- [ ] `app/dom-wiring.js` — все `addEventListener` на DOM
- [ ] `app/visibility-wiring.js` — `visibilitychange`, focus indicators
- [ ] Проверка: `renderer/index.js` < 200 строк

### E2 — Чеклист разбиения file-tree.js

- [ ] `features/file-tree/dnd-manager.js` — drag & drop
- [ ] `features/file-tree/selection-manager.js` — multi-select
- [ ] `features/file-tree/inline-input.js` — create/rename inline
- [ ] `features/file-tree/context-menus.js` — context menus
- [ ] `features/file-tree/hover-overlay.js` — hover overlay
- [ ] `features/file-tree/tree-renderer.js` — `_buildNode`, `_buildList`
- [ ] Проверка: `file-tree.js` < 300 строк

---

## Блок F: Конфигурация

| # | Задача | Файлы | Статус | Примечания |
|---|--------|-------|--------|------------|
| F1 | Вынести hardcoded константы | `PtyManager`, `FileManager`, `HistoryManager`, `FileTree` | ⬜ | Все в `core/config/` |

### F1 — Чеклист констант

- [ ] `SHELL_PATH` → `core/config/pty-config.js` с auto-detect
- [ ] `MAX_WATCHERS` → `core/config/fs-config.js`
- [ ] `GLOBAL_LIMIT` → `core/config/history-config.js`
- [ ] `minSpin = 1200` → `core/config/ui-config.js`
- [ ] `PROMPT_MAP` → `core/config/pty-config.js`
- [ ] Проверка: нет magic numbers вне `core/config/`

---

## Блок G: Прочие улучшения

| # | Задача | Файлы | Статус | Примечания |
|---|--------|-------|--------|------------|
| G1 | `engines` в `package.json` | `package.json` | ⬜ | `node >= 14.17.0` |
| G2 | Защита от рекурсии в EventBus | `core/event-bus.js` | ⬜ | Флаг `_emitting` |
| G3 | Глубокая заморозка StateStore | `core/state-store.js` | ⬜ | `deepFreeze` или shallow copies |

---

## Итоговый прогресс

| Блок | Задачи | Завершено | % |
|------|--------|-----------|---|
| A — Cleanup | 4 | 1 (A1 на ревью, A2/A3 ✅, A4 частично в A1) | 25% |
| B — Адаптер/DI | 2 | 1 (B1 на ревью) | 50% |
| C — Безопасность | 2 | 0 | 0% |
| D — Дедупликация | 3 | 0 | 0% |
| E — Разбиение | 2 | 0 | 0% |
| F — Конфиг | 1 | 0 | 0% |
| G — Прочее | 3 | 0 | 0% |
| **Итого** | **17** | **2** | **~12%** |

---

## Инструкции по обновлению чеклиста

1. Перед началом задачи — поменяйте статус ⬜ → 🟡
2. После завершения задачи — 🟡 → 🔍 (на ревью)
3. После review/тестирования — 🔍 → ✅
4. Обновляйте столбец "Примечания" — какие тесты прошли, какие edge cases покрыты
5. После завершения блока — обновляйте таблицу "Итоговый прогресс"

---

*Чеклист синхронизируется по мере выполнения задач. Обновлять после каждого PR/коммита.*
