# eTty Block 2: Event Bus + State Store + DraggableTabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать Event Bus, централизованный State Store, generic компонент `DraggableTabs`, и портировать TabBar и EditorPanel на его основе. Фундамент для разделения God Object `index.js`.

**Architecture:**
- `EventBus` — pub/sub без привязки к DOM, scoped по неймспейсам.
- `StateStore` — иммутабельное хранилище с подписками, immer-style updates через `setPath`.
- `DraggableTabs` — generic drag-and-drop для табов, работает с любым контейнером и коллбэками.
- Постепенная миграция: создаём новые модули, старый код продолжает работать, потом подменяем.

**Tech Stack:** Vanilla JavaScript (ES modules), Electron 33, electron-vite.

---

## File Structure (Block 2)

```
src/renderer/
├── core/
│   ├── event-bus.js              # NEW
│   ├── state-store.js            # NEW
│   └── config/
│       └── app-config.js         # MODIFIED (add STATE_STORAGE_KEY if needed)
├── components/
│   └── base/
│       ├── tabs/
│       │   └── draggable-tabs.js  # NEW
│       └── ...
├── features/
│   └── terminal/...
├── index.js                      # MODIFIED (theme via Store)
├── tab-bar.js                    # MODIFIED (DnD via DraggableTabs)
└── editor-panel.js               # MODIFIED (DnD via DraggableTabs)
```

---

## Task 1: Event Bus (`src/renderer/core/event-bus.js`)

**Files:**
- Create: `src/renderer/core/event-bus.js`
- Test in: `src/renderer/index.js` (temporary, later removed)

**Context:** Сейчас компоненты общаются напрямую через коллбэки в конструктор (`onSwitch`, `onAddTab`, `onCloseTab`, `onSettingsChanged`). Event Bus даст декуплированную коммуникацию.

---

- [ ] **Step 1.1: Создать `src/renderer/core/event-bus.js`**

```javascript
/**
 * EventBus — typed pub/sub with optional namespacing.
 *
 * @example
 * const bus = new EventBus()
 * bus.on('theme.changed', (themeName) => applyTheme(themeName))
 * bus.emit('theme.changed', 'catppuccin-mocha')
 * bus.off('theme.changed', handler)
 */
export class EventBus {
  constructor() {
    this._listeners = new Map() // event -> Set<handler>
  }

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} handler
   * @returns {Function} unsubscribe function
   */
  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set())
    }
    this._listeners.get(event).add(handler)
    return () => this.off(event, handler)
  }

  /**
   * Unsubscribe from an event.
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    const set = this._listeners.get(event)
    if (set) {
      set.delete(handler)
      if (set.size === 0) this._listeners.delete(event)
    }
  }

  /**
   * Emit an event to all subscribers.
   * @param {string} event
   * @param {*} payload
   */
  emit(event, payload) {
    const set = this._listeners.get(event)
    if (!set) return
    for (const handler of set) {
      try {
        handler(payload, event)
      } catch (e) {
        console.error(`[EventBus] Error in handler for "${event}":`, e)
      }
    }
  }

  /**
   * Subscribe once.
   * @param {string} event
   * @param {Function} handler
   * @returns {Function} unsubscribe function
   */
  once(event, handler) {
    const wrapped = (payload, ev) => {
      this.off(ev, wrapped)
      handler(payload, ev)
    }
    return this.on(event, wrapped)
  }

  /**
   * Remove all listeners for an event, or all listeners globally.
   * @param {string} [event]
   */
  clear(event) {
    if (event) {
      this._listeners.delete(event)
    } else {
      this._listeners.clear()
    }
  }

  destroy() {
    this.clear()
  }
}
```

- [ ] **Step 1.2: Временно протестировать в `src/renderer/index.js`**

Add import at the top of `src/renderer/index.js`:
```javascript
import { EventBus } from './core/event-bus.js'
```

Add a temporary test inside `init()` (before other code), then remove after verification:
```javascript
const _testBus = new EventBus()
let called = false
const unsub = _testBus.on('test', (payload) => { called = payload === 42 })
_testBus.emit('test', 42)
if (!called) console.error('EventBus test FAILED')
else console.log('EventBus test OK')
unsub()
_testBus.destroy()
```

Remove this test code after verifying it works (check DevTools console).

- [ ] **Step 1.3: Собрать и зафиксировать**

Run:
```bash
npm run build
```

Expected: Build passes.

```bash
git add src/renderer/core/event-bus.js src/renderer/index.js
git commit -m "feat: add EventBus core component"
```

---

## Task 2: State Store (`src/renderer/core/state-store.js`)

**Files:**
- Create: `src/renderer/core/state-store.js`

**Context:** Сейчас `currentThemeName`, `sidebarVisible`, `editorVisible` и др. — разрозненные переменные в `index.js`. State Store централизует их.

---

- [ ] **Step 2.1: Создать вспомогательную функцию `setPath` (внутри файла или отдельно)**

```javascript
/**
 * Deep immutable set by dot-path.
 * @param {object} obj
 * @param {string} path — dot-separated, e.g. 'ui.sidebarVisible'
 * @param {*} value
 * @returns {object} new object (shallow copies along the path)
 */
function setPath(obj, path, value) {
  const keys = path.split('.')
  const root = { ...obj }
  let target = root
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    target[key] = target[key] ? { ...target[key] } : {}
    target = target[key]
  }
  target[keys[keys.length - 1]] = value
  return root
}
```

- [ ] **Step 2.2: Создать `StateStore`**

```javascript
import { setPath } from './set-path.js' // or inline if kept in same file

/**
 * StateStore — centralized reactive state with path-based updates.
 *
 * @example
 * const store = new StateStore({ ui: { theme: 'dark' } })
 * const unsub = store.subscribe((state, changedPath) => {
 *   if (changedPath === 'ui.theme') applyTheme(state.ui.theme)
 * })
 * store.set('ui.theme', 'light')
 */
export class StateStore {
  constructor(initialState = {}) {
    this._state = Object.freeze(initialState)
    this._listeners = new Set()
  }

  /**
   * Get current state (read-only).
   * @param {string} [path] — optional dot-path to get nested value
   * @returns {Readonly<object>}
   */
  get(path) {
    if (!path) return this._state
    const keys = path.split('.')
    let value = this._state
    for (const key of keys) {
      if (value == null) return undefined
      value = value[key]
    }
    return value
  }

  /**
   * Set value at a dot-path. Notifies subscribers.
   * @param {string} path
   * @param {*} value
   */
  set(path, value) {
    const newState = setPath(this._state, path, value)
    this._state = Object.freeze(newState)
    for (const fn of this._listeners) {
      try {
        fn(this._state, path)
      } catch (e) {
        console.error(`[StateStore] Error in subscriber for "${path}":`, e)
      }
    }
  }

  /**
   * Subscribe to all state changes.
   * @param {Function} fn — (state, changedPath) => void
   * @returns {Function} unsubscribe
   */
  subscribe(fn) {
    this._listeners.add(fn)
    return () => this._listeners.delete(fn)
  }

  destroy() {
    this._listeners.clear()
  }
}
```

- [ ] **Step 2.3: Создать `set-path.js` или инлайн**

If kept separate:
```bash
# Create src/renderer/core/set-path.js with the setPath function above
```

If inline, put `setPath` above `StateStore` in `state-store.js` and don't export it.

- [ ] **Step 2.4: Временно протестировать в `src/renderer/index.js`**

Add import:
```javascript
import { StateStore } from './core/state-store.js'
```

Add temporary test in `init()`:
```javascript
const _testStore = new StateStore({ ui: { theme: 'dark' }, count: 0 })
let notified = false
const unsubStore = _testStore.subscribe((state, path) => {
  if (path === 'ui.theme') notified = state.ui.theme === 'light'
})
_testStore.set('ui.theme', 'light')
if (!notified) console.error('StateStore test FAILED')
else console.log('StateStore test OK')
_testStore.set('count', 1)
unsubStore()
```

Remove test after verification.

- [ ] **Step 2.5: Собрать и зафиксировать**

```bash
npm run build
```

```bash
git add src/renderer/core/state-store.js
git commit -m "feat: add StateStore with path-based immutable updates"
```

---

## Task 3: Миграция темы в State Store

**Files:**
- Modify: `src/renderer/index.js`
- Modify: `src/renderer/core/state-store.js` (add `getSnapshot` or keep as-is)

**Context:** Сейчас `currentThemeName` — глобальная переменная в `index.js`. `applyTheme(themeName)` устанавливает CSS-переменные, обновляет терминалы, редактор. Нужно сделать так, чтобы `applyTheme` читал тему из Store, а Store уведомлял подписчиков.

**Feature-flag:** Оставить `currentThemeName` как fallback, но основной источник — Store.

---

- [ ] **Step 3.1: Инициализировать Store в `index.js`**

Inside `init()`, после загрузки настроек (`settingsLoad`), создать глобальный store:

```javascript
import { StateStore } from './core/state-store.js'

// ... inside init()
const { config, themes, warnings } = await window.electronAPI.settingsLoad()
loadedThemes = { ...THEMES, ...themes }

// Initialize store with current settings
const appStore = new StateStore({
  ui: {
    theme: config.appearance.theme || 'dark',
    focusIndicator: config.appearance.focusIndicator || 'none',
    sidebarVisible: true,
    editorVisible: false,
    gitPanelVisible: false,
  },
  settings: {
    collapseChildrenOnClose: config.fileTree?.collapseChildrenOnClose ?? true,
    fileOpenMode: config.fileTree?.fileOpenMode || 'double',
  }
})

// Expose for debugging (remove before production if desired)
window.__appStore = appStore
```

- [ ] **Step 3.2: Подписать `applyTheme` на Store**

Move `applyTheme` logic to a subscriber:

```javascript
// Replace current applyTheme function with store subscriber
appStore.subscribe((state, path) => {
  if (path === 'ui.theme') {
    const themeName = state.ui.theme
    const theme = loadedThemes[themeName]
    if (!theme) return
    currentThemeName = themeName // keep in sync for now

    const root = document.documentElement.style
    root.setProperty('--bg', theme.ui.bg)
    // ... all existing root.setProperty calls ...

    // Update terminals
    if (tabBar) {
      for (const tab of tabBar.tabs) {
        tab.term.options.theme = theme.terminal
      }
    }

    // Update editor
    if (editorPanel && theme.editor) {
      editorPanel.setTheme(theme.editor)
    }
  }
})
```

The original `applyTheme(themeName)` function can now be simplified to:
```javascript
function applyTheme(themeName) {
  appStore.set('ui.theme', themeName)
}
```

- [ ] **Step 3.3: Подписать `applyFocusIndicator` на Store**

```javascript
appStore.subscribe((state, path) => {
  if (path === 'ui.focusIndicator') {
    document.documentElement.dataset.focusStyle = state.ui.focusIndicator || 'none'
  }
})

function applyFocusIndicator(style) {
  appStore.set('ui.focusIndicator', style || 'none')
}
```

- [ ] **Step 3.4: Обновить `settingsPage.onSettingsChanged`**

Replace direct calls with Store updates:
```javascript
onSettingsChanged: (key, value) => {
  if (key === 'appearance.theme') applyTheme(value)
  if (key === 'appearance.focusIndicator') applyFocusIndicator(value)
  if (key === 'fileTree.collapseChildrenOnClose') {
    appStore.set('settings.collapseChildrenOnClose', value)
    fileTree.setCollapseChildrenOnClose(value)
  }
  if (key === 'fileTree.fileOpenMode') {
    appStore.set('settings.fileOpenMode', value)
    fileTree.setFileOpenMode(value)
  }
  // ... rest unchanged
}
```

Note: Store subscribers for `settings.*` can be added later. For now, keep the direct `fileTree.set*` calls.

- [ ] **Step 3.5: Убрать initial прямой вызов `applyTheme`**

Replace:
```javascript
applyTheme(config.appearance.theme)
applyFocusIndicator(config.appearance.focusIndicator)
```

With store initialization (the subscriber will fire automatically if we call `appStore.set` during init, or we can keep the initial CSS setup and let the subscriber handle updates). Simpler approach: keep initial `applyTheme(config.appearance.theme)` call but make `applyTheme` use `appStore.set`, which triggers the subscriber.

However, that would cause a double application (subscriber fires synchronously). To avoid double-work, initialize CSS directly during store creation or accept one extra pass (cheap since it's just CSS variables).

For safety, keep initial direct CSS setup as fallback, then use Store for all subsequent changes.

Actually simpler: `appStore.set('ui.theme', config.appearance.theme)` during init triggers subscriber once. All good.

- [ ] **Step 3.6: Собрать и зафиксировать**

```bash
npm run build
```

```bash
git add src/renderer/index.js
git commit -m "refactor: migrate theme and focus indicator to State Store"
```

---

## Task 4: Generic DraggableTabs (`src/renderer/components/base/tabs/draggable-tabs.js`)

**Files:**
- Create: `src/renderer/components/base/tabs/draggable-tabs.js`

**Context:** `tab-bar.js` (lines ~153-310) и `editor-panel.js` (lines ~858-980) содержат почти идентичный drag-and-drop код. Отличия:
- TabBar: drag handle = `.tab-drag-handle`, контейнер содержит кнопку `+` (не draggable)
- EditorPanel: drag handle = сам tab element, все children draggable
- TabBar: перестановка через `this.tabs.splice` + `insertBefore` relative to `_addBtn`
- EditorPanel: перестановка через rebuild Map + `insertBefore`

---

- [ ] **Step 4.1: Создать `DraggableTabs`**

```javascript
import { APP_CONFIG } from '../../core/config/app-config.js'

/**
 * Generic drag-and-drop tab reordering.
 *
 * Wires mouse events on draggable children of a container.
 * Reorders DOM elements visually during drag, then calls `onReorder(fromIndex, toIndex)`
 * so the parent can sync its internal data model.
 *
 * @example
 * const dt = new DraggableTabs(tabBarEl, {
 *   onReorder: (from, to) => { ... },
 *   dragHandleSelector: '.tab-drag-handle', // optional
 *   excludedSelector: '.tab-add-btn'          // optional, children to skip
 * })
 * // Later, as tabs are added:
 * dt.observeElement(tabElement)
 */
export class DraggableTabs {
  constructor(container, options = {}) {
    this._container = container
    this._onReorder = options.onReorder || (() => {})
    this._dragHandleSelector = options.dragHandleSelector || null
    this._excludedSelector = options.excludedSelector || null
    this._threshold = APP_CONFIG.DRAG_START_THRESHOLD_PX

    this._dragState = null
    this._dropIndicator = null

    this._onMouseMove = this._onMouseMove.bind(this)
    this._onMouseUp = this._onMouseUp.bind(this)

    // Observe existing children
    this._observeExisting()
  }

  _observeExisting() {
    for (const child of this._getDraggableChildren()) {
      this.observeElement(child)
    }
  }

  /**
   * Attach drag listener to a newly added tab element.
   * @param {HTMLElement} element
   */
  observeElement(element) {
    const handle = this._dragHandleSelector
      ? element.querySelector(this._dragHandleSelector)
      : element
    if (!handle) return

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      // Don't initiate drag if clicking a close button or other interactive element
      if (e.target.closest('.tab-close')) return
      this._startDrag(element, e)
    })
  }

  _getDraggableChildren() {
    const children = Array.from(this._container.children)
    if (!this._excludedSelector) return children
    return children.filter(el => !el.matches(this._excludedSelector))
  }

  _getChildIndex(element) {
    return this._getDraggableChildren().indexOf(element)
  }

  _startDrag(element, e) {
    e.stopPropagation()
    e.preventDefault()

    this._dragState = {
      element,
      startX: e.clientX,
      startY: e.clientY,
      isDragging: false,
      fromIndex: this._getChildIndex(element),
      dropTargetIndex: null,
    }

    document.addEventListener('mousemove', this._onMouseMove)
    document.addEventListener('mouseup', this._onMouseUp)
  }

  _onMouseMove(e) {
    const ds = this._dragState
    if (!ds) return

    const dx = e.clientX - ds.startX
    const dy = e.clientY - ds.startY

    if (!ds.isDragging) {
      if (Math.abs(dx) < this._threshold && Math.abs(dy) < this._threshold) return
      ds.isDragging = true
      ds.element.classList.add('dragging')
      document.body.style.cursor = 'grabbing'
      this._createDropIndicator()
    }

    const targetIndex = this._getDropIndex(e.clientX)
    if (targetIndex !== ds.dropTargetIndex) {
      ds.dropTargetIndex = targetIndex
      this._positionDropIndicator(targetIndex)
    }
  }

  _onMouseUp() {
    document.removeEventListener('mousemove', this._onMouseMove)
    document.removeEventListener('mouseup', this._onMouseUp)

    const ds = this._dragState
    if (!ds) return

    if (ds.isDragging && ds.dropTargetIndex != null) {
      const toIndex = ds.dropTargetIndex
      if (toIndex !== ds.fromIndex && toIndex !== ds.fromIndex + 1) {
        this._reorderDom(ds.fromIndex, toIndex)
        const insertAt = toIndex > ds.fromIndex ? toIndex - 1 : toIndex
        this._onReorder(ds.fromIndex, insertAt)
      }
    }

    ds.element.classList.remove('dragging')
    document.body.style.cursor = ''
    this._removeDropIndicator()
    this._dragState = null
  }

  _getDropIndex(clientX) {
    const children = this._getDraggableChildren()
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect()
      const midX = rect.left + rect.width / 2
      if (clientX < midX) return i
    }
    return children.length
  }

  _reorderDom(fromIndex, toIndex) {
    const children = this._getDraggableChildren()
    const element = children[fromIndex]
    const insertBefore = toIndex < children.length ? children[toIndex] : null

    if (insertBefore) {
      this._container.insertBefore(element, insertBefore)
    } else {
      this._container.appendChild(element)
    }
  }

  _createDropIndicator() {
    const indicator = document.createElement('div')
    indicator.className = 'tab-drop-indicator'
    this._container.appendChild(indicator)
    this._dropIndicator = indicator
  }

  _positionDropIndicator(targetIndex) {
    if (!this._dropIndicator) return
    const children = this._getDraggableChildren()
    const containerRect = this._container.getBoundingClientRect()
    let left
    if (targetIndex < children.length) {
      const rect = children[targetIndex].getBoundingClientRect()
      left = rect.left - containerRect.left - 1
    } else {
      const lastRect = children[children.length - 1].getBoundingClientRect()
      left = lastRect.right - containerRect.left - 1
    }
    this._dropIndicator.style.left = left + 'px'
  }

  _removeDropIndicator() {
    if (this._dropIndicator) {
      this._dropIndicator.remove()
      this._dropIndicator = null
    }
  }

  destroy() {
    if (this._dragState) {
      this._onMouseUp()
    }
    this._removeDropIndicator()
  }
}
```

- [ ] **Step 4.2: Собрать и зафиксировать**

```bash
npm run build
```

```bash
git add src/renderer/components/base/tabs/draggable-tabs.js
git commit -m "feat: add generic DraggableTabs component"
```

---

## Task 5: Port TabBar DnD to DraggableTabs

**Files:**
- Modify: `src/renderer/tab-bar.js`

---

- [ ] **Step 5.1: Удалить старый DnD код из `TabBar`**

Remove from `tab-bar.js`:
- `_dragState` initialization in constructor
- `_onDragMove` binding
- `_onDragEnd` binding
- `_initDrag` method
- `_onDragMove` method
- `_onDragEnd` method
- `_getDropIndex` method
- `_reorderTab` method
- `_createDropIndicator` method
- `_positionDropIndicator` method
- `_removeDropIndicator` method
- `mousedown` listener in `_createTabEl` (the drag handle listener)

Keep ALL other methods: `addTab`, `removeTab`, `switchTo`, `getActive`, `updateRootPath`, `_createTabEl` (minus drag listener), `_showTabContextMenu`, `_closeAll`, `_closeAllExcept`, `_closeRange`, `exportState`, `_updateTabLabel`, context menu click handlers.

- [ ] **Step 5.2: Использовать `DraggableTabs` в `TabBar`**

Add import:
```javascript
import { DraggableTabs } from './components/base/tabs/draggable-tabs.js'
```

In constructor, after existing initialization:
```javascript
this._draggable = new DraggableTabs(this.tabBarEl, {
  onReorder: (fromIndex, toIndex) => this._handleReorder(fromIndex, toIndex),
  dragHandleSelector: '.tab-drag-handle',
  excludedSelector: '#tab-add'
})
```

In `addTab`, after creating the element and appending it, register with DraggableTabs:
```javascript
// After: this.tabBarEl.insertBefore(element, this._addBtn)
this._draggable.observeElement(element)
```

Add `_handleReorder` method:
```javascript
_handleReorder(fromIndex, toIndex) {
  const tab = this.tabs[fromIndex]
  this.tabs.splice(fromIndex, 1)
  this.tabs.splice(toIndex, 0, tab)

  // Update activeIndex
  if (this.activeIndex === fromIndex) {
    this.activeIndex = toIndex
  } else if (fromIndex < this.activeIndex && toIndex >= this.activeIndex) {
    this.activeIndex--
  } else if (fromIndex > this.activeIndex && toIndex <= this.activeIndex) {
    this.activeIndex++
  }
}
```

- [ ] **Step 5.3: Собрать и зафиксировать**

```bash
npm run build
```

```bash
git add src/renderer/tab-bar.js
git commit -m "refactor: port TabBar drag-and-drop to DraggableTabs"
```

---

## Task 6: Port EditorPanel DnD to DraggableTabs

**Files:**
- Modify: `src/renderer/editor-panel.js`

---

- [ ] **Step 6.1: Удалить старый DnD код из `EditorPanel`**

Remove from `editor-panel.js`:
- `_dragState` initialization in constructor
- `_onEditorDragMove` binding
- `_onEditorDragEnd` binding
- `_initEditorDrag` method
- `_onEditorDragMove` method
- `_onEditorDragEnd` method
- `_getEditorDropIndex` method
- `_reorderEditorTab` method
- `_createEditorDropIndicator` method
- `_positionEditorDropIndicator` method
- `_removeEditorDropIndicator` method
- `mousedown` listener on tab element inside `_createTabElement` (the one that calls `_initEditorDrag`)

Keep everything else intact.

- [ ] **Step 6.2: Использовать `DraggableTabs` в `EditorPanel`**

Add import:
```javascript
import { DraggableTabs } from './components/base/tabs/draggable-tabs.js'
```

In constructor, after existing initialization:
```javascript
this._draggable = new DraggableTabs(this._tabBarEl, {
  onReorder: (fromIndex, toIndex) => this._handleReorder(fromIndex, toIndex)
})
```

No `dragHandleSelector` (whole tab is handle) and no `excludedSelector`.

In `_createTabElement` (where tab element is created), after appending to `_tabBarEl`, register:
```javascript
// After: this._tabBarEl.appendChild(tabEl)
this._draggable.observeElement(tabEl)
```

Remove the old mousedown listener that called `_initEditorDrag`.

Add `_handleReorder` method:
```javascript
_handleReorder(fromIndex, toIndex) {
  const keys = [...this._tabs.keys()]
  const fromPath = keys[fromIndex]

  keys.splice(fromIndex, 1)
  keys.splice(toIndex, 0, fromPath)

  // Rebuild Map in new order
  const newMap = new Map()
  for (const key of keys) {
    newMap.set(key, this._tabs.get(key))
  }
  this._tabs = newMap
}
```

- [ ] **Step 6.3: Собрать и зафиксировать**

```bash
npm run build
```

```bash
git add src/renderer/editor-panel.js
git commit -m "refactor: port EditorPanel drag-and-drop to DraggableTabs"
```

---

## Task 7: Финальная проверка Block 2

- [ ] **Step 7.1: Полная сборка**

```bash
npm run build
```

Expected: Zero errors.

- [ ] **Step 7.2: Code review (self + spot-checks)**

Check for:
- No remaining DnD code in `tab-bar.js` or `editor-panel.js` (search for `dragState`, `dropIndicator`, `initDrag`)
- `DraggableTabs` properly handles all cases
- State Store subscribers correctly applied theme/focus indicator
- No memory leaks (EventBus and Store have `destroy()`)

- [ ] **Step 7.3: Коммит (если нужны доработки)**

If all clean:
```bash
git log --oneline -10
```

Should show:
```
... refactor: port EditorPanel drag-and-drop to DraggableTabs
... refactor: port TabBar drag-and-drop to DraggableTabs
... feat: add generic DraggableTabs component
... refactor: migrate theme and focus indicator to State Store
... feat: add StateStore with path-based immutable updates
... feat: add EventBus core component
```

---

## Known Gaps / Future Work (Block 3+)

The following are intentionally NOT in scope for Block 2 to keep it focused:

- **Sidebar/editor/git visibility in Store** — `sidebarVisible`, `editorVisible`, `gitPanelVisible` initialized in Store but not yet driving UI via subscribers. Direct DOM manipulation in `index.js` still active.
- **Tab state in Store** — `TabBar.tabs[]`, `activeIndex` not yet in Store.
- **Editor tab state in Store** — `EditorPanel._tabs` Map not yet in Store.
- **FileTree state in Store** — `expandedDirs`, `scrollTop` remain per-tab properties.
- **EventBus adoption** — Components still communicate via constructor callbacks. EventBus is available but not yet wired.

These will be addressed in Block 3 (DI + full State migration).

---

## Self-Review Checklist

- [ ] **Spec coverage:**
  - Event Bus created with on/off/emit/once/clear/destroy → Task 1 ✓
  - State Store created with get/set/subscribe/destroy → Task 2 ✓
  - Theme migrated to Store → Task 3 ✓
  - DraggableTabs generic component → Task 4 ✓
  - TabBar uses DraggableTabs → Task 5 ✓
  - EditorPanel uses DraggableTabs → Task 6 ✓

- [ ] **Placeholder scan:** No TBD, TODO, "implement later", "similar to Task N" found.

- [ ] **Type consistency:**
  - `EventBus` methods consistent across all references
  - `StateStore.get(path)` / `set(path, value)` signatures stable
  - `DraggableTabs` constructor options names stable

- [ ] **Build verification:** `npm run build` passes after each task.
