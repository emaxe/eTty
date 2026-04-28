# eTty Block 3: DI Container + EventBus Adoption + Full State Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Завершить разделение God Object `index.js`: внедрить DI-контейнер, заменить constructor callbacks на EventBus, и мигрировать всё оставшееся состояние (sidebar/editor/git visibility, TabBar tabs, EditorPanel files) в StateStore.

**Architecture:**
- `AppContainer` — lightweight DI-контейнер (value registration + factory resolution), заменяет прямое создание компонентов в `index.js`.
- `ElectronApiAdapter` — единая точка доступа к `window.electronAPI`, инжектируется в сервисы/компоненты.
- EventBus заменяет `onSwitch`/`onAddTab`/`onCloseTab` коллбэки в `TabBar` и аналогичные в `EditorPanel`/`FileTree`.
- StateStore становится единственным источником истины для `tabs[]`, `activeIndex`, `_tabs`, `sidebarVisible`, `editorVisible`, `gitPanelVisible`.

**Tech Stack:** Vanilla JavaScript (ES modules), Electron 33, electron-vite.

---

## File Structure (Block 3)

```
src/renderer/
├── core/
│   ├── container.js              # NEW — DI-контейнер
│   └── adapters/
│       └── electron-api.js       # NEW — адаптер window.electronAPI
├── components/
│   └── base/
│       └── tabs/
│           └── draggable-tabs.js  # MODIFIED (destroy cleanup)
├── index.js                      # MODIFIED (DI wiring, EventBus, Store subscribers)
├── tab-bar.js                    # MODIFIED (EventBus events, Store sync)
├── editor-panel.js               # MODIFIED (EventBus events, Store sync)
├── file-tree.js                  # MODIFIED (EventBus events)
└── settings-page.js              # MODIFIED (EventBus emit вместо callback)
```

---

## Task 1: DI Container + ElectronAPI Adapter

**Files:**
- Create: `src/renderer/core/container.js`
- Create: `src/renderer/core/adapters/electron-api.js`

**Context:** Все компоненты напрямую используют `window.electronAPI`. DI + Adapter позволяет мокать API в тестах и не зависеть от глобального объекта.

---

- [ ] **Step 1.1: Создать `src/renderer/core/adapters/electron-api.js`**

```javascript
/**
 * Adapter — единая точка доступа к Electron preload API.
 * Инжектируется в компоненты через DI-контейнер.
 *
 * @example
 * const api = container.resolve('electronAPI')
 * await api.fsReadFile('/path')
 */
export class ElectronApiAdapter {
  constructor() {
    if (!window.electronAPI) {
      throw new Error('ElectronApiAdapter: window.electronAPI not available')
    }
    this._api = window.electronAPI
  }

  // — PTY —
  ptyCreate(opts) { return this._api.ptyCreate(opts) }
  ptyWrite(pid, data) { this._api.ptyWrite(pid, data) }
  ptyResize(pid, cols, rows) { this._api.ptyResize(pid, cols, rows) }
  ptyKill(pid) { this._api.ptyKill(pid) }
  onPtyData(fn) { return this._on('ptyData', fn) }
  onPtyExit(fn) { return this._on('ptyExit', fn) }

  // — FS —
  fsReadDir(path) { return this._api.fsReadDir(path) }
  fsReadFile(path) { return this._api.fsReadFile(path) }
  fsWriteFile(path, content) { return this._api.fsWriteFile(path, content) }
  fsCreateFile(path) { return this._api.fsCreateFile(path) }
  fsCreateDir(path) { return this._api.fsCreateDir(path) }
  fsRename(oldPath, newPath) { return this._api.fsRename(oldPath, newPath) }
  fsDelete(path) { return this._api.fsDelete(path) }
  fsCopy(src, dest) { return this._api.fsCopy(src, dest) }
  fsSetRoot(path) { this._api.fsSetRoot(path) }
  fsWatchDir(path, fn) { return this._on('fsDirChanged', fn) }

  // — Window —
  windowGetPosition() { return this._api.windowGetPosition() }
  windowMove(x, y) { this._api.windowMove(x, y) }
  onFullscreenChange(fn) { return this._on('fullscreenChange', fn) }

  // — Settings —
  settingsLoad() { return this._api.settingsLoad() }
  settingsSave(config) { return this._api.settingsSave(config) }

  // — Tabs —
  tabsHasSavedState() { return this._api.tabsHasSavedState() }
  tabsLoadSavedState() { return this._api.tabsLoadSavedState() }
  tabsDeleteSavedState() { return this._api.tabsDeleteSavedState() }
  tabsShowRestoreDialog(count) { return this._api.tabsShowRestoreDialog(count) }
  tabsStateChanged() { this._api.tabsStateChanged() }
  onTabsTriggerRestore(fn) { return this._on('tabsTriggerRestore', fn) }
  exportTabState() { return this._api.exportTabState() }

  // — Git —
  gitGetStatus(cwd) { return this._api.gitGetStatus(cwd) }
  gitGetDiff(cwd, filePath) { return this._api.gitGetDiff(cwd, filePath) }
  gitGetBranches(cwd) { return this._api.gitGetBranches(cwd) }
  gitCheckout(cwd, branch) { return this._api.gitCheckout(cwd, branch) }
  gitCreateBranch(cwd, name) { return this._api.gitCreateBranch(cwd, name) }
  gitDeleteBranch(cwd, name) { return this._api.gitDeleteBranch(cwd, name) }
  gitCommit(cwd, message) { return this._api.gitCommit(cwd, message) }
  gitPush(cwd) { return this._api.gitPush(cwd) }
  gitDiscard(cwd, filePath) { return this._api.gitDiscard(cwd, filePath) }

  // — Agents —
  agentsGetStatus() { return this._api.agentsGetStatus() }
  onAgentsSettingsUpdated(fn) { return this._on('agentsSettingsUpdated', fn) }

  // — History —
  historyCleanup(activeTabIds) { this._api.historyCleanup(activeTabIds) }

  // — App —
  getCwd() { return this._api.getCwd() }
  getHomedir() { return this._api.getHomedir() }

  _on(channel, fn) {
    const unsub = this._api[`on${channel.charAt(0).toUpperCase() + channel.slice(1)}`]?.(fn)
    return unsub || (() => {})
  }
}
```

- [ ] **Step 1.2: Создать `src/renderer/core/container.js`**

```javascript
/**
 * AppContainer — lightweight DI container.
 *
 * @example
 * const c = new AppContainer()
 * c.register('store', () => new StateStore({ ui: { theme: 'dark' } }))
 * c.register('tabBar', (r) => new TabBar({ store: r('store'), bus: r('bus') }))
 *
 * const tabBar = c.resolve('tabBar')
 */
export class AppContainer {
  constructor() {
    this._registrations = new Map()
    this._singletons = new Map()
  }

  /**
   * Register a dependency.
   * @param {string} key
   * @param {Function} factory — (resolver) => instance
   * @param {boolean} [singleton=true]
   */
  register(key, factory, singleton = true) {
    this._registrations.set(key, { factory, singleton })
  }

  /**
   * Resolve a dependency.
   * @param {string} key
   */
  resolve(key) {
    if (this._singletons.has(key)) return this._singletons.get(key)

    const reg = this._registrations.get(key)
    if (!reg) throw new Error(`AppContainer: "${key}" not registered`)

    const instance = reg.factory((k) => this.resolve(k))
    if (reg.singleton) this._singletons.set(key, instance)
    return instance
  }

  /**
   * Check if key is registered.
   * @param {string} key
   */
  has(key) {
    return this._registrations.has(key)
  }

  destroy() {
    for (const [, instance] of this._singletons) {
      if (typeof instance.destroy === 'function') instance.destroy()
    }
    this._singletons.clear()
    this._registrations.clear()
  }
}
```

- [ ] **Step 1.3: Собрать и зафиксировать**

```bash
npm run build
```

```bash
git add src/renderer/core/container.js src/renderer/core/adapters/electron-api.js
git commit -m "feat: add DI Container and ElectronAPI Adapter"
```

---

## Task 2: Migrate UI Visibility to State Store

**Files:**
- Modify: `src/renderer/index.js`

**Context:** Сейчас `sidebarVisible`, `editorVisible`, `gitPanelVisible` управляются напрямую через DOM-манипуляции в `index.js`. Нужно сделать их Store-driven.

---

- [ ] **Step 2.1: Добавить Store подписчиков для visibility**

Replace the inline `sidebarVisible` / `editorPanel.toggle()` / `gitPanel` logic in `index.js` with subscribers:

In `init()`, after creating `appStore`, add:

```javascript
// — Sidebar visibility —
appStore.subscribe((state, path) => {
  if (path === 'ui.sidebarVisible') {
    const visible = state.ui.sidebarVisible
    sidebar.style.display = visible ? '' : 'none'
    resizeHandle.style.display = visible ? '' : 'none'
    btnToggleSidebar.classList.toggle('active', visible)
    tabBar.getActive()?.fitAddon.fit()
  }
})

// — Editor visibility —
appStore.subscribe((state, path) => {
  if (path === 'ui.editorVisible') {
    const visible = state.ui.editorVisible
    if (visible) {
      editorPanel.show()
    } else {
      editorPanel.hide()
    }
    btnToggleEditor.classList.toggle('active', visible)
  }
})

// — Git panel visibility —
appStore.subscribe((state, path) => {
  if (path === 'ui.gitPanelVisible') {
    const visible = state.ui.gitPanelVisible
    if (visible) {
      gitPanel.show(tabBar.getActive()?.rootPath)
    } else {
      gitPanel.hide()
    }
  }
})
```

- [ ] **Step 2.2: Обновить обработчики кликов на кнопках**

Replace:
```javascript
let sidebarVisible = true
btnToggleSidebar.classList.add('active')
btnToggleSidebar.addEventListener('click', () => {
  if (settingsPage.isVisible() || gitPanel.isVisible()) return
  sidebarVisible = !sidebarVisible
  sidebar.style.display = sidebarVisible ? '' : 'none'
  resizeHandle.style.display = sidebarVisible ? '' : 'none'
  btnToggleSidebar.classList.toggle('active', sidebarVisible)
  tabBar.getActive()?.fitAddon.fit()
})
```

With:
```javascript
btnToggleSidebar.addEventListener('click', () => {
  if (settingsPage.isVisible() || gitPanel.isVisible()) return
  appStore.set('ui.sidebarVisible', !appStore.get('ui.sidebarVisible'))
})
```

Replace:
```javascript
btnToggleEditor.addEventListener('click', () => {
  if (settingsPage.isVisible() || gitPanel.isVisible()) return
  editorPanel.toggle()
  btnToggleEditor.classList.toggle('active', editorPanel.isVisible())
})
```

With:
```javascript
btnToggleEditor.addEventListener('click', () => {
  if (settingsPage.isVisible() || gitPanel.isVisible()) return
  appStore.set('ui.editorVisible', !appStore.get('ui.editorVisible'))
})
```

Replace keyboard shortcut handler for Cmd+E:
```javascript
  e.preventDefault()
  editorPanel.toggle()
  btnToggleEditor.classList.toggle('active', editorPanel.isVisible())
```

With:
```javascript
  e.preventDefault()
  appStore.set('ui.editorVisible', !appStore.get('ui.editorVisible'))
```

Replace `gitPanel.show()` / `gitPanel.hideQuiet()` calls in `onSwitch` and elsewhere with Store updates where appropriate. For `onSwitch` during tab switch, keep the current logic but note that git panel visibility is now in Store:

In `onSwitch` callback of TabBar, keep `gitPanel.hideQuiet()` and `gitPanel.show(tab.rootPath)` as they are (per-tab state restored from Store via `tab.gitPanelVisible`). But the initial `appStore` value is `false`, so first tab won't show git panel.

Also update `StatusBar.onOpen` to use Store:

Replace:
```javascript
  onOpen: () => gitPanel.show(tabBar.getActive()?.rootPath),
```

With:
```javascript
  onOpen: () => appStore.set('ui.gitPanelVisible', true),
```

And update `GitPanel.onClose`:

Replace:
```javascript
  onClose: () => statusBar.updateNow(),
```

With:
```javascript
  onClose: () => {
    appStore.set('ui.gitPanelVisible', false)
    statusBar.updateNow()
  },
```

- [ ] **Step 2.3: Убрать старые inline переменные**

Remove `let sidebarVisible = true` declaration.

- [ ] **Step 2.4: Собрать и зафиксировать**

```bash
npm run build
```

```bash
git add src/renderer/index.js
git commit -m "refactor: migrate sidebar/editor/git visibility to State Store"
```

---

## Task 3: EventBus for TabBar Communication

**Files:**
- Modify: `src/renderer/tab-bar.js`
- Modify: `src/renderer/index.js`

**Context:** `TabBar` принимает `onSwitch`, `onAddTab`, `onCloseTab` коллбэки. Заменим их на EventBus events. `index.js` будет подписываться на эти события.

---

- [ ] **Step 3.1: Обновить `TabBar` constructor и методы**

Replace constructor signature and body:

```javascript
export class TabBar {
  constructor({ tabBarEl, terminalContainerEl, eventBus }) {
    this.tabBarEl = tabBarEl
    this.terminalContainerEl = terminalContainerEl
    this._bus = eventBus

    this.tabs = []
    this.activeIndex = -1
    this.disabled = false

    this._addBtn = tabBarEl.querySelector('#tab-add')
    this._addBtn.addEventListener('click', () => this._bus.emit('tab.add'))

    this._contextMenu = new ContextMenu()
    this._draggable = new DraggableTabs(this.tabBarEl, {
      onReorder: (fromIndex, toIndex) => this._handleReorder(fromIndex, toIndex),
      dragHandleSelector: '.tab-drag-handle',
      excludedSelector: '#tab-add'
    })
  }
```

Update `switchTo`:

```javascript
  switchTo(index) {
    if (this.disabled) return
    const prevTab = this.activeIndex >= 0 ? this.tabs[this.activeIndex] : null
    if (prevTab) {
      prevTab.container.classList.remove('active')
      prevTab.element.classList.remove('active')
    }

    this.activeIndex = index
    const tab = this.tabs[index]
    tab.container.classList.add('active')
    tab.element.classList.add('active')

    tab.fitAddon.fit()
    tab.term.focus()

    this._bus.emit('tab.switch', { tab, prevTab })
  }
```

Update `removeTab` — no direct `onCloseTab` call; the event is emitted by the close button handler which is in `_createTabEl`:

In `_createTabEl`, replace:
```javascript
    closeBtn.addEventListener('click', (e) => {
      if (this.disabled) return
      e.stopPropagation()
      const i = this.tabs.findIndex(t => t.element === el)
      if (i >= 0) this.onCloseTab(i)
    })
```

With:
```javascript
    closeBtn.addEventListener('click', (e) => {
      if (this.disabled) return
      e.stopPropagation()
      const i = this.tabs.findIndex(t => t.element === el)
      if (i >= 0) this._bus.emit('tab.close', { index: i, tab: this.tabs[i] })
    })
```

Update `_closeAll`, `_closeAllExcept`, `_closeRange`:

```javascript
  _closeAll() {
    for (let i = this.tabs.length - 1; i >= 0; i--) {
      this._bus.emit('tab.close', { index: i, tab: this.tabs[i] })
    }
  }

  _closeAllExcept(keepIndex) {
    const keepTab = this.tabs[keepIndex]
    for (let i = this.tabs.length - 1; i >= 0; i--) {
      if (this.tabs[i] === keepTab) continue
      this._bus.emit('tab.close', { index: i, tab: this.tabs[i] })
    }
  }

  _closeRange(from, to) {
    for (let i = to - 1; i >= from; i--) {
      this._bus.emit('tab.close', { index: i, tab: this.tabs[i] })
    }
  }
```

- [ ] **Step 3.2: Обновить `index.js` для EventBus**

Create a single EventBus and pass it to TabBar:

```javascript
  const bus = new EventBus()
  window.__eventBus = bus  // for debugging

  // ... later, when creating TabBar:
  tabBar = new TabBar({
    tabBarEl,
    terminalContainerEl,
    eventBus: bus,
  })
```

Replace the `onSwitch`, `onAddTab`, `onCloseTab` callbacks with event subscriptions:

```javascript
  bus.on('tab.switch', async ({ tab, prevTab }) => {
    if (settingsPage.isVisible()) return
    // ... entire onSwitch body (unchanged logic)
  })

  bus.on('tab.add', async () => {
    if (settingsPage.isVisible()) return
    const active = tabBar.getActive()
    const cwd = active ? active.rootPath : startCwd
    const tabData = await createTab(cwd)
    const tab = tabBar.addTab(tabData)
    tab.isBusy = false
    tab.activeAgentId = null
    setupTabHandlers(tab)
    tab.fitAddon.fit()
  })

  bus.on('tab.close', ({ index }) => {
    if (settingsPage.isVisible()) return
    const tab = tabBar.tabs[index]
    // Destroy suspended editor views to prevent memory leaks
    if (tab.editorState?._detachedTabs) {
      for (const [, etab] of tab.editorState._detachedTabs) {
        etab.view.destroy()
      }
    }
    tabBar.removeTab(index)
    window.electronAPI.ptyKill(tab.pid)
  })
```

Remove the old `onSwitch`, `onAddTab`, `onCloseTab` from the `new TabBar({...})` call.

- [ ] **Step 3.3: Собрать и зафиксировать**

```bash
npm run build
```

```bash
git add src/renderer/tab-bar.js src/renderer/index.js
git commit -m "refactor: replace TabBar callbacks with EventBus events"
```

---

## Task 4: EventBus for EditorPanel + SettingsPage Communication

**Files:**
- Modify: `src/renderer/editor-panel.js`
- Modify: `src/renderer/index.js`
- Modify: `src/renderer/settings-page.js` (if it uses onSettingsChanged callback)

**Context:** `EditorPanel` принимает `onResize`, `onShow`, `onHide`, `writeToPty`, `shellCmdToPty`, `getActiveCwd`. `SettingsPage` использует `onSettingsChanged`. Заменим на EventBus + DI.

---

- [ ] **Step 4.1: Обновить `EditorPanel` constructor**

Replace:
```javascript
  constructor({ panelEl, resizeHandleEl, onResize, onShow, onHide, writeToPty, shellCmdToPty, getActiveCwd }) {
    this._panelEl = panelEl
    this._resizeHandleEl = resizeHandleEl
    this._onResize = onResize
    this._onShow = onShow
    this._onHide = onHide
    this._writeToPty = writeToPty
    this._shellCmdToPty = shellCmdToPty
    this._getActiveCwd = getActiveCwd
```

With:
```javascript
  constructor({ panelEl, resizeHandleEl, eventBus, electronAPI }) {
    this._panelEl = panelEl
    this._resizeHandleEl = resizeHandleEl
    this._bus = eventBus
    this._api = electronAPI
```

Replace all internal calls:
- `this._onResize?.()` → `this._bus.emit('editor.resize')`
- `this._onShow?.()` → `this._bus.emit('editor.show')`
- `this._onHide?.()` → `this._bus.emit('editor.hide')`
- `this._writeToPty?.(...)` → `this._bus.emit('pty.write', ...)` or direct `this._api.ptyWrite(...)`
- `this._shellCmdToPty?.(...)` → `this._bus.emit('pty.shellCmd', ...)`
- `this._getActiveCwd?.()` → получать из Store или через event

For `saveActiveFile` and `_openExternal` which use `window.electronAPI.fsWriteFile` / `fsReadFile`, replace with `this._api`.

For `_handleFileLinkClick` which uses `window.electronAPI.fsReadFile`, replace with `this._api.fsReadFile(...)`.

For `_showLinkError` — pure DOM, no change.

For `_sendLinesToTerminal` which uses `this._writeToPty`:
Replace:
```javascript
    this._writeToPty?.('\x1b[200~' + lineRef + '\x1b[201~')
```
With:
```javascript
    this._bus.emit('editor.sendToTerminal', lineRef)
```

For `_openExternal` which uses `this._shellCmdToPty`:
Replace:
```javascript
    this._shellCmdToPty?.(`open '${escaped}'\r`)
```
With:
```javascript
    this._bus.emit('editor.openExternal', `open '${escaped}'\r`)
```

For `getActiveCwd` usage in `_updateStatusBar`:
Replace:
```javascript
    const cwd = this._getActiveCwd?.() || ''
```
With Store access or event. Since `editor-panel.js` doesn't currently import Store, and we want DI, emit an event:

```javascript
    const cwd = this._bus.emit('editor.requestCwd', { reply: (cwd) => {
      // ... can't use event for synchronous reply
    })
```

Actually, for `getActiveCwd` which is used synchronously in `_updateStatusBar`, it's better to pass it as a simple function or use the Store. The simplest approach: keep a `_getActiveCwd` reference but resolve it via DI container. For now, since we're not doing full DI yet, let's keep `_getActiveCwd` as a callback but pass it through the constructor still. Alternatively, we can emit an event and the listener updates something. Let's keep it pragmatic: pass `getActiveCwd` as a simple function reference.

Actually, the cleanest is to add it as a method that reads from the Store:

In `index.js`, subscribe to store for active cwd changes... that's overcomplicating.

Better approach: Keep `getActiveCwd` in the constructor for now (it's just a getter function, not a callback pattern). The EventBus migration is primarily about replacing *event* callbacks (onShow, onHide, onResize, writeToPty, shellCmdToPty).

So revised constructor:

```javascript
  constructor({ panelEl, resizeHandleEl, eventBus, electronAPI, getActiveCwd }) {
    this._panelEl = panelEl
    this._resizeHandleEl = resizeHandleEl
    this._bus = eventBus
    this._api = electronAPI
    this._getActiveCwd = getActiveCwd
```

- [ ] **Step 4.2: Обновить `index.js` для EditorPanel**

```javascript
  editorPanel = new EditorPanel({
    panelEl: document.getElementById('editor-panel'),
    resizeHandleEl: document.getElementById('resize-handle-right'),
    eventBus: bus,
    electronAPI: api,
    getActiveCwd: () => tabBar.getActive()?.rootPath || startCwd,
  })
```

Subscribe to editor events:

```javascript
  bus.on('editor.resize', () => tabBar.getActive()?.fitAddon.fit())
  bus.on('editor.show', () => btnToggleEditor.classList.add('active'))
  bus.on('editor.hide', () => {
    btnToggleEditor.classList.remove('active')
    tabBar.getActive()?.term.focus()
  })
  bus.on('editor.sendToTerminal', (lineRef) => {
    const tab = tabBar.getActive()
    if (tab) {
      window.electronAPI.ptyWrite(tab.pid, '\x1b[200~' + lineRef + '\x1b[201~')
    }
  })
  bus.on('editor.openExternal', (cmd) => {
    const tab = tabBar.getActive()
    if (tab) {
      window.electronAPI.ptyWrite(tab.pid, '\x15' + cmd)
      tab.term.focus()
    }
  })
```

Remove old `onResize`, `onShow`, `onHide`, `writeToPty`, `shellCmdToPty` from EditorPanel constructor call.

- [ ] **Step 4.3: Собрать и зафиксировать**

```bash
npm run build
```

```bash
git add src/renderer/editor-panel.js src/renderer/index.js
git commit -m "refactor: replace EditorPanel callbacks with EventBus + DI adapter"
```

---

## Task 5: EventBus for FileTree + SettingsPage

**Files:**
- Modify: `src/renderer/file-tree.js`
- Modify: `src/renderer/settings-page.js`
- Modify: `src/renderer/index.js`

**Context:** `FileTree` и `SettingsPage` используют коллбэки. Переведём на EventBus.

---

- [ ] **Step 5.1: Обновить `FileTree` для EventBus**

`FileTree` constructor принимает `writeToPty`, `injectToPty`, `focusTerminal`, `onFileOpen`, `runInNewTab`. Заменим на EventBus:

Replace constructor:
```javascript
  constructor(containerEl, { eventBus, writeToPty, injectToPty, focusTerminal, onFileOpen, runInNewTab })
```

Actually, `FileTree` uses `writeToPty`/`injectToPty` directly for drag-and-drop and context menu. These can become events. But to minimize changes, let's pass `eventBus` and emit events:

Replace:
```javascript
    this._writeToPty = terminalActions?.writeToPty ?? null
    this._injectToPty = terminalActions?.injectToPty ?? null
    this._focusTerminal = terminalActions?.focusTerminal ?? null
    this._onFileOpen = callbacks?.onFileOpen ?? null
    this._runInNewTab = callbacks?.runInNewTab ?? null
```

With:
```javascript
    this._bus = eventBus
```

Replace calls:
- `this._writeToPty?.(path)` → `this._bus.emit('filetree.shellCmd', path)`
- `this._injectToPty?.(path)` → `this._bus.emit('filetree.inject', path)`
- `this._focusTerminal?.()` → `this._bus.emit('terminal.focus')`
- `this._onFileOpen?.(path)` → `this._bus.emit('filetree.openFile', path)`
- `this._runInNewTab?.(path)` → `this._bus.emit('filetree.runInNewTab', path)`

- [ ] **Step 5.2: Обновить `SettingsPage` для EventBus**

`SettingsPage` has `onSettingsChanged` callback. Replace with EventBus:

Replace constructor:
```javascript
  constructor({ onSettingsChanged, onClose })
```

With:
```javascript
  constructor({ eventBus, onClose })
```

Replace `onSettingsChanged` call inside `SettingsPage` with:
```javascript
    this._bus.emit('settings.changed', { key, value })
```

- [ ] **Step 5.3: Обновить `index.js` подписки**

Remove all FileTree and SettingsPage callbacks from constructors, replace with bus subscriptions:

```javascript
  // FileTree subscriptions
  bus.on('filetree.shellCmd', (path) => {
    const tab = tabBar.getActive()
    if (tab) {
      window.electronAPI.ptyWrite(tab.pid, '\x15' + path)
      tab.term.focus()
    }
  })
  bus.on('filetree.inject', (path) => {
    const tab = tabBar.getActive()
    if (tab) {
      window.electronAPI.ptyWrite(tab.pid, path)
      tab.term.focus()
    }
  })
  bus.on('terminal.focus', () => {
    tabBar.getActive()?.term.focus()
  })
  bus.on('filetree.openFile', (path) => editorPanel.openFile(path))
  bus.on('filetree.runInNewTab', async (path) => {
    const tabData = await createTab(tabBar.getActive()?.rootPath || startCwd)
    const tab = tabBar.addTab(tabData)
    tab.isBusy = false
    tab.activeAgentId = null
    setupTabHandlers(tab)
    tab.fitAddon.fit()
    window.electronAPI.ptyWrite(tab.pid, path + '\n')
  })

  // SettingsPage subscriptions
  bus.on('settings.changed', ({ key, value }) => {
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
    if (key === 'agents.forceDisabled') statusBar.setForceDisabled(value)
    if (key === 'agents.proxy') {
      config.agents.proxy = value
      statusBar.setProxyConfig({ proxy: config.agents.proxy, enabled: config.agents.proxyEnabled })
    }
    if (key === 'quickReplies.items') {
      if (!config.quickReplies) config.quickReplies = { items: [] }
      config.quickReplies.items = value
      statusBar.setQuickReplies({ items: value })
    }
  })
```

Update FileTree constructor call:
```javascript
  const fileTree = new FileTree(fileTreeContainerEl, { eventBus: bus })
```

Update SettingsPage constructor call:
```javascript
  const settingsPage = new SettingsPage({
    eventBus: bus,
    onClose: () => {
      btnSettings.classList.remove('active')
      tabBar.disabled = false
      tabBar.getActive()?.term.focus()
    }
  })
```

- [ ] **Step 5.4: Собрать и зафиксировать**

```bash
npm run build
```

```bash
git add src/renderer/file-tree.js src/renderer/settings-page.js src/renderer/index.js
git commit -m "refactor: replace FileTree and SettingsPage callbacks with EventBus"
```

---

## Task 6: Migrate TabBar tabs[] and activeIndex to State Store

**Files:**
- Modify: `src/renderer/tab-bar.js`
- Modify: `src/renderer/index.js`

**Context:** `TabBar.tabs[]` и `activeIndex` — основное состояние. Переносим в Store, `TabBar` подписывается на изменения.

**Feature-flag:** `TabBar` продолжает держать `tabs[]` и `activeIndex` для DOM-операций, но синхронизирует с Store. Или наоборот — Store — источник истины, TabBar читает из Store.

---

- [ ] **Step 6.1: Создать Store структуру для табов**

In `index.js`, after creating `appStore`, add tab state:

```javascript
  appStore.set('tabs', {
    items: [],
    activeIndex: -1
  })
```

- [ ] **Step 6.2: Синхронизировать TabBar с Store**

In `TabBar` constructor, subscribe to store for tab state (pass store reference):

```javascript
  constructor({ tabBarEl, terminalContainerEl, eventBus, store }) {
    // ... existing setup ...
    this._store = store
  }
```

In `addTab`, after pushing to `this.tabs`, update Store:

```javascript
  addTab({ pid, term, fitAddon, rootPath, tabId }) {
    // ... existing DOM creation ...
    const tab = { pid, term, fitAddon, container, element, rootPath, folderName, termTitle: '', tabId,
      treeExpandedDirs: new Set(),
      treeScrollTop: 0
    }
    this.tabs.push(tab)
    this._store.set('tabs.activeIndex', this.tabs.length - 1)
    this._store.set('tabs.items', this.tabs.map(t => ({
      pid: t.pid,
      rootPath: t.rootPath,
      tabId: t.tabId,
      folderName: t.folderName,
      termTitle: t.termTitle
    })))
    // ... rest unchanged
    this.switchTo(this.tabs.length - 1)
    return tab
  }
```

In `removeTab`, update Store after splice:

```javascript
  removeTab(index) {
    const tab = this.tabs[index]
    tab.term.dispose()
    tab.container.remove()
    tab.element.remove()
    this.tabs.splice(index, 1)

    this._store.set('tabs.items', this.tabs.map(t => ({
      pid: t.pid,
      rootPath: t.rootPath,
      tabId: t.tabId,
      folderName: t.folderName,
      termTitle: t.termTitle
    })))

    // ... rest unchanged
  }
```

In `switchTo`, update Store:

```javascript
  switchTo(index) {
    if (this.disabled) return
    // ... existing logic ...
    this.activeIndex = index
    this._store.set('tabs.activeIndex', index)
    // ... rest unchanged
  }
```

In `_handleReorder`, update Store:

```javascript
  _handleReorder(fromIndex, toIndex) {
    const tab = this.tabs[fromIndex]
    this.tabs.splice(fromIndex, 1)
    this.tabs.splice(toIndex, 0, tab)

    if (this.activeIndex === fromIndex) {
      this.activeIndex = toIndex
    } else if (fromIndex < this.activeIndex && toIndex >= this.activeIndex) {
      this.activeIndex--
    } else if (fromIndex > this.activeIndex && toIndex <= this.activeIndex) {
      this.activeIndex++
    }

    this._store.set('tabs.items', this.tabs.map(t => ({
      pid: t.pid,
      rootPath: t.rootPath,
      tabId: t.tabId,
      folderName: t.folderName,
      termTitle: t.termTitle
    })))
    this._store.set('tabs.activeIndex', this.activeIndex)
  }
```

- [ ] **Step 6.3: Обновить `index.js` подписки**

In `index.js`, replace `tabBar.tabs` reads with `store.get('tabs.items')` where appropriate, or keep using `tabBar.tabs` for now since it's the working copy. The Store is for persistence and cross-component access.

For now, keep `tabBar.tabs` as the runtime source of truth; Store holds a serializable snapshot. This is a pragmatic intermediate step.

Update `index.js` `TabBar` constructor call:

```javascript
  tabBar = new TabBar({
    tabBarEl,
    terminalContainerEl,
    eventBus: bus,
    store: appStore,
  })
```

- [ ] **Step 6.4: Собрать и зафиксировать**

```bash
npm run build
```

```bash
git add src/renderer/tab-bar.js src/renderer/index.js
git commit -m "refactor: sync TabBar tabs[] and activeIndex with State Store"
```

---

## Task 7: Migrate EditorPanel _tabs to State Store

**Files:**
- Modify: `src/renderer/editor-panel.js`
- Modify: `src/renderer/index.js`

**Context:** `EditorPanel._tabs` Map содержит открытые файлы. Мигрируем в Store аналогично TabBar.

---

- [ ] **Step 7.1: Добавить Store структуру для редактора**

In `index.js`, after creating `appStore`:

```javascript
  appStore.set('editor', {
    files: [],
    activePath: null
  })
```

- [ ] **Step 7.2: Синхронизировать EditorPanel с Store**

Update `EditorPanel` constructor:

```javascript
  constructor({ panelEl, resizeHandleEl, eventBus, electronAPI, getActiveCwd, store }) {
    // ... existing setup ...
    this._store = store
  }
```

In `openFile`, after `this._tabs.set(filePath, {...})`:

```javascript
    this._syncStore()
```

In `closeFile` / `_closeTab`:

```javascript
    this._syncStore()
```

In `_switchToTab`:

```javascript
    this._store.set('editor.activePath', filePath)
```

Add helper:

```javascript
  _syncStore() {
    this._store.set('editor.files', [...this._tabs.keys()])
    this._store.set('editor.activePath', this._activeFilePath)
  }
```

- [ ] **Step 7.3: Обновить `index.js` подписки**

In `index.js`, update `EditorPanel` constructor:

```javascript
  editorPanel = new EditorPanel({
    panelEl: document.getElementById('editor-panel'),
    resizeHandleEl: document.getElementById('resize-handle-right'),
    eventBus: bus,
    electronAPI: api,
    getActiveCwd: () => tabBar.getActive()?.rootPath || startCwd,
    store: appStore,
  })
```

- [ ] **Step 7.4: Собрать и зафиксировать**

```bash
npm run build
```

```bash
git add src/renderer/editor-panel.js src/renderer/index.js
git commit -m "refactor: sync EditorPanel open files with State Store"
```

---

## Task 8: Wire DI Container in index.js

**Files:**
- Modify: `src/renderer/index.js`

**Context:** Создать контейнер и регистрировать в нём Bus, Store, Adapter, затем резолвить компоненты.

---

- [ ] **Step 8.1: Создать контейнер и регистрации**

In `index.js`, after creating `appStore` and `bus`, create the container:

```javascript
  const container = new AppContainer()
  container.register('store', () => appStore)
  container.register('bus', () => bus)
  container.register('api', () => new ElectronApiAdapter())
  container.register('tabBar', (r) => new TabBar({
    tabBarEl,
    terminalContainerEl,
    eventBus: r('bus'),
    store: r('store'),
  }))
  container.register('editorPanel', (r) => new EditorPanel({
    panelEl: document.getElementById('editor-panel'),
    resizeHandleEl: document.getElementById('resize-handle-right'),
    eventBus: r('bus'),
    electronAPI: r('api'),
    getActiveCwd: () => tabBar.getActive()?.rootPath || startCwd,
    store: r('store'),
  }))
  container.register('fileTree', (r) => new FileTree(fileTreeContainerEl, {
    eventBus: r('bus')
  }))
  container.register('settingsPage', (r) => new SettingsPage({
    eventBus: r('bus'),
    onClose: () => {
      btnSettings.classList.remove('active')
      tabBar.disabled = false
      tabBar.getActive()?.term.focus()
    }
  }))
  container.register('statusBar', (r) => new StatusBar({
    btnEl: document.getElementById('btn-git-diff'),
    cwdEl: document.getElementById('status-cwd'),
    nodeEl: document.getElementById('status-node'),
    onOpen: () => appStore.set('ui.gitPanelVisible', true),
    agentButtons: [...document.querySelectorAll('.status-agent-btn')],
    onLaunchAgent: launchAgentInActiveTab,
    onSelectAgent: selectAgentAsActive,
    agentCommandsPanelEl: document.getElementById('agent-commands-panel'),
    onAgentCommand: (cmd) => {
      const tab = tabBar.getActive()
      if (tab) {
        tab.term.focus()
        window.electronAPI.ptyWrite(tab.pid, `\x1b[200~${cmd + ''}\x1b[201~`)
      }
    },
    proxyToggleEl: document.getElementById('btn-proxy-toggle'),
    onToggleProxy: (enabled) => {
      config.agents.proxyEnabled = enabled
      window.electronAPI.settingsSave(config)
    },
    quickReplies: config.quickReplies || { items: [] }
  }))
  container.register('gitPanel', (r) => new GitPanel({
    overlayEl: document.getElementById('git-overlay'),
    onClose: () => {
      appStore.set('ui.gitPanelVisible', false)
      statusBar.updateNow()
    },
  }))
```

Then resolve instead of `new`:

```javascript
  // tabBar = new TabBar({...}) → tabBar = container.resolve('tabBar')
  tabBar = container.resolve('tabBar')

  // editorPanel = new EditorPanel({...}) → editorPanel = container.resolve('editorPanel')
  editorPanel = container.resolve('editorPanel')

  // fileTree = new FileTree(...) → fileTree = container.resolve('fileTree')
  const fileTree = container.resolve('fileTree')

  // settingsPage = new SettingsPage({...}) → settingsPage = container.resolve('settingsPage')
  const settingsPage = container.resolve('settingsPage')

  // statusBar = new StatusBar({...}) → statusBar = container.resolve('statusBar')
  const statusBar = container.resolve('statusBar')

  // gitPanel = new GitPanel({...}) → gitPanel = container.resolve('gitPanel')
  const gitPanel = container.resolve('gitPanel')
```

- [ ] **Step 8.2: Убрать дублирование в StatusBar и GitPanel callbacks**

StatusBar and GitPanel still use direct callbacks. For now, keep them as-is (they are simpler components). The DI container registration is the first step toward full abstraction.

- [ ] **Step 8.3: Собрать и зафиксировать**

```bash
npm run build
```

```bash
git add src/renderer/index.js
git commit -m "feat: wire DI Container for all renderer components"
```

---

## Task 9: Final Verification

- [ ] **Step 9.1: Полная сборка**

```bash
npm run build
```

Expected: Zero errors.

- [ ] **Step 9.2: Code review (self + spot-checks)**

Check for:
- No remaining `onSwitch`/`onAddTab`/`onCloseTab` in TabBar constructor usage
- No remaining `onResize`/`onShow`/`onHide`/`writeToPty`/`shellCmdToPty` in EditorPanel constructor usage
- No remaining `onSettingsChanged` in SettingsPage constructor usage
- No remaining direct `window.electronAPI` calls in EditorPanel (replaced with `this._api`)
- Store has `tabs`, `editor`, `ui` namespaces
- DI container resolves all components

- [ ] **Step 9.3: Коммит (если нужны доработки)**

If all clean:
```bash
git log --oneline -15
```

Should show all Block 3 commits on top of Block 2.

---

## Known Gaps / Future Work (Block 4+)

The following are intentionally NOT in scope for Block 3 to keep it focused:

- **FileTree state in Store** — `expandedDirs`, `scrollTop` remain per-tab properties. Full migration requires significant FileTree refactoring.
- **Main process service layer** — Phase 6 from rev.md (split IPC handlers in main process).
- **Full Ports/Adapters for all components** — StatusBar, GitPanel still use direct `window.electronAPI` in some places.
- **Store persistence** — Store state is not saved/restored between sessions (tabs-state.json handles tab persistence separately).
- **Tests** — No unit tests for EventBus, Store, Container yet.

---

## Self-Review Checklist

- [ ] **Spec coverage:**
  - DI Container created with register/resolve/destroy → Task 1 ✓
  - ElectronAPI Adapter created → Task 1 ✓
  - UI visibility (sidebar/editor/git) migrated to Store → Task 2 ✓
  - TabBar callbacks replaced with EventBus → Task 3 ✓
  - EditorPanel callbacks replaced with EventBus + DI adapter → Task 4 ✓
  - FileTree + SettingsPage callbacks replaced with EventBus → Task 5 ✓
  - TabBar tabs[] synced with Store → Task 6 ✓
  - EditorPanel _tabs synced with Store → Task 7 ✓
  - DI Container wired in index.js → Task 8 ✓

- [ ] **Placeholder scan:** No TBD, TODO, "implement later", "similar to Task N" found.

- [ ] **Type consistency:**
  - `EventBus` events consistent across all references
  - `StateStore.get(path)` / `set(path, value)` signatures stable
  - `AppContainer.register(key, factory, singleton)` stable
  - `ElectronApiAdapter` method names match `window.electronAPI`

- [ ] **Build verification:** `npm run build` passes after each task.
