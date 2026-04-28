# eTty Block 1: Фундамент + UI-Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать фундамент рефакторинга: константы IPC-каналов, конфигурационные файлы, базовый UI-kit (ContextMenu, Button), извлечь обработчики терминала. Все существующие файлы продолжают работать; новые файлы — параллельно.

**Architecture:** Безопасный инкрементальный рефакторинг: новые модули создаются рядом со старыми, старые не удаляются. Импорты констант внедряются в существующие файлы без изменения логики.

**Tech Stack:** Vanilla JavaScript (ES modules), Electron 33, electron-vite build system.

---

## File Structure (Block 1)

```
src/
├── shared/
│   └── ipc-channels.js              # NEW: константы имён IPC-каналов
├── renderer/
│   ├── core/
│   │   └── config/
│   │       ├── terminal-config.js   # NEW: настройки терминала
│   │       ├── app-config.js        # NEW: интервалы, debounce, размеры
│   │       └── ui-dimensions.js     # NEW: размеры UI-элементов
│   ├── components/
│   │   └── base/
│   │       ├── context-menu/
│   │       │   ├── context-menu.js  # NEW: порт существующего
│   │       │   └── context-menu.css # NEW: выделенные стили
│   │       └── button/
│   │           ├── button.js        # NEW: базовый Button
│   │           └── button.css       # NEW: стили Button
│   └── features/
│       └── terminal/
│           ├── terminal-keyboard-handler.js  # NEW: Kitty + кириллица
│           └── terminal-osc-handler.js         # NEW: OSC 7 + OSC 133
```

---

## Task 1: IPC-каналы (`src/shared/ipc-channels.js`)

**Files:**
- Create: `src/shared/ipc-channels.js`
- Modify: `src/preload/index.js`
- Modify: `src/main/index.js`

**Context:** В `preload/index.js` и `main/index.js` имена каналов хардкожены строками (`'pty:create'`, `'fs:read-dir'` и т.д.). Цель — централизовать в константах.

---

- [ ] **Step 1.1: Создать `src/shared/ipc-channels.js`**

```javascript
/**
 * IPC channel names — shared between main and renderer processes.
 * Single source of truth for all inter-process communication.
 */

export const IPC_CHANNELS = Object.freeze({
  // PTY
  PTY_CREATE: 'pty:create',
  PTY_WRITE: 'pty:write',
  PTY_RESIZE: 'pty:resize',
  PTY_KILL: 'pty:kill',
  PTY_DATA: 'pty:data',
  PTY_EXIT: 'pty:exit',

  // File system
  FS_READ_DIR: 'fs:read-dir',
  FS_CREATE_FILE: 'fs:create-file',
  FS_CREATE_DIR: 'fs:create-dir',
  FS_RENAME: 'fs:rename',
  FS_DELETE: 'fs:delete',
  FS_COPY: 'fs:copy',
  FS_MOVE: 'fs:move',
  FS_READ_FILE: 'fs:read-file',
  FS_WRITE_FILE: 'fs:write-file',
  FS_GET_CWD: 'fs:get-cwd',
  FS_SET_ROOT: 'fs:set-root',
  FS_WATCH_DIR: 'fs:watch-dir',
  FS_UNWATCH_DIR: 'fs:unwatch-dir',
  FS_DIR_CHANGED: 'fs:dir-changed',

  // Window
  WINDOW_GET_POSITION: 'window:get-position',
  WINDOW_MOVE: 'window:move',
  WINDOW_FULLSCREEN_CHANGE: 'window:fullscreen-change',

  // Tabs / state
  TABS_EXPORT_STATE: 'tabs:export-state',
  TABS_HAS_SAVED_STATE: 'tabs:has-saved-state',
  TABS_LOAD_SAVED_STATE: 'tabs:load-saved-state',
  TABS_DELETE_SAVED_STATE: 'tabs:delete-saved-state',
  TABS_SHOW_RESTORE_DIALOG: 'tabs:show-restore-dialog',
  TABS_STATE_CHANGED: 'tabs:state-changed',
  TABS_TRIGGER_RESTORE: 'tabs:trigger-restore',

  // History
  HISTORY_CLEANUP: 'history:cleanup',

  // Settings
  SETTINGS_LOAD: 'settings:load',
  SETTINGS_SAVE: 'settings:save',

  // Agents
  AGENTS_GET_STATUS: 'agents:get-status',
  AGENTS_REFRESH: 'agents:refresh',
  AGENTS_SETTINGS_UPDATED: 'agents:settings-updated',

  // Git
  GIT_GET_ROOT: 'git:get-root',
  GIT_GET_STATUS: 'git:get-status',
  GIT_GET_DIFF: 'git:get-diff',
  GIT_GET_BRANCHES: 'git:get-branches',
  GIT_CHECKOUT: 'git:checkout',
  GIT_CREATE_BRANCH: 'git:create-branch',
  GIT_DELETE_BRANCH: 'git:delete-branch',
  GIT_COMMIT: 'git:commit',
  GIT_PUSH: 'git:push',
  GIT_DISCARD: 'git:discard',

  // App
  APP_HOMEDIR: 'app:homedir',
  APP_OPEN_EXTERNAL: 'app:open-external',
})
```

- [ ] **Step 1.2: Обновить `src/preload/index.js`**

Add import at the top:
```javascript
import { IPC_CHANNELS } from '../shared/ipc-channels.js'
```

Replace every string literal with the corresponding constant. For example:
```javascript
// BEFORE
ptyCreate: (options) => ipcRenderer.invoke('pty:create', options),

// AFTER
ptyCreate: (options) => ipcRenderer.invoke(IPC_CHANNELS.PTY_CREATE, options),
```

Apply the same replacement pattern to **all** 50+ channel references in the file. Complete transformed file:

```javascript
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels.js'

contextBridge.exposeInMainWorld('electronAPI', {
  ptyCreate: (options) => ipcRenderer.invoke(IPC_CHANNELS.PTY_CREATE, options),
  ptyWrite: (pid, data) => ipcRenderer.send(IPC_CHANNELS.PTY_WRITE, { pid, data }),
  ptyResize: (pid, cols, rows) => ipcRenderer.send(IPC_CHANNELS.PTY_RESIZE, { pid, cols, rows }),
  ptyKill: (pid) => ipcRenderer.invoke(IPC_CHANNELS.PTY_KILL, pid),
  onPtyData: (cb) => ipcRenderer.on(IPC_CHANNELS.PTY_DATA, (_, { pid, data }) => cb(pid, data)),
  onPtyExit: (cb) => ipcRenderer.on(IPC_CHANNELS.PTY_EXIT, (_, info) => cb(info)),
  getHomedir: () => ipcRenderer.invoke(IPC_CHANNELS.APP_HOMEDIR),
  fsReadDir: (dirPath) => ipcRenderer.invoke(IPC_CHANNELS.FS_READ_DIR, { dirPath }),
  fsCreateFile: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.FS_CREATE_FILE, { filePath }),
  fsCreateDir: (dirPath) => ipcRenderer.invoke(IPC_CHANNELS.FS_CREATE_DIR, { dirPath }),
  fsRename: (oldPath, newPath) => ipcRenderer.invoke(IPC_CHANNELS.FS_RENAME, { oldPath, newPath }),
  fsDelete: (targetPath) => ipcRenderer.invoke(IPC_CHANNELS.FS_DELETE, { targetPath }),
  fsCopy: (srcPath, destDir) => ipcRenderer.invoke(IPC_CHANNELS.FS_COPY, { srcPath, destDir }),
  fsMove: (srcPaths, destDir) => ipcRenderer.invoke(IPC_CHANNELS.FS_MOVE, { srcPaths, destDir }),
  fsReadFile: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.FS_READ_FILE, { filePath }),
  fsWriteFile: (filePath, content) => ipcRenderer.invoke(IPC_CHANNELS.FS_WRITE_FILE, { filePath, content }),
  getCwd: () => ipcRenderer.invoke(IPC_CHANNELS.FS_GET_CWD),
  fsSetRoot: (dirPath) => ipcRenderer.invoke(IPC_CHANNELS.FS_SET_ROOT, { dirPath }),
  fsWatchDir: async (dirPath) => {
    console.log('[Preload] fsWatchDir called:', dirPath)
    const result = await ipcRenderer.invoke(IPC_CHANNELS.FS_WATCH_DIR, { dirPath })
    console.log('[Preload] fsWatchDir result:', dirPath, result)
    return result
  },
  fsUnwatchDir: (dirPath) => ipcRenderer.invoke(IPC_CHANNELS.FS_UNWATCH_DIR, { dirPath }),
  onFsDirChanged: (cb) => ipcRenderer.on(IPC_CHANNELS.FS_DIR_CHANGED, (_, data) => cb(data)),
  windowGetPosition: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_GET_POSITION),
  windowMove: (x, y) => ipcRenderer.send(IPC_CHANNELS.WINDOW_MOVE, { x, y }),
  onFullscreenChange: (cb) => ipcRenderer.on(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGE, (_, isFullscreen) => cb(isFullscreen)),
  tabsHasSavedState: () => ipcRenderer.invoke(IPC_CHANNELS.TABS_HAS_SAVED_STATE),
  tabsLoadSavedState: () => ipcRenderer.invoke(IPC_CHANNELS.TABS_LOAD_SAVED_STATE),
  tabsDeleteSavedState: () => ipcRenderer.invoke(IPC_CHANNELS.TABS_DELETE_SAVED_STATE),
  tabsShowRestoreDialog: (tabCount) => ipcRenderer.invoke(IPC_CHANNELS.TABS_SHOW_RESTORE_DIALOG, tabCount),
  historyCleanup: (activeTabIds) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_CLEANUP, activeTabIds),
  tabsStateChanged: () => ipcRenderer.send(IPC_CHANNELS.TABS_STATE_CHANGED),
  onTabsTriggerRestore: (cb) => ipcRenderer.on(IPC_CHANNELS.TABS_TRIGGER_RESTORE, () => cb()),
  settingsLoad: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_LOAD),
  settingsSave: (settings) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SAVE, settings),
  agentsGetStatus: () => ipcRenderer.invoke(IPC_CHANNELS.AGENTS_GET_STATUS),
  agentsRefresh: () => ipcRenderer.invoke(IPC_CHANNELS.AGENTS_REFRESH),
  onAgentsSettingsUpdated: (cb) => ipcRenderer.on(IPC_CHANNELS.AGENTS_SETTINGS_UPDATED, (_, data) => cb(data)),
  gitGetRoot: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_ROOT, rootPath),
  gitGetStatus: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_STATUS, rootPath),
  gitGetDiff: (rootPath, filePath) => ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_DIFF, rootPath, filePath),
  gitGetBranches: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_BRANCHES, rootPath),
  gitCheckout: (rootPath, branch) => ipcRenderer.invoke(IPC_CHANNELS.GIT_CHECKOUT, rootPath, branch),
  gitCreateBranch: (rootPath, name) => ipcRenderer.invoke(IPC_CHANNELS.GIT_CREATE_BRANCH, rootPath, name),
  gitDeleteBranch: (rootPath, name) => ipcRenderer.invoke(IPC_CHANNELS.GIT_DELETE_BRANCH, rootPath, name),
  gitCommit: (rootPath, message) => ipcRenderer.invoke(IPC_CHANNELS.GIT_COMMIT, rootPath, message),
  gitPush: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.GIT_PUSH, rootPath),
  gitDiscard: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.GIT_DISCARD, rootPath),
  nodeVersion: process.versions.node,
  appOpenExternal: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.APP_OPEN_EXTERNAL, filePath),
})
```

- [ ] **Step 1.3: Обновить `src/main/index.js`**

Add import at the top (after existing imports):
```javascript
import { IPC_CHANNELS } from '../shared/ipc-channels.js'
```

Replace all string literals in `ipcMain.handle` / `ipcMain.on` / `webContents.send` calls with constants. Key replacements:

```javascript
// Line 81: agents:settings-updated → IPC_CHANNELS.AGENTS_SETTINGS_UPDATED
_mainWindow.webContents.send(IPC_CHANNELS.AGENTS_SETTINGS_UPDATED, {
  forceDisabled: config.agents.forceDisabled
})

// Line 97: pty:create → IPC_CHANNELS.PTY_CREATE
ipcMain.handle(IPC_CHANNELS.PTY_CREATE, async (event, options) => { ... })

// Line 121: pty:write → IPC_CHANNELS.PTY_WRITE
ipcMain.on(IPC_CHANNELS.PTY_WRITE, (_, { pid, data }) => { ... })

// Line 125: pty:resize → IPC_CHANNELS.PTY_RESIZE
ipcMain.on(IPC_CHANNELS.PTY_RESIZE, (_, { pid, cols, rows }) => { ... })

// Line 129: pty:kill → IPC_CHANNELS.PTY_KILL
ipcMain.handle(IPC_CHANNELS.PTY_KILL, async (_, pid) => { ... })

// Line 141: app:homedir → IPC_CHANNELS.APP_HOMEDIR
ipcMain.handle(IPC_CHANNELS.APP_HOMEDIR, () => os.homedir())

// Line 143: app:open-external → IPC_CHANNELS.APP_OPEN_EXTERNAL
ipcMain.handle(IPC_CHANNELS.APP_OPEN_EXTERNAL, async (_, filePath) => { ... })

// Line 149: window:get-position → IPC_CHANNELS.WINDOW_GET_POSITION
ipcMain.handle(IPC_CHANNELS.WINDOW_GET_POSITION, (event) => { ... })

// Line 154: window:move → IPC_CHANNELS.WINDOW_MOVE
ipcMain.on(IPC_CHANNELS.WINDOW_MOVE, (event, { x, y }) => { ... })

// Lines 159-258: all fs:* channels
ipcMain.handle(IPC_CHANNELS.FS_READ_DIR, async (_, { dirPath }) => { ... })
ipcMain.handle(IPC_CHANNELS.FS_CREATE_FILE, async (_, { filePath }) => { ... })
ipcMain.handle(IPC_CHANNELS.FS_CREATE_DIR, async (_, { dirPath }) => { ... })
ipcMain.handle(IPC_CHANNELS.FS_RENAME, async (_, { oldPath, newPath }) => { ... })
ipcMain.handle(IPC_CHANNELS.FS_DELETE, async (_, { targetPath }) => { ... })
ipcMain.handle(IPC_CHANNELS.FS_COPY, async (_, { srcPath, destDir }) => { ... })
ipcMain.handle(IPC_CHANNELS.FS_MOVE, async (_, { srcPaths, destDir }) => { ... })
ipcMain.handle(IPC_CHANNELS.FS_READ_FILE, async (_, { filePath }) => { ... })
ipcMain.handle(IPC_CHANNELS.FS_WRITE_FILE, async (_, { filePath, content }) => { ... })
ipcMain.handle(IPC_CHANNELS.FS_GET_CWD, () => { ... })
ipcMain.handle(IPC_CHANNELS.FS_SET_ROOT, (_, { dirPath }) => { ... })
ipcMain.handle(IPC_CHANNELS.FS_WATCH_DIR, (event, { dirPath }) => { ... })
ipcMain.handle(IPC_CHANNELS.FS_UNWATCH_DIR, (_, { dirPath }) => { ... })

// Lines 261-264: settings + agents
ipcMain.handle(IPC_CHANNELS.SETTINGS_LOAD, () => loadSettings())
ipcMain.handle(IPC_CHANNELS.SETTINGS_SAVE, (_, settings) => saveSettings(settings))
ipcMain.handle(IPC_CHANNELS.AGENTS_GET_STATUS, async () => agentService.getStatus())
ipcMain.handle(IPC_CHANNELS.AGENTS_REFRESH, async () => agentService.refresh())

// Line 273: tabs:export-state → IPC_CHANNELS.TABS_EXPORT_STATE
ipcMain.handle(IPC_CHANNELS.TABS_EXPORT_STATE, (event, tabs) => { ... })

// Lines 277-313: tabs + history
ipcMain.handle(IPC_CHANNELS.TABS_HAS_SAVED_STATE, () => hasTabState())
ipcMain.handle(IPC_CHANNELS.TABS_LOAD_SAVED_STATE, async () => { ... })
ipcMain.handle(IPC_CHANNELS.TABS_DELETE_SAVED_STATE, () => deleteTabState())
ipcMain.handle(IPC_CHANNELS.TABS_SHOW_RESTORE_DIALOG, async (event, tabCount) => { ... })
ipcMain.handle(IPC_CHANNELS.HISTORY_CLEANUP, async (_, activeTabIds) => { ... })

// Line 319: window:fullscreen-change → IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGE
mainWindow.webContents.send(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGE, true)

// Line 322: window:fullscreen-change → IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGE
mainWindow.webContents.send(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGE, false)

// Line 370: tabs:trigger-restore → IPC_CHANNELS.TABS_TRIGGER_RESTORE
mainWindow.webContents.send(IPC_CHANNELS.TABS_TRIGGER_RESTORE)

// Line 396: tabs:state-changed → IPC_CHANNELS.TABS_STATE_CHANGED
ipcMain.on(IPC_CHANNELS.TABS_STATE_CHANGED, () => buildMenu())
```

Note: `registerGitHandlers(ipcMain)` at line 266 is in a separate file (`git-service.js`). Leave it for Block 3 — don't modify it in Block 1.

- [ ] **Step 1.4: Собрать проект и проверить** 

Run:
```bash
npm run build
```

Expected: **Build succeeds with no errors.**

```bash
git add src/shared/ipc-channels.js src/preload/index.js src/main/index.js
git commit -m "refactor: extract IPC channel names to shared constants"
```

---

## Task 2: Конфигурационные файлы

**Files:**
- Create: `src/renderer/core/config/terminal-config.js`
- Create: `src/renderer/core/config/app-config.js`
- Create: `src/renderer/core/config/ui-dimensions.js`
- Modify: `src/renderer/index.js`
- Modify: `src/renderer/status-bar.js`
- Modify: `src/renderer/editor-panel.js`

---

- [ ] **Step 2.1: Создать `src/renderer/core/config/terminal-config.js`**

```javascript
/**
 * Terminal configuration constants.
 */

export const TERMINAL_CONFIG = Object.freeze({
  CURSOR_BLINK: true,
  FONT_SIZE: 14,
  FONT_FAMILY: 'Menlo, "SF Mono", Consolas, "Courier New", monospace',
  SCROLLBACK: 2500,
  ALLOW_PROPOSED_API: true,
  DEFAULT_COLS: 80,
  DEFAULT_ROWS: 24,
})
```

- [ ] **Step 2.2: Создать `src/renderer/core/config/app-config.js`**

```javascript
/**
 * Application-wide configuration: intervals, debounce delays, panel sizes.
 */

export const APP_CONFIG = Object.freeze({
  // Polling intervals (ms)
  STATUS_POLL_INTERVAL_MS: 5000,
  GIT_PANEL_POLL_INTERVAL_MS: 3000,

  // Debounce / batch delays (ms)
  PTY_DATA_BATCH_MS: 8,
  RESIZE_OBSERVER_DEBOUNCE_MS: 150,
  FS_WATCH_DEBOUNCE_MS: 500,

  // Sidebar resize constraints (px)
  SIDEBAR_MIN_WIDTH: 150,
  SIDEBAR_MAX_WIDTH: 600,

  // Editor panel resize constraints
  EDITOR_MIN_WIDTH: 250,
  EDITOR_MAX_WIDTH_RATIO: 0.8,

  // Interaction thresholds
  DOUBLE_CLICK_THRESHOLD_MS: 500,
  DRAG_START_THRESHOLD_PX: 5,
  TITLEBAR_DRAG_THRESHOLD_PX: 3,
})
```

- [ ] **Step 2.3: Создать `src/renderer/core/config/ui-dimensions.js`**

```javascript
/**
 * UI element dimensions (px).
 */

export const UI_DIMENSIONS = Object.freeze({
  FLOAT_BTN: Object.freeze({
    WIDTH: 24,
    HEIGHT: 24,
    MARGIN: 6,
  }),
})
```

- [ ] **Step 2.4: Обновить `src/renderer/index.js` — импорт и использование TERMINAL_CONFIG**

Add import at the top:
```javascript
import { TERMINAL_CONFIG } from './core/config/terminal-config.js'
import { APP_CONFIG } from './core/config/app-config.js'
```

Replace inline terminal options in `createTab` (line 62-68):
```javascript
// BEFORE
const term = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  fontFamily: 'Menlo, "SF Mono", Consolas, "Courier New", monospace',
  scrollback: 2500,
  allowProposedApi: true,
  theme: loadedThemes[currentThemeName].terminal
})

// AFTER
const term = new Terminal({
  cursorBlink: TERMINAL_CONFIG.CURSOR_BLINK,
  fontSize: TERMINAL_CONFIG.FONT_SIZE,
  fontFamily: TERMINAL_CONFIG.FONT_FAMILY,
  scrollback: TERMINAL_CONFIG.SCROLLBACK,
  allowProposedApi: TERMINAL_CONFIG.ALLOW_PROPOSED_API,
  theme: loadedThemes[currentThemeName].terminal,
})
```

Replace PTY create options (line 79):
```javascript
// BEFORE
const { pid } = await window.electronAPI.ptyCreate({ cols: 80, rows: 24, cwd, tabId, promptStyle })

// AFTER
const { pid } = await window.electronAPI.ptyCreate({
  cols: TERMINAL_CONFIG.DEFAULT_COLS,
  rows: TERMINAL_CONFIG.DEFAULT_ROWS,
  cwd,
  tabId,
  promptStyle,
})
```

Replace sidebar resize constants (line 748):
```javascript
// BEFORE
const newWidth = Math.max(150, Math.min(600, startWidth + e.clientX - startX))

// AFTER
const newWidth = Math.max(
  APP_CONFIG.SIDEBAR_MIN_WIDTH,
  Math.min(APP_CONFIG.SIDEBAR_MAX_WIDTH, startWidth + e.clientX - startX)
)
```

Replace editor resize constants (line 770):
```javascript
// BEFORE
const newWidth = Math.max(250, Math.min(window.innerWidth * 0.8, startWidth - (e.clientX - startX)))

// AFTER
const newWidth = Math.max(
  APP_CONFIG.EDITOR_MIN_WIDTH,
  Math.min(window.innerWidth * APP_CONFIG.EDITOR_MAX_WIDTH_RATIO, startWidth - (e.clientX - startX))
)
```

Replace ResizeObserver debounce (line 793):
```javascript
// BEFORE
new ResizeObserver(debounce(() => tabBar.getActive()?.fitAddon.fit(), 150))

// AFTER
new ResizeObserver(debounce(() => tabBar.getActive()?.fitAddon.fit(), APP_CONFIG.RESIZE_OBSERVER_DEBOUNCE_MS))
```

Replace titlebar drag threshold (line 721):
```javascript
// BEFORE
if (!titlebarDidDrag && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {

// AFTER
if (!titlebarDidDrag && (Math.abs(dx) > APP_CONFIG.TITLEBAR_DRAG_THRESHOLD_PX || Math.abs(dy) > APP_CONFIG.TITLEBAR_DRAG_THRESHOLD_PX)) {
```

- [ ] **Step 2.5: Обновить `src/renderer/status-bar.js` — импорт APP_CONFIG**

Add import at the top:
```javascript
import { APP_CONFIG } from './core/config/app-config.js'
```

Replace interval (line 88):
```javascript
// BEFORE
this._intervalId = setInterval(() => this._poll(), 5000)

// AFTER
this._intervalId = setInterval(() => this._poll(), APP_CONFIG.STATUS_POLL_INTERVAL_MS)
```

Replace double-click threshold (line 47):
```javascript
// BEFORE
const isDoubleClick = now - lastClickTime < 500

// AFTER
const isDoubleClick = now - lastClickTime < APP_CONFIG.DOUBLE_CLICK_THRESHOLD_MS
```

- [ ] **Step 2.6: Обновить `src/renderer/editor-panel.js` — импорт UI_DIMENSIONS**

Add import at the top:
```javascript
import { UI_DIMENSIONS } from './core/config/ui-dimensions.js'
```

Replace magic numbers in `_positionFloatBtn` (lines 667-669):
```javascript
// BEFORE
const btnW = 24
const btnH = 24
const margin = 6

// AFTER
const btnW = UI_DIMENSIONS.FLOAT_BTN.WIDTH
const btnH = UI_DIMENSIONS.FLOAT_BTN.HEIGHT
const margin = UI_DIMENSIONS.FLOAT_BTN.MARGIN
```

- [ ] **Step 2.7: Собрать и проверить**

Run:
```bash
npm run build
```

Expected: **Build succeeds with no errors.**

```bash
git add src/renderer/core/config/ src/renderer/index.js src/renderer/status-bar.js src/renderer/editor-panel.js
git commit -m "refactor: extract magic numbers to config constants"
```

---

## Task 3: Базовый ContextMenu

**Files:**
- Create: `src/renderer/components/base/context-menu/context-menu.js`
- Create: `src/renderer/components/base/context-menu/context-menu.css`
- Modify: `src/renderer/styles.css`

---

- [ ] **Step 3.1: Создать `src/renderer/components/base/context-menu/context-menu.js`**

Port the existing `ContextMenu` class with minimal changes. Key improvement: extract inline styles to CSS classes.

```javascript
/**
 * Base ContextMenu component.
 * show(items, x, y) → renders a list of actions at the given coordinates.
 */
export class ContextMenu {
  constructor() {
    this._el = null
    this._onDocClick = this._onDocClick.bind(this)
  }

  show(items, x, y) {
    this.hide()

    const menu = document.createElement('div')
    menu.className = 'context-menu'

    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div')
        sep.className = 'context-menu-separator'
        menu.appendChild(sep)
        continue
      }
      const el = document.createElement('div')
      el.className = 'context-menu-item'
      el.textContent = item.label
      if (item.disabled) {
        el.classList.add('disabled')
        el.addEventListener('click', (e) => e.stopPropagation())
      } else {
        el.addEventListener('click', () => {
          this.hide()
          item.action()
        })
      }
      menu.appendChild(el)
    }

    document.body.appendChild(menu)
    this._el = menu

    // Position — keep inside viewport
    const rect = menu.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (x + rect.width > vw) x = vw - rect.width - 4
    if (y + rect.height > vh) y = vh - rect.height - 4
    menu.style.left = `${x}px`
    menu.style.top = `${y}px`

    setTimeout(() => document.addEventListener('click', this._onDocClick), 0)
  }

  hide() {
    if (this._el) {
      this._el.remove()
      this._el = null
    }
    document.removeEventListener('click', this._onDocClick)
  }

  _onDocClick(e) {
    if (this._el && !this._el.contains(e.target)) {
      this.hide()
    }
  }
}
```

- [ ] **Step 3.2: Создать `src/renderer/components/base/context-menu/context-menu.css`**

Extract the existing styles from `styles.css` (lines 569-610 approximately). These are the exact styles currently in use.

```css
.context-menu {
  position: fixed;
  z-index: 1000;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 0;
  min-width: 140px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  font-size: 13px;
  user-select: none;
}

.context-menu-item {
  padding: 6px 12px;
  cursor: pointer;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 6px;
}

.context-menu-item:hover {
  background: var(--hover);
}

.context-menu-item.disabled {
  opacity: 0.4;
  cursor: default;
  pointer-events: none;
}

.context-menu-item.disabled:hover {
  background: transparent;
}

.context-menu-separator {
  height: 1px;
  background: var(--border);
  margin: 4px 8px;
}
```

- [ ] **Step 3.3: Обновить `src/renderer/styles.css`**

Remove the extracted `.context-menu` rules from `styles.css`. Keep all other styles intact. The exact block to remove spans lines ~569 to ~610 (verify by reading the file first). Use a surgical edit to remove only these 6 CSS rule blocks.

Add import of the new CSS file to `src/renderer/index.html` (if it uses `<link>` for CSS) OR import in `index.js` if using CSS bundler. Check `index.html`:

Read `src/renderer/index.html`. If it has:
```html
<link rel="stylesheet" href="./styles.css" />
```

Add below it:
```html
<link rel="stylesheet" href="./components/base/context-menu/context-menu.css" />
```

If styles are imported via JS (e.g. `import './styles.css'` in index.js), add:
```javascript
import './components/base/context-menu/context-menu.css'
```

Wait — actually the existing `context-menu.js` doesn't import CSS. The styles are in the global `styles.css`. For the base component to be self-contained, it should import its own CSS. But since we already have `styles.css` imported in `index.js`, and we're moving the rules out, we need to ensure the new CSS is loaded.

Best approach for Block 1: import the new CSS in `index.js` alongside the existing import. In Block 3 when we migrate components to use the base ContextMenu, we'll handle per-component CSS.

For now, add to `src/renderer/index.js`:
```javascript
import './components/base/context-menu/context-menu.css'
```

- [ ] **Step 3.4: Собрать и проверить**

Run:
```bash
npm run build
```

Expected: **Build succeeds with no errors.** Context menu styles still apply.

```bash
git add src/renderer/components/base/context-menu/ src/renderer/styles.css src/renderer/index.js
git commit -m "refactor: extract base ContextMenu component with dedicated CSS"
```

---

## Task 4: Базовый Button

**Files:**
- Create: `src/renderer/components/base/button/button.js`
- Create: `src/renderer/components/base/button/button.css`

---

- [ ] **Step 4.1: Создать `src/renderer/components/base/button/button.js`**

```javascript
/**
 * Base Button component.
 *
 * @example
 * const btn = new Button({
 *   variant: 'primary',
 *   size: 'md',
 *   label: 'Save',
 *   onClick: () => saveFile(),
 *   icon: '<svg>...</svg>'
 * })
 * document.body.appendChild(btn.element)
 */
export class Button {
  /**
   * @param {Object} options
   * @param {'default'|'primary'|'danger'|'ghost'} [options.variant='default']
   * @param {'sm'|'md'|'lg'} [options.size='md']
   * @param {string} [options.label='']
   * @param {string|null} [options.icon=null] — SVG string or null
   * @param {Function|null} [options.onClick=null]
   * @param {boolean} [options.disabled=false]
   * @param {string} [options.title='']
   */
  constructor(options = {}) {
    const {
      variant = 'default',
      size = 'md',
      label = '',
      icon = null,
      onClick = null,
      disabled = false,
      title = '',
    } = options

    this._onClick = onClick

    this.element = document.createElement('button')
    this.element.className = `btn btn--${variant} btn--${size}`
    this.element.type = 'button'
    if (title) this.element.title = title

    if (icon) {
      const iconWrap = document.createElement('span')
      iconWrap.className = 'btn__icon'
      iconWrap.innerHTML = icon
      this.element.appendChild(iconWrap)
    }

    if (label) {
      const text = document.createElement('span')
      text.className = 'btn__label'
      text.textContent = label
      this.element.appendChild(text)
    }

    this.setDisabled(disabled)

    if (onClick) {
      this.element.addEventListener('click', (e) => {
        if (!this.element.disabled) onClick(e)
      })
    }
  }

  setDisabled(value) {
    this.element.disabled = !!value
    this.element.classList.toggle('disabled', !!value)
  }

  setLoading(value) {
    this.element.classList.toggle('loading', !!value)
    this.setDisabled(!!value)
  }

  setLabel(text) {
    const labelEl = this.element.querySelector('.btn__label')
    if (labelEl) labelEl.textContent = text
  }

  destroy() {
    this.element.remove()
  }
}
```

- [ ] **Step 4.2: Создать `src/renderer/components/base/button/button.css`**

Create minimal but complete styles for all variants and sizes.

```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  line-height: 1;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
  white-space: nowrap;
  user-select: none;
}

.btn:hover:not(:disabled) {
  background: var(--hover);
  border-color: var(--muted);
}

.btn:active:not(:disabled) {
  transform: translateY(1px);
}

.btn:disabled,
.btn.disabled {
  opacity: 0.4;
  cursor: default;
  pointer-events: none;
}

.btn.loading {
  position: relative;
  color: transparent;
}

.btn.loading::after {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: btn-spin 0.8s linear infinite;
}

@keyframes btn-spin {
  to { transform: rotate(360deg); }
}

/* Sizes */
.btn--sm {
  padding: 4px 8px;
  font-size: 12px;
}

.btn--md {
  padding: 6px 12px;
  font-size: 13px;
}

.btn--lg {
  padding: 8px 16px;
  font-size: 14px;
}

/* Variants */
.btn--primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.btn--primary:hover:not(:disabled) {
  background: var(--accent);
  filter: brightness(1.15);
  border-color: var(--accent);
}

.btn--danger {
  background: var(--red);
  border-color: var(--red);
  color: #fff;
}

.btn--danger:hover:not(:disabled) {
  background: var(--red);
  filter: brightness(1.15);
  border-color: var(--red);
}

.btn--ghost {
  background: transparent;
  border-color: transparent;
}

.btn--ghost:hover:not(:disabled) {
  background: var(--hover);
  border-color: transparent;
}

/* Icon */
.btn__icon {
  display: inline-flex;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.btn__icon svg {
  width: 100%;
  height: 100%;
}
```

- [ ] **Step 4.3: Зарегистрировать CSS в `src/renderer/index.js`**

Add import:
```javascript
import './components/base/button/button.css'
```

- [ ] **Step 4.4: Собрать и зафиксировать**

Run:
```bash
npm run build
```

Expected: **Build succeeds.** Button styles are now available globally.

```bash
git add src/renderer/components/base/button/ src/renderer/index.js
git commit -m "feat: add base Button UI-kit component"
```

---

## Task 5: Extract Terminal Handlers from `index.js`

**Files:**
- Create: `src/renderer/features/terminal/terminal-keyboard-handler.js`
- Create: `src/renderer/features/terminal/terminal-osc-handler.js`
- Modify: `src/renderer/index.js`

---

- [ ] **Step 5.1: Создать `src/renderer/features/terminal/terminal-keyboard-handler.js`**

Extract the Kitty keyboard protocol + non-ASCII character handling from `setupTabHandlers`.

```javascript
/**
 * Handles custom keyboard events for a terminal:
 * - Kitty keyboard protocol (modifier+Enter)
 * - Non-ASCII printable characters (Cyrillic, accented, etc.)
 */
export class TerminalKeyboardHandler {
  /**
   * @param {Object} ptyApi — object with `write(pid, data)` method
   */
  constructor(ptyApi) {
    this._ptyApi = ptyApi
  }

  /**
   * Attach handler to a terminal instance.
   * @param {import('@xterm/xterm').Terminal} term
   * @param {number|string} pid
   */
  attach(term, pid) {
    term.attachCustomKeyEventHandler((event) => {
      return this._handleKeyEvent(event, pid)
    })
  }

  _handleKeyEvent(event, pid) {
    // Kitty keyboard protocol: intercept modifier+Enter before xterm.js
    if (event.key === 'Enter') {
      if (event.shiftKey && !event.ctrlKey) {
        if (event.type === 'keydown') this._ptyApi.write(pid, '\x1b[13;2u')
        return false
      }
      if (event.ctrlKey && !event.shiftKey) {
        if (event.type === 'keydown') this._ptyApi.write(pid, '\x1b[13;5u')
        return false
      }
      if (event.ctrlKey && event.shiftKey) {
        if (event.type === 'keydown') this._ptyApi.write(pid, '\x1b[13;6u')
        return false
      }
    }

    // Non-ASCII printable characters: xterm.js doesn't set _keyDownHandled
    // correctly in non-screenReader mode, so _keyPress re-processes the event
    // with wrong charCode on macOS. We send the character manually and block
    // xterm.js handling.
    if (
      event.key.length === 1 &&
      event.key.charCodeAt(0) > 127 &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      if (event.type === 'keydown') this._ptyApi.write(pid, event.key)
      return false
    }

    return true
  }
}
```

- [ ] **Step 5.2: Создать `src/renderer/features/terminal/terminal-osc-handler.js`**

Extract OSC 7 (cwd sync) and OSC 133 (busy tracking) from `setupTabHandlers`.

```javascript
/**
 * Handles OSC sequences from the terminal:
 * - OSC 7: directory change synchronization
 * - OSC 133: busy state tracking (shell integration)
 */
export class TerminalOscHandler {
  /**
   * @param {Object} callbacks
   * @param {Function} callbacks.onCwdChange — (newPath, pid) => void
   * @param {Function} callbacks.onBusyChange — (isBusy, pid, wasBusy) => void
   */
  constructor({ onCwdChange, onBusyChange }) {
    this._onCwdChange = onCwdChange
    this._onBusyChange = onBusyChange
  }

  /**
   * Attach handlers to a terminal instance.
   * @param {import('@xterm/xterm').Terminal} term
   * @param {number|string} pid
   */
  attach(term, pid) {
    term.parser.registerOscHandler(7, (data) => this._handleCwd(data, pid))
    term.parser.registerOscHandler(133, (data) => this._handleBusy(data, pid))
  }

  _handleCwd(data, pid) {
    const match = data.match(/^file:\/\/[^/]*(.+)$/)
    if (match) {
      const newPath = match[1].replace(/\/$/, '') || '/'
      this._onCwdChange?.(newPath, pid)
    }
    return false
  }

  _handleBusy(data, pid) {
    const isBusy = data.startsWith('C')
    const isDone = data.startsWith('A')

    if (isBusy) {
      this._onBusyChange?.(true, pid, false)
    } else if (isDone) {
      this._onBusyChange?.(false, pid, true)
    }

    return false
  }
}
```

- [ ] **Step 5.3: Обновить `src/renderer/index.js`**

Add imports:
```javascript
import { TerminalKeyboardHandler } from './features/terminal/terminal-keyboard-handler.js'
import { TerminalOscHandler } from './features/terminal/terminal-osc-handler.js'
```

Replace the inline `setupTabHandlers` function (lines 410-496) with calls to the new classes.

The old `setupTabHandlers` contained:
1. Keyboard handler (Kitty + non-ASCII)
2. onData → ptyWrite
3. onResize → ptyResize
4. onTitleChange → document.title
5. OSC 7 handler
6. OSC 133 handler
7. WebGL addon load

Replace with:
```javascript
function setupTabHandlers(tab) {
  // Keyboard handling
  const keyboardHandler = new TerminalKeyboardHandler({
    write: (pid, data) => window.electronAPI.ptyWrite(pid, data),
  })
  keyboardHandler.attach(tab.term, tab.pid)

  // Terminal → PTY data
  tab.term.onData((data) => {
    window.electronAPI.ptyWrite(tab.pid, data)
  })

  // Terminal → PTY resize
  tab.term.onResize(({ cols, rows }) => {
    window.electronAPI.ptyResize(tab.pid, cols, rows)
  })

  // Title change — only for active tab
  tab.term.onTitleChange((title) => {
    if (tabBar.getActive()?.pid === tab.pid) {
      document.title = title || 'eTty'
    }
  })

  // OSC handlers
  const oscHandler = new TerminalOscHandler({
    onCwdChange: (newPath, pid) => {
      const index = tabBar.tabs.findIndex(t => t.pid === pid)
      if (index >= 0) tabBar.updateRootPath(index, newPath)

      if (tabBar.getActive()?.pid === pid) {
        if (newPath !== fileTree.getCwd()) {
          fileTree.setRoot(newPath)
          window.electronAPI.fsSetRoot(newPath)
        }
        updateNavButtons()
      }
    },
    onBusyChange: (isBusy, pid, wasBusy) => {
      const targetTab = tabBar.tabs.find(t => t.pid === pid)
      if (!targetTab) return

      targetTab.isBusy = isBusy
      if (!isBusy) targetTab.activeAgentId = null

      if (wasBusy !== isBusy && tabBar.getActive()?.pid === pid) {
        updateNavButtons()
        syncStatusBarTerminalState()
      }
    },
  })
  oscHandler.attach(tab.term, tab.pid)

  // WebGL addon
  try {
    tab.term.loadAddon(new WebglAddon())
  } catch (e) {
    console.warn('WebGL addon failed, using canvas renderer:', e)
  }
}
```

Note: `WebglAddon` is already imported at the top of `index.js`.

- [ ] **Step 5.4: Собрать и проверить**

Run:
```bash
npm run build
```

Expected: **Build succeeds.**

Quick smoke test logic:
- Terminal creation still works (no import errors)
- Kitty protocol still handled (same behavior)
- OSC 7/133 still handled (same behavior)

```bash
git add src/renderer/features/terminal/ src/renderer/index.js
git commit -m "refactor: extract terminal keyboard and OSC handlers to dedicated classes"
```

---

## Task 6: Финальная проверка Block 1

- [ ] **Step 6.1: Полная сборка**

```bash
npm run build
```

Expected: **Build succeeds with zero errors and zero warnings.**

- [ ] **Step 6.2: Запуск dev-режима (smoke test)**

```bash
npm run dev &
```

Wait 5 seconds, then:
```bash
pkill -f "electron-vite dev" || true
```

Expected: App window opens, terminal renders, no console errors in DevTools.

- [ ] **Step 6.3: Коммит завершения Block 1**

```bash
git log --oneline -5
```

Expected output should show the Block 1 commits in order:
```
... refactor: extract terminal keyboard and OSC handlers...
... feat: add base Button UI-kit component
... refactor: extract base ContextMenu component with dedicated CSS
... refactor: extract magic numbers to config constants
... refactor: extract IPC channel names to shared constants
```

---

## Self-Review Checklist

- [ ] **Spec coverage:**
  - IPC channels extracted → Task 1 ✓
  - Config constants (terminal, app, UI) → Task 2 ✓
  - Base ContextMenu component → Task 3 ✓
  - Base Button component → Task 4 ✓
  - Terminal keyboard handler extracted → Task 5 ✓
  - Terminal OSC handler extracted → Task 5 ✓

- [ ] **Placeholder scan:** No TBD, TODO, "implement later", "similar to Task N" found.

- [ ] **Type consistency:**
  - `IPC_CHANNELS` used consistently across preload and main
  - `TERMINAL_CONFIG`, `APP_CONFIG`, `UI_DIMENSIONS` names match imports
  - `TerminalKeyboardHandler` and `TerminalOscHandler` constructor signatures stable

- [ ] **No breaking changes:** All existing files keep working; only constants are replaced with imports.

- [ ] **Build verification:** `npm run build` passes after each commit.
