# Критические задачи по устранению замечаний аудита

**Дата:** 2024-05-04  
**Приоритет:** Критический → Высокий → Низкий  

---

## Блок A: Cleanup и утечки памяти (Sprint 1)

### A1. Добавить `destroy()` во все компоненты renderer
**Статус:** ✅ Завершено  
**Приоритет:** 🔴 Critical  
**Сложность:** M  
**Время:** 4-6ч  

**Компоненты для покрытия:**
- [ ] `TabBar` — отписка от DOM-обработчиков, `DraggableTabs.destroy()`, `ContextMenu.hide()`
- [ ] `FileTree` — очистка `_dirTimers`, `unwatchAll()`, удаление `_hoverOverlay`, отписка от `keydown`/`scroll`
- [ ] `EditorPanel` — `destroy()` всех `_tabs.view`, `DraggableTabs.destroy()`, `ContextMenu.hide()`
- [ ] `StatusBar` — объединить `stop()` в полноценный `destroy()`, удалить DOM-обработчики
- [ ] `SettingsPage` — очистка `_saveTimer`, удаление DOM-оверлея
- [ ] `GitPanel` — очистка `_errorTimer`, удаление DOM-обработчиков
- [ ] `TerminalKeyboardHandler` — `detach()` метод
- [ ] `TerminalOscHandler` — `detach()` метод
- [ ] `Diagnostics` — `destroy()` (вызов `stop()` + очистка `_samples`)
- [ ] `ContextMenu` — добавить `destroy()` (вызов `hide()` + очистка ссылки)

**Критерий приёмки:**
- Все классы из списка имеют метод `destroy()`
- `AppContainer.destroy()` корректно вызывает `destroy()` на всех зарегистрированных компонентах
- После вызова `destroy()` нет утечек DOM nodes (проверить через DevTools → Memory → Take heap snapshot)

---

### A2. Добавить cleanup при закрытии приложения
**Статус:** ✅ Завершено  
**Приоритет:** 🔴 Critical  
**Сложность:** S  
**Время:** 2-3ч  

**Что сделать:**
- [ ] Сохранить ссылку на `ResizeObserver` в переменную и вызвать `.disconnect()` перед закрытием
- [ ] Удалить глобальные обработчики `document.addEventListener`/`window.addEventListener` через `removeEventListener`
- [ ] Очистить `diagnosticsInterval` в `main/index.js` в обработчике `window-all-closed`
- [ ] Добавить `before-quit` обработчик в `AppService` для graceful shutdown

**Критерий приёмки:**
- После закрытия окна в dev-режиме (Cmd+W) нет dangling listeners
- `main/index.js` — `diagnosticsInterval` очищен

---

### A3. Очистка временных ZDOTDIR в `PtyManager`
**Статус:** ⬜ В ожидании  
**Приоритет:** 🔴 Critical  
**Сложность:** S  
**Время:** 1-2ч  

**Что сделать:**
- [ ] Сохранить путь к `zdotdir` в session-объекте
- [ ] В `kill()` и `killAll()` — удалять директорию через `fs.rmSync(zdotdir, { recursive: true, force: true })`
- [ ] Обработать ошибки удаления (логировать, не падать)

**Критерий приёмки:**
- После закрытия вкладки `/tmp/etty-XXXXXX` удалена
- При `killAll()` (закрытие приложения) — все tmp-директории очищены

---

### A4. Очистка FileTree watchers и таймеров
**Статус:** ⬜ В ожидании  
**Приоритет:** 🔴 Critical  
**Сложность:** S  
**Время:** 1-2ч  

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
**Статус:** ⬜ В ожидании  
**Приоритет:** 🔴 Critical  
**Сложность:** L  
**Время:** 6-8ч  

**Файлы для обработки:**
- [ ] `src/renderer/index.js` — все 35 вызовов `window.electronAPI.*` заменить на `api.*`
- [ ] `src/renderer/file-tree.js` — все 18 вызовов заменить на `this._api.*`
- [ ] `src/renderer/status-bar.js` — заменить `window.electronAPI.gitGetStatus` и `window.electronAPI.getHomedir` на `this._api.*`
- [ ] `src/renderer/git-panel.js` — все 9 вызовов заменить на `this._api.*`

**Критерий приёмки:**
- `grep -r "window.electronAPI" src/renderer/` возвращает 0 результатов (кроме `core/adapters/electron-api.js`)
- Все компоненты получают `api` через constructor (DI)
- `renderer/index.js` — `api = container.resolve('api')`, передаётся в компоненты

---

### B2. Устранение глобальных переменных в `renderer/index.js`
**Статус:** ⬜ В ожидании  
**Приоритет:** 🔴 Critical  
**Сложность:** M  
**Время:** 4-5ч  

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
**Статус:** ⬜ В ожидании  
**Приоритет:** 🔴 Critical  
**Сложность:** M  
**Время:** 3-4ч  

**Что сделать:**
- [ ] Использовать `fs.realpath()` перед проверкой `startsWith(this.cwd)`
- [ ] Добавить тесты на symlink escape (`ln -s /etc/passwd ./evil`)
- [ ] Документировать ограничения защиты

**Критерий приёмки:**
- `validatePath()` отклоняет пути, проходящие через symlink за пределы CWD
- Есть unit-test на symlink attack

---

### C2. Добавить try/catch в async IPC вызовы renderer
**Статус:** ⬜ В ожидании  
**Приоритет:** 🔴 Critical  
**Сложность:** M  
**Время:** 3-4ч  

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
**Статус:** ⬜ В ожидании  
**Приоритет:** 🔴 Critical  
**Сложность:** XS  
**Время:** 30мин  

**Что сделать:**
- [ ] Удалить локальную `countDiffLines` из `git-handlers.js`
- [ ] Импортировать `countDiffLines` из `git-service.js`

**Критерий приёмки:**
- `grep -r "countDiffLines" src/main/` показывает только одно определение (в `git-service.js`)

---

### D2. Унификация тем — устранить дублирование
**Статус:** ⬜ В ожидании  
**Приоритет:** 🟡 High  
**Сложность:** M  
**Время:** 3-4ч  

**Что сделать:**
- [ ] Вынести все темы из `theme-loader.js` в отдельные JSON-файлы (`src/main/themes/*.json`)
- [ ] Использовать `fs.readFile` для загрузки в runtime
- [ ] `src/renderer/themes.js` — импортировать из shared JSON или через IPC

**Критерий приёмки:**
- Нет дублирования тем между `themes.js` и `theme-loader.js`
- Все темы хранятся в одном месте

---

### D3. Устранить дублирование restore-tabs logic
**Статус:** ⬜ В ожидании  
**Приоритет:** 🟡 High  
**Сложность:** S  
**Время:** 2-3ч  

**Что сделать:**
- [ ] Вынести цикл создания вкладок из `init()` и `restoreTabs()` в отдельную функцию `createAndSetupTabs(tabsData)`
- [ ] Использовать эту функцию в обоих местах

**Критерий приёмки:**
- `init()` и `restoreTabs()` вызывают общую функцию
- Код создания вкладок — в одном месте

---

## Блок E: Разбиение файлов и декомпозиция (Sprint 5)

### E1. Разбить `renderer/index.js`
**Статус:** ⬜ В ожидании  
**Приоритет:** 🟡 High  
**Сложность:** L  
**Время:** 6-8ч  

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
**Статус:** ⬜ В ожидании  
**Приоритет:** 🟡 High  
**Сложность:** L  
**Время:** 6-8ч  

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
**Статус:** ⬜ В ожидании  
**Приоритет:** 🟡 High  
**Сложность:** S  
**Время:** 2-3ч  

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
**Статус:** ⬜ В ожидании  
**Приоритет:** 🟢 Low  
**Сложность:** XS  
**Время:** 10мин  

```json
"engines": {
  "node": ">=14.17.0"
}
```

---

### G2. Защита от рекурсии в `EventBus.emit`
**Статус:** ⬜ В ожидании  
**Приоритет:** 🟡 High  
**Сложность:** XS  
**Время:** 30мин  

**Что сделать:**
- [ ] Добавить флаг `_emitting` в `EventBus`
- [ ] Игнорировать или кидать ошибку при рекурсивном `emit`

---

### G3. Глубокая заморозка в `StateStore`
**Статус:** ⬜ В ожидании  
**Приоритет:** 🟡 High  
**Сложность:** XS  
**Время:** 30мин  

**Что сделать:**
- [ ] Использовать `deepFreeze` вместо `Object.freeze`
- [ ] Или вернуть shallow copies в `get()`

---

## Итоговая оценка

| Блок | Задачи | Сложность | Оценка времени |
|------|--------|-----------|----------------|
| A — Cleanup | 4 | S-M | 8-13ч |
| B — Адаптер/DI | 2 | M-L | 10-13ч |
| C — Безопасность | 2 | M | 6-8ч |
| D — Дедупликация | 3 | XS-M | 6-8ч |
| E — Разбиение | 2 | L | 12-16ч |
| F — Конфиг | 1 | S | 2-3ч |
| G — Прочее | 3 | XS | 1-1.5ч |
| **Итого** | **17** | | **45-62.5ч** |

**Рекомендуемый порядок:** A → C → B → D → F → E → G  
*(Сначала устраняем утечки и баги, потом рефакторим.)*
