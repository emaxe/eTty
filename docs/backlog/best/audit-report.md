# Аудит проекта eTty

**Дата:** 2024-05-04  
**Аудитор:** AI-агент  
**Область:** src/main, src/renderer, src/shared, src/preload  

---

## Резюме

Проект eTty имеет хорошую архитектурную основу (DI Container, EventBus, StateStore, IPC channels), но содержит критические нарушения инвариантов, массовые утечки памяти, дублирование кода и файлы, разросшиеся за разумные пределы. Ниже — полный список замечаний с оценкой важности.

---

## 1. Архитектурные инварианты (нарушения)

### 🔴 CRITICAL-1: Прямые вызовы `window.electronAPI` вместо адаптера
**Где:** `src/renderer/index.js` (35 вызовов), `src/renderer/file-tree.js` (18 вызовов), `src/renderer/status-bar.js` (3 вызова), `src/renderer/git-panel.js` (9 вызовов)  
**Что нарушено:** Инвариант «Адаптер» — не обращаться к `window.electronAPI` напрямую, только через `core/adapters/electron-api.js`.  
**Риск:** Прямая зависимость от preload API мешает мокированию в тестах, затрудняет рефакторинг и добавляет точки отказа при изменении preload API.

### 🔴 CRITICAL-2: Глобальные переменные в `renderer/index.js`
**Где:** `src/renderer/index.js`, строки 33–40  
```js
let currentThemeName = 'dark'
let loadedThemes = THEMES
let tabBar = null
let editorPanel = null
let appStore = null
```
**Что нарушено:** Инвариант «DI» — зависимости должны получаться через DI Container, не через глобальные переменные.  
**Риск:** Состояние размазано по модулю, невозможно тестировать изолированно, риск случайной мутации.

### 🔴 CRITICAL-3: Отсутствие `destroy()` у ключевых компонентов
**Где:**
| Компонент | Есть `destroy()`? |
|-----------|-------------------|
| `TabBar` | ❌ Нет |
| `FileTree` | ❌ Нет |
| `EditorPanel` | ❌ Нет (есть `view.destroy()`, но не у панели) |
| `StatusBar` | ❌ Нет (только `stop()`) |
| `SettingsPage` | ❌ Нет |
| `GitPanel` | ❌ Нет |
| `TerminalKeyboardHandler` | ❌ Нет (только `attach()`) |
| `TerminalOscHandler` | ❌ Нет (только `attach()`) |
| `Diagnostics` | ❌ Нет (только `start()`/`stop()`) |
| `ContextMenu` | ❌ Нет (только `hide()`) |
| `DraggableTabs` | ✅ Да |
| `Button` | ✅ Да |
| `EventBus` | ✅ Да |
| `StateStore` | ✅ Да |
| `AppContainer` | ✅ Да |

**Что нарушено:** Инвариант «Cleanup» — каждый компонент с подписками должен иметь `destroy()`.  
**Риск:** Утечки памяти (DOM nodes, timers, IPC listeners, EventBus подписки), особенно при закрытии вкладок или переключении сессий.

### 🔴 CRITICAL-4: Нет cleanup при закрытии приложения
**Где:** `src/renderer/index.js`  
**Что:** `ResizeObserver`, `setInterval`, `document.addEventListener`, `window.addEventListener` никогда не удаляются.  
**Риск:** При закрытии окна renderer process завершается, но при hot-reload (dev) или будущих тестах — утечки.

### 🟡 HIGH-1: Глобальные хаки для отладки
**Где:** `src/renderer/index.js`  
```js
window.__appStore = appStore
window.__eventBus = bus
window.__tabBar = tabBar
window.__diagnostics = diagnostics
window.__exportTabState = () => { ... }
```
**Риск:** Загрязнение глобального пространства, потенциальная утечка данных, сложно отслеживать зависимости.

---

## 2. Утечки памяти и ресурсов

### 🔴 CRITICAL-5: `ResizeObserver` не отключается
**Где:** `src/renderer/index.js`, строка 980  
```js
new ResizeObserver(debounce(...)).observe(terminalContainerEl)
```
**Риск:** Observer висит на DOM-элементе до перезагрузки страницы.

### 🔴 CRITICAL-6: `PtyManager` не удаляет временные ZDOTDIR
**Где:** `src/main/pty-manager.js`, `_createZdotdir()`  
**Что:** `fs.mkdtempSync` создаёт tmp-директорию, но при `kill()` или `killAll()` она не удаляется.  
**Риск:** Накопление мусора в `/tmp/etty-XXXXXX`, потенциально приводит к `EMFILE`.

### 🔴 CRITICAL-7: `FileTree` — не очищаются watchers и таймеры
**Где:** `src/renderer/file-tree.js`  
**Что:** `_dirTimers` (Map таймаутов), `_autoExpandTimer`, `_autoScrollTimer`, `_hoverOverlay` DOM — всё это остаётся при смене rootPath или закрытии.  
**Риск:** Накопление таймеров и DOM-элементов.

### 🟡 HIGH-2: `main/index.js` — `diagnosticsInterval` не очищается
**Где:** `src/main/index.js`, строка 69  
```js
const diagnosticsInterval = setInterval(..., 10000)
```
**Риск:** Интервал продолжает работать после `window-all-closed`, если процесс не завершился.

### 🟡 HIGH-3: `StatusBar` — не полный `destroy()`
**Где:** `src/renderer/status-bar.js`  
**Что:** `stop()` очищает interval и `visibilitychange`, но не удаляет DOM-обработчики (`click` на `_btnEl` и `_agentButtons`).  
**Риск:** Утечки DOM-обработчиков при пересоздании StatusBar.

---

## 3. Дублирование кода

### 🔴 CRITICAL-8: `countDiffLines` продублирована
**Где:**
- `src/main/git-service.js` (экспортированная версия)
- `src/main/ipc-handlers/git-handlers.js` (локальная копия)
**Риск:** При изменении логики подсчёта — рассинхронизация, баги в отображении diff.

### 🟡 HIGH-4: Дублирование тем
**Где:**
- `src/renderer/themes.js` (встроенные dark/light)
- `src/main/theme-loader.js` (BUILT_IN_THEMES + INITIAL_THEMES)
**Риск:** Поддержка двух источников истины для одних и тех же тем.

### 🟡 HIGH-5: Дублирование кода восстановления вкладок
**Где:** `src/renderer/index.js` — функции `init()` (строки 761–801) и `restoreTabs()` (строки 712–758) содержат идентичный цикл создания вкладок.  
**Риск:** Любое изменение логики восстановления нужно делать в двух местах.

---

## 4. Безопасность и надёжность

### 🔴 CRITICAL-9: `FileManager.validatePath` уязвим к symlink attacks
**Где:** `src/main/file-manager.js`, строка 28  
```js
validatePath(targetPath) {
  const resolved = path.resolve(targetPath)
  if (!resolved.startsWith(this.cwd)) { ... }
}
```
**Риск:** Симлинк внутри `this.cwd` может указывать за пределы директории, обходя защиту.

### 🔴 CRITICAL-10: Нет обработки ошибок в async функциях
**Где:** массово в `renderer/index.js` — `window.electronAPI.*` вызовы без `try/catch` (например, `tabsShowRestoreDialog`, `tabsLoadSavedState`, `settingsLoad`).  
**Риск:** Необработанные rejected promise могут привести к падению renderer process (Electron < 15) или тихим сбоям.

### 🟡 HIGH-6: `Diagnostics` использует `performance.memory` без проверки
**Где:** `src/renderer/core/diagnostics.js`, строка 61  
**Риск:** `performance.memory` — Chrome-only API, в других рендерерах (будущие миграции) будет `undefined`.

### 🟡 HIGH-7: `crypto.randomUUID()` в `tab-state.js`
**Где:** `src/main/tab-state.js`, строка 35  
**Риск:** В старых версиях Node.js (< 14.17.0) `crypto.randomUUID` не доступен без импорта `crypto` модуля.

---

## 5. Размер файлов и сложность

### 🟡 HIGH-8: Файлы, превышающие разумный размер
| Файл | Строки | Проблема |
|------|--------|----------|
| `src/renderer/index.js` | 987 | God-функция `init()`, смешение bootstrap, event wiring, business logic |
| `src/renderer/file-tree.js` | 1370 | Смешение DOM-манипуляций, DnD, multi-select, inline editing, context menus |
| `src/renderer/settings-page.js` | 669 | DOM-строительство, quick replies DnD, inline dialogs — всё в одном классе |
| `src/main/theme-loader.js` | 992 | 10 тем × ~80 строк каждая — лучше вынести в JSON-файлы |

**Риск:** Высокая когнитивная нагрузка, сложно вносить изменения без регрессий, невозможно unit-test отдельные части.

---

## 6. Архитектура main процесса

### 🟡 HIGH-9: `main/index.js` — `diagnosticsInterval` не очищается
**Уже упомянуто в CRITICAL-4.**

### 🟡 HIGH-10: `AppService` — нет обработки `before-quit`
**Где:** `src/main/services/app-service.js`  
**Риск:** Пользователь может закрыть окно до завершения сохранения состояния вкладок.

### 🟡 HIGH-11: `PtyManager` — hardcoded `SHELL_PATH = '/bin/zsh'`
**Где:** `src/main/pty-manager.js`, строка 7  
**Риск:** Приложение не запустится на Linux без zsh или на Windows.

### 🟡 HIGH-12: `FileManager` — `MAX_WATCHERS = 100` hardcoded
**Где:** `src/main/file-manager.js`, строка 13  
**Риск:** Магическое число, должно быть в конфиге.

### 🟡 HIGH-13: `HistoryManager` — `GLOBAL_LIMIT = 5000` hardcoded
**Где:** `src/main/history-manager.js`, строка 6  
**Риск:** Магическое число, должно быть в конфиге.

---

## 7. Прочие замечания

### 🟡 HIGH-14: `EditorPanel` — `suspendState()` и `restoreState()` сложны и хрупки
**Где:** `src/renderer/editor-panel.js`, строки 228–320  
**Риск:** Управление жизненным циклом CodeMirror views через detach/reattach — источник багов при быстром переключении вкладок.

### 🟡 HIGH-15: `EventBus` — нет защиты от рекурсивных `emit`
**Где:** `src/renderer/core/event-bus.js`, строка 47  
**Риск:** Handler, вызывающий `emit` того же события, может вызвать бесконечную рекурсию.

### 🟡 HIGH-16: `StateStore` — `Object.freeze` не глубокий
**Где:** `src/renderer/core/state-store.js`, строка 60  
```js
this._state = Object.freeze(newState)
```
**Риск:** Вложенные объекты не заморожены, подписчик может мутировать `state.ui.theme` и т.д.

### 🟢 LOW-1: `package.json` — нет поля `engines`
**Риск:** Неявное требование Node.js >= 14.17.0 (для `crypto.randomUUID`).

### 🟢 LOW-2: `theme-loader.js` — INITIAL_THEMES и BUILT_IN_THEMES дублируют `src/renderer/themes.js`
**Уже упомянуто в HIGH-4.**

---

## Статистика

| Категория | Количество |
|-----------|------------|
| 🔴 Critical | 10 |
| 🟡 High | 16 |
| 🟢 Low | 2 |
| **Всего** | **28** |

---

## Рекомендуемый порядок устранения

1. **Cleanup и destroy()** — устраняет утечки памяти (CRITICAL-3, CRITICAL-4, CRITICAL-5, CRITICAL-6, CRITICAL-7)
2. **Адаптер и DI** — рефакторинг прямых вызовов (CRITICAL-1, CRITICAL-2)
3. **Безопасность и надёжность** — validatePath, error handling (CRITICAL-9, CRITICAL-10)
4. **Дедупликация** — countDiffLines, themes (CRITICAL-8, HIGH-4, HIGH-5)
5. **Разбиение файлов** — уменьшение размера index.js, file-tree.js (HIGH-8)
6. **Конфигурация** — вынести hardcoded константы (HIGH-11, HIGH-12, HIGH-13)

---

*Аудит завершён. Рекомендуется провести повторный аудит после устранения critical-замечаний.*
