# Архитектурный обзор eTty: предложения по улучшению

> **Дата обзора:** 2026-04-25  
> **Актуальность:** Обзор отражает состояние кодовой базы на момент написания. Некоторые предложения уже реализованы (например, `config`, `fs-watch-recursive`, `file-tree-dnd`).

## Сводка текущего состояния

Проект **eTty** — Electron-приложение с терминалом, файл-деревом, редактором и Git-интеграцией. 
Стек: Electron 33, xterm.js, CodeMirror 6, node-pty, simple-git.

---

## 1. Критические архитектурные проблемы

### 1.1 God Object (index.js) — КРИТИЧНО
**Проблема:** `src/renderer/index.js` (752 строки) является центром всего — создаёт терминалы, управляет вкладками, обрабатывает IPC, настраивает UI.

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
  // Текущая вкладка
  activeTabId: null,
  
  // Все вкладки
  tabs: new Map(), // tabId -> TabState
  
  // UI состояние  
  ui: {
    sidebarVisible: true,
    editorVisible: false,
    gitPanelVisible: false,
    currentTheme: 'catppuccin-mocha'
  },
  
  // Подписки на изменения
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

### 3.2 Убрать магические числа и строки

**До:**
```javascript
// index.js:62
fontSize: 14,
scrollback: 10000,

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
  SCROLLBACK: 10000,
  FONT_FAMILY: 'Menlo, "SF Mono", Consolas, "Courier New", monospace'
}

// config/app-config.js
export const APP_CONFIG = {
  STATUS_POLL_INTERVAL_MS: 5000,
  GIT_PANEL_POLL_INTERVAL_MS: 3000,
  SIDEBAR_MIN_WIDTH: 150,
  SIDEBAR_MAX_WIDTH: 600,
  EDITOR_MIN_WIDTH: 250,
  EDITOR_MAX_WIDTH_RATIO: 0.8
}

// config/ui-dimensions.js
export const UI_DIMENSIONS = {
  FLOAT_BTN: { WIDTH: 24, HEIGHT: 24, MARGIN: 6 }
}
```

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

## 5. План миграции (поэтапный)

### Фаза 1: Безопасный рефакторинг (2-3 дня)
- [ ] Вынести константы в `config/`
- [ ] Создать `shared/ipc-channels.js` с константами вместо строк
- [ ] Извлечь `setupTabHandlers` в отдельный файл
- [ ] Убрать магические числа

### Фаза 2: UI-Kit базовый (3-4 дня)
- [ ] Создать `components/base/button/`
- [ ] Создать `components/base/context-menu/`
- [ ] Переписать существующие контекстные меню на базовый компонент

### Фаза 3: Event Bus + State (3-4 дня)
- [ ] Создать `core/event-bus.js`
- [ ] Создать `core/state-store.js`
- [ ] Перенести состояние темы в стор
- [ ] Перенести настройки в стор

### Фаза 4: DraggableTabs компонент (2 дня)
- [ ] Создать generic `DraggableTabs`
- [ ] Переписать `TabBar` и `EditorPanel` на его основе

### Фаза 5: Dependency Injection (3-4 дня)
- [ ] Создать `core/container.js`
- [ ] Создать порты и адаптеры
- [ ] Переписать `FileTree` на DI
- [ ] Переписать `EditorPanel` на DI

### Фаза 6: Main процесс (2-3 дня)
- [ ] Разделить IPC handlers по файлам
- [ ] Создать service layer в main

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

Приоритеты:
1. **Критический:** Разделить `index.js` на сервисы и компоненты
2. **Высокий:** Создать базовый UI-Kit и вынести константы
3. **Средний:** Внедрить Event Bus и централизованное состояние
4. **Низкий:** DI-контейнер и полная архитектура ports/adapters

Ожидаемые результаты:
- Код станет тестируемым (можно писать unit-тесты)
- Новые фичи будут добавляться быстрее
- Баги локализуются быстрее
- Можно будет легко заменить CodeMirror или xterm.js в будущем
