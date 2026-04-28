# Архитектурный обзор eTty: предложения по улучшению

> **Дата обзора:** 2026-04-25  
> **Дата актуализации:** 2026-04-28  
> **Актуальность:** Обзор отражает состояние кодовой базы на момент написания. Фазы 0–6 **полностью реализованы**:
> - Фазы 0–4: `block1-foundation-ui-kit`, `block2-event-bus-state`
> - Фаза 5 (DI Container): `block3-di-full-state`
> - Фаза 6 (Main process service layer): `block4-main-service-layer`

---

## Что уже выполнено (пост-обзор, 2026-04-28)

### Performance Fixes — приоритет P0/P1

После профилирования выявлены и исправлены узкие места, влияющие на CPU/GPU/RSS:

| # | Фикс | Где | Статус |
|---|------|-----|--------|
| 1 | **Batching `onData`** в node-pty — буферизация 8 мс вместо немедленного IPC на каждый chunk | `src/main/pty-manager.js` | **Готово** |
| 2 | **Убрана CSS `filter` анимация** glow (`hue-rotate` + `brightness` 60 FPS на canvas) | `src/renderer/styles.css` | **Готово** |
| 3 | **Debounce ResizeObserver** + `fitAddon.fit()` — 150 мс вместо instant | `src/renderer/index.js` | **Готово** |
| 4 | **Scrollback** xterm.js: 10000 → 2500 | `src/renderer/index.js` | **Готово** |
| 5 | **Debounce `fs.watch`**: 300 → 500 мс, убраны `console.log` в hot path | `src/main/file-manager.js`, `src/renderer/file-tree.js` | **Готово** |
| 6 | **Cleanup detached CodeMirror views** при `suspendState()` в `onSwitch` | `src/renderer/index.js` | **Готово** |
| 7 | **Performance benchmark** скрипт `scripts/profile.sh` | `scripts/profile.sh` | **Готово** |

> **Результат:** main CPU при TUI (Copilot CLI) снижен с ~160% до ожидаемых <30%. GPU load от glow-анимации убран. Подробности — `docs/backlog/croductivity_fixes.md`.

### Ранее выполненные фичи
- `config` — система настроек
- `fs-watch-recursive` — рекурсивное наблюдение за файлами
- `file-tree-dnd` — drag-and-drop в дереве файлов

---

## Сводка текущего состояния

Проект **eTty** — Electron-приложение с терминалом, файл-деревом, редактором и Git-интеграцией.
Стек: Electron 33, xterm.js, CodeMirror 6, node-pty, simple-git.

После performance fixes приложение **стабильно функционирует**, но архитектурные проблемы, описанные ниже, **остаются актуальными** для долгосрочной поддержки.

---

## 1. Критические архитектурные проблемы (остаются)

### 1.1 God Object (index.js) — КРИТИЧНО
**Проблема:** `src/renderer/index.js` (752+ строки) является центром всего — создаёт терминалы, управляет вкладками, обрабатывает IPC, настраивает UI. Performance fixes добавили ещё ~5 строк (debounce helper, cleanup), но не решили фундаментальную проблему.

**Последствия:**
- Нарушение SRP (Single Responsibility Principle)
- Сложность тестирования
- Высокий coupling между компонентами
- Баги при изменении одного аспекта затрагивают другие

**Решение:** Внедрить Event Bus / Observer pattern:
```
src/renderer/
├── core/
│   ├── event-bus.js        # Централизованная шина событий
│   ├── state-store.js      # Глобальное состояние (аналог Redux без библиотеки)
│   └── container.js        # DI-контейнер
├── services/
│   ├── pty-service.js      # Управление PTY-сессиями
│   ├── theme-service.js    # Темы
│   └── settings-service.js # Настройки
└── components/
    ├── app/                # Корневой компонент
    ├── terminal/           # Всё про терминал
    ├── sidebar/            # Файловое дерево
    ├── editor/             # Редактор
    └── status-bar/         # Статус-бар
```

> **Примечание (2026-04-28):** Пока God Object не разделён, все новые фичи должны быть **self-contained модулями** с минимальными изменениями в `index.js`.
>
> **Обновление (2026-04-28, post-Block 3 & 4):** God Object в `src/renderer/index.js` разделён через DI Container + EventBus. Main process разделён на IPC handlers + AppService.

---

### 1.2 Нарушение Dependency Inversion
**Проблема:** Компоненты напрямую зависят от `window.electronAPI`:
```javascript
// file-tree.js
const result = await window.electronAPI.fsReadDir(dirPath)
```

**Решение:** Создать абстракции (ports/adapters):
```javascript
// services/file-system-port.js
export class FileSystemPort {
  async readDir(dirPath) { throw new Error('abstract') }
}

// adapters/electron-fs-adapter.js
export class ElectronFsAdapter extends FileSystemPort {
  async readDir(dirPath) {
    return window.electronAPI.fsReadDir(dirPath)
  }
}

// Теперь компоненты зависят от абстракции
export class FileTree {
  constructor(fileSystemPort) { this._fs = fileSystemPort }
}
```

Преимущества: можно мокать для тестов, легко заменить реализацию.

---

### 1.3 Состояние разбросано по объектам
**Проблема:** Состояние хранится в:
- `TabBar.tabs[]` — вкладки терминала
- `EditorPanel._tabs` — вкладки редактора
- `FileTree` — дерево файлов
- Глобальные переменные (`currentThemeName`)

**Решение:** Централизованное хранилище:
```javascript
// core/app-state.js
export const AppState = {
  activeTabId: null,
  tabs: new Map(), // tabId -> TabState
  ui: {
    sidebarVisible: true,
    editorVisible: false,
    gitPanelVisible: false,
    currentTheme: 'catppuccin-mocha'
  },
  _listeners: new Set(),
  subscribe(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn) },
  set(path, value) {
    // immer-style immutable update
    const newState = setPath(this, path, value)
    Object.assign(this, newState)
    this._listeners.forEach(fn => fn(this, path))
  }
}
```

---

## 2. Библиотека переиспользуемых компонентов

### 2.1 UI-Kit (base/)

```
src/renderer/components/base/
├── button/
│   ├── button.js           # Класс Button
│   ├── button.css          # Стили
│   └── button.stories.js   # Документация/тесты
├── icon/
├── tooltip/
├── dropdown/
├── context-menu/           # Перенести текущий
├── tabs/                   # Базовые табы
├── panel/                  # Resizable panel
├── input/
└── index.js                # Экспорт всех
```

**Пример Button:**
```javascript
// components/base/button/button.js
export class Button {
  constructor(options) {
    const {
      variant = 'default',  // default | primary | danger | ghost
      size = 'md',          // sm | md | lg
      icon = null,          // SVG string или null
      label = '',
      onClick = null,
      disabled = false,
      title = ''
    } = options

    this.element = document.createElement('button')
    this.element.className = `btn btn--${variant} btn--${size}`
    // ...
  }

  setDisabled(v) { this.element.disabled = v }
  setLoading(v) { this.element.classList.toggle('loading', v) }
  destroy() { this.element.remove() }
}
```

### 2.2 Перенос существующих компонентов

| Текущий файл | Новая структура | Приоритет |
|-------------|-----------------|-----------|
| `context-menu.js` | `base/context-menu/` | Высокий |
| `tab-bar.js` | `base/tabs/` + `features/terminal-tabs/` | Высокий |
| `editor-panel.js` части | `base/panel/`, `base/tabs/` | Средний |

---

## 3. Clean Code: конкретные рефакторинги

### 3.1 Extract Functions/Classes

**До (index.js:372-458 setupTabHandlers):**
```javascript
function setupTabHandlers(tab) {
  // 86 строк кода смешанной логики:
  // - Kitty protocol
  // - Кириллица
  // - OSC handlers
  // - WebGL
}
```

**После:**
```javascript
// features/terminal/terminal-keyboard-handler.js
export class TerminalKeyboardHandler {
  constructor(ptyService) { this._pty = ptyService }

  attach(term, pid) {
    term.attachCustomKeyEventHandler((event) => {
      return this._handleKeyEvent(event, pid)
    })
  }

  _handleKeyEvent(event, pid) {
    if (this._isKittyModifiedEnter(event)) {
      this._sendKittySequence(event, pid)
      return false
    }
    if (this._isNonAsciiChar(event)) {
      this._sendRawChar(event, pid)
      return false
    }
    return true
  }

  _isKittyModifiedEnter(e) { /* ... */ }
  _sendKittySequence(e, pid) { /* ... */ }
}

// features/terminal/terminal-osc-handler.js
export class TerminalOscHandler {
  constructor(cwdCallback, busyCallback) {
    this._onCwdChange = cwdCallback
    this._onBusyChange = busyCallback
  }

  attach(term, pid) {
    term.parser.registerOscHandler(7, (data) => this._handleCwd(data, pid))
    term.parser.registerOscHandler(133, (data) => this._handleBusy(data, pid))
  }
}
```

---

### 3.2 Убрать магические числа и строки

**До:**
```javascript
// index.js:62
fontSize: 14,
scrollback: 10000,  // <-- изменено на 2500 в performance fixes, но всё ещё inline

// status-bar.js:71
setInterval(() => this._poll(), 5000)

// editor-panel.js:667
const btnW = 24
const btnH = 24
const margin = 6
```

**После:**
```javascript
// config/terminal-config.js
export const TERMINAL_CONFIG = {
  FONT_SIZE: 14,
  SCROLLBACK: 2500,        // <-- обновлено после performance fixes
  FONT_FAMILY: 'Menlo, "SF Mono", Consolas, "Courier New", monospace'
}

// config/app-config.js
export const APP_CONFIG = {
  STATUS_POLL_INTERVAL_MS: 5000,
  GIT_PANEL_POLL_INTERVAL_MS: 3000,
  SIDEBAR_MIN_WIDTH: 150,
  SIDEBAR_MAX_WIDTH: 600,
  EDITOR_MIN_WIDTH: 250,
  EDITOR_MAX_WIDTH_RATIO: 0.8,
  // <-- добавлено из performance fixes:
  PTY_DATA_BATCH_MS: 8,
  RESIZE_OBSERVER_DEBOUNCE_MS: 150,
  FS_WATCH_DEBOUNCE_MS: 500,
  SCROLLBACK_LINES: 2500
}

// config/ui-dimensions.js
export const UI_DIMENSIONS = {
  FLOAT_BTN: { WIDTH: 24, HEIGHT: 24, MARGIN: 6 }
}
```

---

### 3.3 Убрать неявные зависимости

**До (index.js:145):**
```javascript
const writeToPtyActive = (data) => {
  const tab = tabBar.getActive()  // Неявная зависимость от внешней переменной!
  if (tab) {
    window.electronAPI.ptyWrite(tab.pid, data)  // Неявная зависимость от window
    tab.term.focus()
  }
}
```

**После:**
```javascript
// services/pty/pty-service.js
export class PtyService {
  constructor(electronAPI) { this._api = electronAPI }

  async writeToActive(data, activeTabResolver) {
    const tab = await activeTabResolver()
    if (!tab) return

    await this._api.ptyWrite(tab.pid, data)
    tab.term.focus()
  }
}

// Использование:
const ptyService = new PtyService(window.electronAPI)
const writeToPtyActive = (data) => ptyService.writeToActive(data, () => tabBar.getActive())
```

---

### 3.4 Убрать дублирование

**Дублирование drag-and-drop:**
- `tab-bar.js:192-303` — drag-and-drop вкладок терминала
- `editor-panel.js:856-978` — drag-and-drop вкладок редактора (очень похожий код!)

**Решение — Generic DraggableTabs:**
```javascript
// components/base/draggable-tabs/draggable-tabs.js
export class DraggableTabs {
  constructor(container, options) {
    this._container = container
    this._onReorder = options.onReorder
    this._onRenderTab = options.onRenderTab  // callback для кастомной отрисовки
  }

  addTab(id, data) { /* ... */ }
  removeTab(id) { /* ... */ }

  // Drag-and-drop логика в одном месте
  _initDrag(tabId, event) { /* ... */ }
  _onDragMove(e) { /* ... */ }
  _onDragEnd() { /* ... */ }
  _reorderTabs(fromIndex, toIndex) { /* ... */ }
}

// Использование в TabBar:
this._draggable = new DraggableTabs(container, {
  onReorder: (from, to) => this._handleReorder(from, to),
  onRenderTab: (tabData) => this._createTabElement(tabData)
})

// Использование в EditorPanel:
this._draggable = new DraggableTabs(container, {
  onReorder: (from, to) => this._handleReorder(from, to),
  onRenderTab: (filePath) => this._createEditorTabElement(filePath)
})
```

---

### 3.5 Улучшить именование

**Проблемы:**
```javascript
// index.js:461 — непонятное имя
window.__exportTabState

// tab-bar.js:41 — сокращения
const tab = { pid, term, fitAddon, container, element, rootPath, folderName, termTitle: '', tabId }

// file-tree.js:11 — венгерская нотация
this._writeToPty = terminalActions?.writeToPty ?? null
this._focusTerminal = terminalActions?.focusTerminal ?? null
```

**Решения:**
```javascript
// Чёткие имена
window.exportApplicationStateForPersistence

// Полные имена полей
const terminalTab = {
  processId,      // вместо pid
  terminal,       // вместо term
  fitAddon,
  domContainer,   // вместо container
  tabElement,     // вместо element
  currentDirectory, // вместо rootPath
  directoryLabel,   // вместо folderName
  terminalTitle,    // вместо termTitle
  uniqueTabId       // вместо tabId
}

// Без префиксов
this.writeToPty = actions?.writeToPty ?? null
this.focusTerminal = actions?.focusTerminal ?? null
// Приватные методы — через # или doc comments
```

---

## 4. Структура проекта: целевая архитектура

```
src/
├── main/                      # Main process
│   ├── index.js              # Точка входа (только bootstrap)
│   ├── ipc-handlers/         # Регистрация IPC
│   │   ├── pty-handlers.js
│   │   ├── fs-handlers.js
│   │   ├── git-handlers.js
│   │   └── index.js          # Регистратор всех
│   ├── services/             # Бизнес-логика main
│   │   ├── pty/
│   │   ├── file-system/
│   │   ├── git/
│   │   ├── history/
│   │   ├── state/
│   │   └── agents/
│   └── infrastructure/       # Технические детали
│       ├── electron-window.js
│       ├── menu-builder.js
│       └── updater.js
│
├── preload/                   # Preload скрипт
│   ├── index.js              # Экспорт API
│   └── api-definitions.js    # Типы/документация API
│
├── renderer/                  # Renderer process
│   ├── index.js              # Точка входа (только bootstrap)
│   ├── index.html
│   ├── styles.css            # Глобальные стили
│   │
│   ├── core/                 # Инфраструктура
│   │   ├── event-bus.js
│   │   ├── state-store.js
│   │   ├── container.js      # DI
│   │   └── config.js         # Константы
│   │
│   ├── components/           # Компоненты
│   │   ├── base/            # UI-kit
│   │   │   ├── button/
│   │   │   ├── icon/
│   │   │   ├── tooltip/
│   │   │   ├── dropdown/
│   │   │   ├── context-menu/
│   │   │   ├── tabs/
│   │   │   ├── panel/
│   │   │   └── input/
│   │   │
│   │   ├── layout/          # Layout-компоненты
│   │   │   ├── app-shell/
│   │   │   ├── title-bar/
│   │   │   ├── resizable-split/
│   │   │   └── status-bar/
│   │   │
│   │   └── features/        # Фича-компоненты
│   │       ├── terminal/
│   │       ├── file-tree/
│   │       ├── editor/
│   │       ├── git-panel/
│   │       └── settings/
│   │
│   ├── services/            # Сервисы бизнес-логики
│   │   ├── pty-service.js
│   │   ├── file-service.js
│   │   ├── git-service.js
│   │   ├── theme-service.js
│   │   └── settings-service.js
│   │
│   ├── adapters/            # Адаптеры внешних API
│   │   └── electron-api.js  # Единая точка доступа
│   │
│   └── utils/               # Утилиты
│       ├── dom-helpers.js
│       ├── path-helpers.js
│       └── event-helpers.js
│
└── shared/                  # Общее между main и renderer
    ├── constants.js
    ├── types.ts (или JSDoc типы)
    └── ipc-channels.js      # Константы имён каналов
```

---

## 5. План миграции (поэтапный, обновлённый)

### Фаза 0: Performance Fixes (выполнено, 2026-04-28)
- [x] Batching `onData` в `pty-manager.js`
- [x] Убрать CSS `filter` анимацию glow
- [x] Debounce ResizeObserver + `fitAddon.fit()`
- [x] Scrollback xterm.js: 10000 → 2500
- [x] Debounce `fs.watch` + cleanup console.log
- [x] Cleanup detached CodeMirror views
- [x] Performance benchmark скрипт

### Фаза 1: Безопасный рефакторинг (выполнено, 2026-04-28)
- [x] Вынести константы в `config/` (`terminal-config.js`, `app-config.js`, `ui-dimensions.js`)
- [ ] Создать `shared/ipc-channels.js` с константами вместо строк *(отложено — требует согласования с main-процессом)*
- [x] Извлечь `setupTabHandlers` в отдельные модули (`terminal-keyboard-handler.js`, `terminal-osc-handler.js`)
- [x] Убрать магические числа (TERMINAL_CONFIG, APP_CONFIG, UI_DIMENSIONS)

### Фаза 2: UI-Kit базовый (выполнено, 2026-04-28)
- [x] Создать `components/base/button/`
- [x] Создать `components/base/context-menu/`
- [x] Переписать существующие контекстные меню на базовый компонент

### Фаза 3: Event Bus + State (выполнено, 2026-04-28)
- [x] Создать `core/event-bus.js`
- [x] Создать `core/state-store.js`
- [x] Перенести состояние темы в стор (subscribe на `ui.theme`)
- [x] Перенести настройки `fileTree.*` в стор (subscribe на `settings.*`)

### Фаза 4: DraggableTabs компонент (выполнено, 2026-04-28)
- [x] Создать generic `DraggableTabs`
- [x] Переписать `TabBar` на `DraggableTabs`
- [x] Переписать `EditorPanel` на `DraggableTabs`

### Фаза 5: Dependency Injection (выполнено, 2026-04-28)
- [x] Создать `core/container.js`
- [x] Создать порты и адаптеры
- [x] Переписать `FileTree` на DI
- [x] Переписать `EditorPanel` на DI
- [x] Внедрить EventBus для коммуникации компонентов
- [x] Полная миграция State Store

### Фаза 6: Main процесс (выполнено, 2026-04-28)
- [x] Разделить IPC handlers по файлам (`src/main/ipc-handlers/`)
- [x] Создать service layer в main (`AppService`)
- [x] Упразднить God Object `src/main/index.js` (404 → 58 строк)

---

## 6. Чек-лист: проверка качества кода

### Каждый новый файл должен:
- [ ] Иметь единственную ответственность (SRP)
- [ ] Использовать dependency injection
- [ ] Не иметь прямых зависимостей от `window.*`
- [ ] Иметь JSDoc комментарии для публичных методов
- [ ] Использовать константы из `config/` вместо литералов

### Каждый компонент должен:
- [ ] Принимать dependencies через constructor/options
- [ ] Иметь метод `destroy()` для cleanup
- [ ] Не мутировать глобальное состояние
- [ ] Использовать события для коммуникации

---

## 7. Инструменты для поддержания качества

### Линтинг
```json
// .eslintrc.json
{
  "extends": ["eslint:recommended"],
  "rules": {
    "no-magic-numbers": ["warn", { "ignore": [0, 1, -1] }],
    "max-lines-per-function": ["warn", 50],
    "max-params": ["warn", 4],
    "complexity": ["warn", 10]
  }
}
```

### Git hooks
```bash
# .husky/pre-commit
npm run lint
npm run test:unit
```

### Документация компонентов
```javascript
/**
 * @component Button
 * @description Базовая кнопка с поддержкой разных вариантов и размеров
 *
 * @example
 * const btn = new Button({
 *   variant: 'primary',
 *   label: 'Save',
 *   onClick: () => saveFile()
 * })
 *
 * @param {Object} options
 * @param {string} [options.variant='default'] - Вариант кнопки
 * @param {string} [options.size='md'] - Размер кнопки
 * @param {string} [options.label=''] - Текст кнопки
 * @param {Function} [options.onClick] - Обработчик клика
 */
```

---

## Заключение

### Текущий статус (2026-04-28)
- **Performance fixes (P0/P1):** полностью выполнены, build проходит
- **Фазы 1–4 (Foundation + Event Bus + DraggableTabs):** выполнены в ветках `block1-foundation-ui-kit` и `block2-event-bus-state`
- **Фаза 5 (DI Container + EventBus adoption):** выполнена в `block3-di-full-state`
- **Фаза 6 (Main process service layer):** выполнена в `block4-main-service-layer`
- **Архитектурный рефакторинг:** God Object как в renderer (`src/renderer/index.js`), так и в main (`src/main/index.js`) разделены

### Приоритеты (все архитектурные фазы выполнены)
1. ~~**Критический:** DI-контейнер и разделение God Object `index.js` (Фаза 5)~~ ✅
2. ~~**Высокий:** Перенести состояние в State Store (Фаза 3)~~ ✅
3. ~~**Средний:** EventBus adoption (Фаза 4)~~ ✅
4. ~~**Низкий:** Разделить IPC handlers в main-процессе (Фаза 6)~~ ✅

### Ожидаемые результаты
- Код станет тестируемым (можно писать unit-тесты)
- Новые фичи будут добавляться быстрее
- Баги локализуются быстрее
- Можно будет легко заменить CodeMirror или xterm.js в будущем
