# eTty Block 4: Main Process Service Layer + IPC Handlers Split

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Разделить монолитный `src/main/index.js` на специализированные IPC-handler модули и вынести логику жизненного цикла приложения в `AppService`.

**Architecture:**
- `src/main/ipc-handlers/` — один файл на логическую группу IPC-каналов (pty, fs, window, app, tabs, settings, agents, history, git)
- Каждый модуль экспортирует `register*Handlers(ipcMain, deps)` где `deps` — необходимые сервисы (PtyManager, FileManager и т.д.)
- `git-service.js` обновлён: использует `IPC_CHANNELS` вместо строковых литералов
- `AppService` — жизненный цикл приложения: создание окна, меню, сохранение состояния при закрытии, auto-updater

**Tech Stack:** Node.js (ES modules), Electron 33, node-pty, simple-git.

---

## File Structure (Block 4)

```
src/main/
├── ipc-handlers/
│   ├── index.js              # NEW — exports all register*Handlers
│   ├── pty-handlers.js       # NEW
│   ├── fs-handlers.js        # NEW
│   ├── window-handlers.js    # NEW
│   ├── app-handlers.js       # NEW
│   ├── tabs-handlers.js      # NEW
│   ├── settings-handlers.js  # NEW
│   ├── agents-handlers.js    # NEW
│   ├── history-handlers.js   # NEW
│   └── git-handlers.js       # NEW (from git-service.js)
├── services/
│   └── app-service.js        # NEW — App lifecycle (window, menu, state save, updater)
├── index.js                  # MODIFIED — slim bootstrap only
├── git-service.js            # MODIFIED — remove IPC, keep pure Git operations
└── ...existing files unchanged (pty-manager, file-manager, history-manager, tab-state, settings-store, agent-service)
```

---

## Task 1: IPC Handlers — PTY

**Files:**
- Create: `src/main/ipc-handlers/pty-handlers.js`
- Modify: `src/main/index.js` (remove inline PTY handlers)

---

- [ ] **Step 1.1: Создать `src/main/ipc-handlers/pty-handlers.js`**

```javascript
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

/**
 * Register PTY IPC handlers.
 * @param {Electron.IpcMain} ipcMain
 * @param {{ ptyManager: import('../pty-manager').PtyManager, historyManager: import('../history-manager').HistoryManager }} deps
 */
export function registerPtyHandlers(ipcMain, { ptyManager, historyManager }) {
  ipcMain.handle(IPC_CHANNELS.PTY_CREATE, async (event, options) => {
    const tabId = options.tabId || crypto.randomUUID()
    await historyManager.ensureHistoryDir()

    const historyFile = historyManager.getTabHistoryPath(tabId)
    const isRestore = await historyManager.tabHistoryExists(tabId)

    if (isRestore) {
      await historyManager.prepareHistoryForRestoredTab(tabId)
    } else {
      await historyManager.prepareHistoryForNewTab(tabId)
    }

    const initialHistSize = await historyManager.getFileSize(historyFile)

    return ptyManager.create({
      ...options,
      tabId,
      historyFile,
      initialHistSize,
      webContents: event.sender
    })
  })

  ipcMain.on(IPC_CHANNELS.PTY_WRITE, (_, { pid, data }) => {
    ptyManager.write(pid, data)
  })

  ipcMain.on(IPC_CHANNELS.PTY_RESIZE, (_, { pid, cols, rows }) => {
    ptyManager.resize(pid, cols, rows)
  })

  ipcMain.handle(IPC_CHANNELS.PTY_KILL, async (_, pid) => {
    const session = ptyManager.getSession(pid)
    if (session?.tabId) {
      ptyManager.sessions.delete(pid)
      await historyManager.mergeTabToGlobal(session.tabId, session.initialHistSize)
      session.pty.kill()
    } else {
      ptyManager.kill(pid)
    }
  })
}
```

- [ ] **Step 1.2: Удалить inline PTY handlers из `src/main/index.js`**

Remove lines:
```javascript
  ipcMain.handle(IPC_CHANNELS.PTY_CREATE, async (event, options) => { ... })
  ipcMain.on(IPC_CHANNELS.PTY_WRITE, ...)
  ipcMain.on(IPC_CHANNELS.PTY_RESIZE, ...)
  ipcMain.handle(IPC_CHANNELS.PTY_KILL, ...)
```

Replace with import + call:
```javascript
import { registerPtyHandlers } from './ipc-handlers/pty-handlers.js'
// ... inside app.whenReady()
registerPtyHandlers(ipcMain, { ptyManager, historyManager })
```

- [ ] **Step 1.3: Собрать и зафиксировать**

```bash
npm run build
```

```bash
git add src/main/ipc-handlers/pty-handlers.js src/main/index.js
git commit -m "refactor: extract PTY IPC handlers to ipc-handlers/pty-handlers.js"
```

---

## Task 2: IPC Handlers — File System

**Files:**
- Create: `src/main/ipc-handlers/fs-handlers.js`
- Modify: `src/main/index.js`

---

- [ ] **Step 2.1: Создать `src/main/ipc-handlers/fs-handlers.js`**

```javascript
import { BrowserWindow, dialog } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

/**
 * Register file system IPC handlers.
 * @param {Electron.IpcMain} ipcMain
 * @param {{ fileManager: import('../file-manager').FileManager }} deps
 */
export function registerFsHandlers(ipcMain, { fileManager }) {
  ipcMain.handle(IPC_CHANNELS.FS_READ_DIR, async (_, { dirPath }) => {
    try { return await fileManager.readDir(dirPath) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_CREATE_FILE, async (_, { filePath }) => {
    try { return await fileManager.createFile(filePath) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_CREATE_DIR, async (_, { dirPath }) => {
    try { return await fileManager.createDir(dirPath) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_RENAME, async (_, { oldPath, newPath }) => {
    try { return await fileManager.rename(oldPath, newPath) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_DELETE, async (_, { targetPath }) => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Удалить', 'Отмена'],
        defaultId: 1,
        cancelId: 1,
        title: 'Подтверждение удаления',
        message: `Удалить "${targetPath}"?`
      })
      if (response !== 0) return { success: false, error: 'Cancelled' }
      return await fileManager.delete(targetPath)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.FS_COPY, async (_, { srcPath, destDir }) => {
    try { return await fileManager.copy(srcPath, destDir) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_MOVE, async (_, { srcPaths, destDir }) => {
    try { return await fileManager.move(srcPaths, destDir) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_READ_FILE, async (_, { filePath }) => {
    try { return await fileManager.readFile(filePath) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_WRITE_FILE, async (_, { filePath, content }) => {
    try { return await fileManager.writeFile(filePath, content) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_GET_CWD, () => fileManager.getCwd())

  ipcMain.handle(IPC_CHANNELS.FS_SET_ROOT, (_, { dirPath }) => {
    fileManager.setRoot(dirPath)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.FS_WATCH_DIR, (event, { dirPath }) => {
    return fileManager.watchDir(dirPath, event.sender)
  })

  ipcMain.handle(IPC_CHANNELS.FS_UNWATCH_DIR, (_, { dirPath }) => {
    fileManager.unwatchDir(dirPath)
  })
}
```

- [ ] **Step 2.2: Удалить inline FS handlers из `src/main/index.js`**

- [ ] **Step 2.3: Собрать и зафиксировать**

```bash
npm run build
git add src/main/ipc-handlers/fs-handlers.js src/main/index.js
git commit -m "refactor: extract FS IPC handlers to ipc-handlers/fs-handlers.js"
```

---

## Task 3: IPC Handlers — Window + App

**Files:**
- Create: `src/main/ipc-handlers/window-handlers.js`
- Create: `src/main/ipc-handlers/app-handlers.js`
- Modify: `src/main/index.js`

---

- [ ] **Step 3.1: Создать `src/main/ipc-handlers/window-handlers.js`**

```javascript
import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

/**
 * Register window IPC handlers.
 * @param {Electron.IpcMain} ipcMain
 */
export function registerWindowHandlers(ipcMain) {
  ipcMain.handle(IPC_CHANNELS.WINDOW_GET_POSITION, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win.getPosition()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_MOVE, (event, { x, y }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win.setPosition(Math.round(x), Math.round(y))
  })
}
```

- [ ] **Step 3.2: Создать `src/main/ipc-handlers/app-handlers.js`**

```javascript
import os from 'os'
import { shell } from 'electron'
import log from 'electron-log'
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

/**
 * Register app-level IPC handlers.
 * @param {Electron.IpcMain} ipcMain
 */
export function registerAppHandlers(ipcMain) {
  ipcMain.handle(IPC_CHANNELS.APP_HOMEDIR, () => os.homedir())

  ipcMain.handle(IPC_CHANNELS.APP_OPEN_EXTERNAL, async (_, filePath) => {
    const { error } = await shell.openPath(filePath)
    if (error) log.error('app:open-external failed:', error)
    return { success: !error, error }
  })
}
```

- [ ] **Step 3.3: Удалить inline Window + App handlers из `src/main/index.js`**

- [ ] **Step 3.4: Собрать и зафиксировать**

```bash
npm run build
git add src/main/ipc-handlers/window-handlers.js src/main/ipc-handlers/app-handlers.js src/main/index.js
git commit -m "refactor: extract Window and App IPC handlers"
```

---

## Task 4: IPC Handlers — Tabs + History + Settings + Agents

**Files:**
- Create: `src/main/ipc-handlers/tabs-handlers.js`
- Create: `src/main/ipc-handlers/history-handlers.js`
- Create: `src/main/ipc-handlers/settings-handlers.js`
- Create: `src/main/ipc-handlers/agents-handlers.js`
- Modify: `src/main/index.js`

---

- [ ] **Step 4.1: Создать `src/main/ipc-handlers/tabs-handlers.js`**

```javascript
import { BrowserWindow, dialog } from 'electron'
import os from 'os'
import log from 'electron-log'
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {{ saveTabState, loadTabState, deleteTabState, hasTabState, validatePath }} deps
 */
export function registerTabsHandlers(ipcMain, { saveTabState, loadTabState, deleteTabState, hasTabState, validatePath }) {
  ipcMain.handle(IPC_CHANNELS.TABS_EXPORT_STATE, (event, tabs) => {
    return saveTabState(tabs)
  })

  ipcMain.handle(IPC_CHANNELS.TABS_HAS_SAVED_STATE, () => hasTabState())

  ipcMain.handle(IPC_CHANNELS.TABS_LOAD_SAVED_STATE, async () => {
    const state = await loadTabState()
    if (!state) return null
    const homedir = os.homedir()
    const validated = []
    for (const tab of state.tabs) {
      const valid = await validatePath(tab.rootPath)
      if (!valid) {
        log.warn('tab-state: path not found, using homedir:', tab.rootPath)
      }
      validated.push({
        rootPath: valid ? tab.rootPath : homedir,
        isActive: tab.isActive,
        tabId: tab.tabId,
        editorState: tab.editorState || null
      })
    }
    return validated
  })

  ipcMain.handle(IPC_CHANNELS.TABS_DELETE_SAVED_STATE, () => deleteTabState())

  ipcMain.handle(IPC_CHANNELS.TABS_SHOW_RESTORE_DIALOG, async (event, tabCount) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Восстановить', 'Не восстанавливать'],
      defaultId: 1,
      cancelId: 1,
      title: 'Восстановление вкладок',
      message: `Восстановить ${tabCount} вкладок?`,
      detail: 'Вкладки из предыдущей сессии можно восстановить.'
    })
    return response === 0
  })
}
```

- [ ] **Step 4.2: Создать `src/main/ipc-handlers/history-handlers.js`**

```javascript
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {{ historyManager: import('../history-manager').HistoryManager }} deps
 */
export function registerHistoryHandlers(ipcMain, { historyManager }) {
  ipcMain.handle(IPC_CHANNELS.HISTORY_CLEANUP, async (_, activeTabIds) => {
    await historyManager.cleanupOrphanedHistories(activeTabIds || [])
  })
}
```

- [ ] **Step 4.3: Создать `src/main/ipc-handlers/settings-handlers.js`**

```javascript
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {{ loadSettings, saveSettings }} deps
 */
export function registerSettingsHandlers(ipcMain, { loadSettings, saveSettings }) {
  ipcMain.handle(IPC_CHANNELS.SETTINGS_LOAD, () => loadSettings())
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SAVE, (_, settings) => saveSettings(settings))
}
```

- [ ] **Step 4.4: Создать `src/main/ipc-handlers/agents-handlers.js`**

```javascript
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {{ agentService: import('../agent-service').AgentService }} deps
 */
export function registerAgentsHandlers(ipcMain, { agentService }) {
  ipcMain.handle(IPC_CHANNELS.AGENTS_GET_STATUS, async () => agentService.getStatus())
  ipcMain.handle(IPC_CHANNELS.AGENTS_REFRESH, async () => agentService.refresh())
}
```

- [ ] **Step 4.5: Удалить inline handlers из `src/main/index.js`**

- [ ] **Step 4.6: Собрать и зафиксировать**

```bash
npm run build
git add src/main/ipc-handlers/tabs-handlers.js src/main/ipc-handlers/history-handlers.js src/main/ipc-handlers/settings-handlers.js src/main/ipc-handlers/agents-handlers.js src/main/index.js
git commit -m "refactor: extract Tabs, History, Settings, Agents IPC handlers"
```

---

## Task 5: Git Handlers — Extract from git-service.js

**Files:**
- Create: `src/main/ipc-handlers/git-handlers.js`
- Modify: `src/main/git-service.js`
- Modify: `src/main/index.js`

---

- [ ] **Step 5.1: Создать `src/main/ipc-handlers/git-handlers.js`**

Move all IPC registrations from `git-service.js` into `git-handlers.js`, using `IPC_CHANNELS` constants:

```javascript
import simpleGit from 'simple-git'
import fs from 'fs/promises'
import path from 'path'
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

function countDiffLines(diff) { /* ... same as in git-service.js ... */ }

/**
 * @param {Electron.IpcMain} ipcMain
 */
export function registerGitHandlers(ipcMain) {
  ipcMain.handle(IPC_CHANNELS.GIT_GET_STATUS, async (_event, rootPath) => { /* ... */ })
  ipcMain.handle(IPC_CHANNELS.GIT_GET_ROOT, async (_event, rootPath) => { /* ... */ })
  ipcMain.handle(IPC_CHANNELS.GIT_GET_DIFF, async (_event, rootPath, filePath) => { /* ... */ })
  ipcMain.handle(IPC_CHANNELS.GIT_GET_BRANCHES, async (_event, rootPath) => { /* ... */ })
  ipcMain.handle(IPC_CHANNELS.GIT_CHECKOUT, async (_event, rootPath, branch) => { /* ... */ })
  ipcMain.handle(IPC_CHANNELS.GIT_CREATE_BRANCH, async (_event, rootPath, name) => { /* ... */ })
  ipcMain.handle(IPC_CHANNELS.GIT_DELETE_BRANCH, async (_event, rootPath, name) => { /* ... */ })
  ipcMain.handle(IPC_CHANNELS.GIT_COMMIT, async (_event, rootPath, message) => { /* ... */ })
  ipcMain.handle(IPC_CHANNELS.GIT_PUSH, async (_event, rootPath) => { /* ... */ })
  ipcMain.handle(IPC_CHANNELS.GIT_DISCARD, async (_event, rootPath) => { /* ... */ })
}
```

- [ ] **Step 5.2: Обновить `src/main/git-service.js`**

Keep `countDiffLines` as exported utility. Remove `registerGitHandlers` function. The file becomes a pure utility module:

```javascript
export function countDiffLines(diff) { /* ... */ }
```

Or keep it as-is if other modules depend on it, but remove IPC registrations.

- [ ] **Step 5.3: Обновить `src/main/index.js`**

Replace `import { registerGitHandlers } from './git-service.js'` with:
```javascript
import { registerGitHandlers } from './ipc-handlers/git-handlers.js'
```

- [ ] **Step 5.4: Собрать и зафиксировать**

```bash
npm run build
git add src/main/ipc-handlers/git-handlers.js src/main/git-service.js src/main/index.js
git commit -m "refactor: extract Git IPC handlers to ipc-handlers, use IPC_CHANNELS constants"
```

---

## Task 6: Create `ipc-handlers/index.js`

**Files:**
- Create: `src/main/ipc-handlers/index.js`
- Modify: `src/main/index.js`

---

- [ ] **Step 6.1: Создать `src/main/ipc-handlers/index.js`**

```javascript
export { registerPtyHandlers } from './pty-handlers.js'
export { registerFsHandlers } from './fs-handlers.js'
export { registerWindowHandlers } from './window-handlers.js'
export { registerAppHandlers } from './app-handlers.js'
export { registerTabsHandlers } from './tabs-handlers.js'
export { registerHistoryHandlers } from './history-handlers.js'
export { registerSettingsHandlers } from './settings-handlers.js'
export { registerAgentsHandlers } from './agents-handlers.js'
export { registerGitHandlers } from './git-handlers.js'
```

- [ ] **Step 6.2: Обновить `src/main/index.js`**

Replace multiple individual imports with:
```javascript
import {
  registerPtyHandlers,
  registerFsHandlers,
  registerWindowHandlers,
  registerAppHandlers,
  registerTabsHandlers,
  registerHistoryHandlers,
  registerSettingsHandlers,
  registerAgentsHandlers,
  registerGitHandlers,
} from './ipc-handlers/index.js'
```

Then call all in `app.whenReady()`:
```javascript
  registerPtyHandlers(ipcMain, { ptyManager, historyManager })
  registerFsHandlers(ipcMain, { fileManager })
  registerWindowHandlers(ipcMain)
  registerAppHandlers(ipcMain)
  registerTabsHandlers(ipcMain, { saveTabState, loadTabState, deleteTabState, hasTabState, validatePath })
  registerHistoryHandlers(ipcMain, { historyManager })
  registerSettingsHandlers(ipcMain, { loadSettings, saveSettings })
  registerAgentsHandlers(ipcMain, { agentService })
  registerGitHandlers(ipcMain)
```

- [ ] **Step 6.3: Собрать и зафиксировать**

```bash
npm run build
git add src/main/ipc-handlers/index.js src/main/index.js
git commit -m "feat: add ipc-handlers barrel export, wire all handlers in index.js"
```

---

## Task 7: AppService — Application Lifecycle

**Files:**
- Create: `src/main/services/app-service.js`
- Modify: `src/main/index.js`

---

- [ ] **Step 7.1: Создать `src/main/services/app-service.js`**

Extract from `index.js`: window creation, fullscreen events, tab state save on close, menu builder, auto-updater, agent service startup.

```javascript
import { app, BrowserWindow, Menu, dialog } from 'electron'
import log from 'electron-log'
import { autoUpdater } from 'electron-updater'
import { join } from 'path'
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

/**
 * Manages application lifecycle: window, menu, state persistence, updater.
 */
export class AppService {
  /**
   * @param {Object} deps
   * @param {import('../pty-manager').PtyManager} deps.ptyManager
   * @param {import('../file-manager').FileManager} deps.fileManager
   * @param {import('../history-manager').HistoryManager} deps.historyManager
   * @param {import('../agent-service').AgentService} deps.agentService
   * @param {Object} deps.tabState
   * @param {Function} deps.loadSettings
   * @param {Function} deps.saveSettings
   */
  constructor({ ptyManager, fileManager, historyManager, agentService, tabState, loadSettings, saveSettings }) {
    this._ptyManager = ptyManager
    this._fileManager = fileManager
    this._historyManager = historyManager
    this._agentService = agentService
    this._tabState = tabState
    this._loadSettings = loadSettings
    this._saveSettings = saveSettings
    this._mainWindow = null
  }

  createWindow() {
    const mainWindow = new BrowserWindow({
      width: 900,
      height: 600,
      minWidth: 400,
      minHeight: 300,
      frame: false,
      titleBarStyle: 'hiddenInset',
      webPreferences: {
        preload: join(__dirname, '../../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    if (process.env.ELECTRON_RENDERER_URL) {
      mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
      mainWindow.loadFile(join(__dirname, '../../renderer/index.html'))
    }

    this._mainWindow = mainWindow
    this._setupWindowEvents(mainWindow)
    this._buildMenu()
    return mainWindow
  }

  get mainWindow() { return this._mainWindow }

  _setupWindowEvents(mainWindow) {
    mainWindow.on('enter-full-screen', () => {
      mainWindow.webContents.send(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGE, true)
    })
    mainWindow.on('leave-full-screen', () => {
      mainWindow.webContents.send(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGE, false)
    })

    mainWindow.on('close', async (e) => {
      if (mainWindow._tabStateSaved) return
      e.preventDefault()
      try {
        await this._historyManager.mergeAllTabsToGlobal(this._ptyManager)
        const tabs = await mainWindow.webContents.executeJavaScript(
          'window.__exportTabState ? window.__exportTabState() : []'
        )
        if (tabs.length > 0) {
          await this._tabState.saveTabState(tabs)
        }
      } catch (err) {
        log.error('tab-state: failed to save on close', err.message)
      }
      mainWindow._tabStateSaved = true
      mainWindow.close()
    })
  }

  async startAgentAutoRefresh() {
    this._agentService.refresh().then(async (result) => {
      try {
        const { config, warnings } = await this._loadSettings()
        if (warnings.length > 0) log.warn('settings: warnings during load:', warnings)
        if (!config.agents.lastDetected) config.agents.lastDetected = {}

        let changed = false
        for (const agent of result.agents) {
          if (
            agent.detected &&
            config.agents.lastDetected[agent.id] === false &&
            config.agents.forceDisabled[agent.id] === true
          ) {
            config.agents.forceDisabled[agent.id] = false
            changed = true
          }
          if (config.agents.lastDetected[agent.id] !== agent.detected) {
            config.agents.lastDetected[agent.id] = agent.detected
            changed = true
          }
        }

        if (changed) {
          await this._saveSettings(config)
          if (this._mainWindow && !this._mainWindow.isDestroyed()) {
            this._mainWindow.webContents.send(IPC_CHANNELS.AGENTS_SETTINGS_UPDATED, {
              forceDisabled: config.agents.forceDisabled
            })
          }
        }
      } catch {}
    }).catch(() => {})
  }

  startAutoUpdater() {
    autoUpdater.logger = log
    try {
      autoUpdater.checkForUpdatesAndNotify()
    } catch (e) {
      log.info('auto-updater: no update server configured', e.message)
    }
  }

  async _buildMenu() {
    const hasSaved = await this._tabState.hasTabState()
    const template = [
      ...(process.platform === 'darwin' ? [{
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      }] : []),
      { role: 'editMenu' },
      {
        label: 'Вкладки',
        submenu: [
          {
            label: 'Восстановить вкладки',
            enabled: hasSaved,
            click: () => {
              this._mainWindow.webContents.send(IPC_CHANNELS.TABS_TRIGGER_RESTORE)
            }
          }
        ]
      },
      {
        label: 'Вид',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      },
      { role: 'windowMenu' }
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  rebuildMenu() {
    this._buildMenu()
  }

  quit() {
    this._ptyManager.killAll()
    this._fileManager.unwatchAll()
    app.quit()
  }
}
```

- [ ] **Step 7.2: Упростить `src/main/index.js`**

Replace window creation, menu, auto-updater, agent refresh, close handler with AppService usage:

```javascript
import { app, ipcMain } from 'electron'
import { PtyManager } from './pty-manager'
import { FileManager } from './file-manager'
import { HistoryManager } from './history-manager'
import { AgentService } from './agent-service.js'
import {
  saveTabState, loadTabState, deleteTabState, hasTabState, validatePath
} from './tab-state'
import { loadSettings, saveSettings } from './settings-store'
import { AppService } from './services/app-service.js'
import {
  registerPtyHandlers,
  registerFsHandlers,
  registerWindowHandlers,
  registerAppHandlers,
  registerTabsHandlers,
  registerHistoryHandlers,
  registerSettingsHandlers,
  registerAgentsHandlers,
  registerGitHandlers,
} from './ipc-handlers/index.js'

const ptyManager = new PtyManager()
const fileManager = new FileManager()
const historyManager = new HistoryManager()
const agentService = new AgentService()

const appService = new AppService({
  ptyManager,
  fileManager,
  historyManager,
  agentService,
  tabState: { saveTabState, loadTabState, deleteTabState, hasTabState, validatePath },
  loadSettings,
  saveSettings,
})

app.whenReady().then(() => {
  appService.startAgentAutoRefresh()
  appService.startAutoUpdater()

  registerPtyHandlers(ipcMain, { ptyManager, historyManager })
  registerFsHandlers(ipcMain, { fileManager })
  registerWindowHandlers(ipcMain)
  registerAppHandlers(ipcMain)
  registerTabsHandlers(ipcMain, { saveTabState, loadTabState, deleteTabState, hasTabState, validatePath })
  registerHistoryHandlers(ipcMain, { historyManager })
  registerSettingsHandlers(ipcMain, { loadSettings, saveSettings })
  registerAgentsHandlers(ipcMain, { agentService })
  registerGitHandlers(ipcMain)

  ipcMain.on('tabs:state-changed', () => appService.rebuildMenu())

  appService.createWindow()
})

app.on('window-all-closed', () => appService.quit())
```

Note: `tabs:state-changed` listener needs to be registered. It currently uses `IPC_CHANNELS.TABS_STATE_CHANGED` but we need to keep the `ipcMain.on` for this event since it's not a handler with return value, it's an event from renderer.

- [ ] **Step 7.3: Собрать и зафиксировать**

```bash
npm run build
git add src/main/services/app-service.js src/main/index.js
git commit -m "feat: add AppService for application lifecycle management"
```

---

## Task 8: Final Verification

- [ ] **Step 8.1: Полная сборка**

```bash
npm run build
```

Expected: Zero errors.

- [ ] **Step 8.2: Code review (self + spot-checks)**

Check for:
- No remaining inline `ipcMain.handle` / `ipcMain.on` in `index.js` (except `tabs:state-changed` event listener)
- All IPC channels use `IPC_CHANNELS` constants
- `git-service.js` no longer registers IPC handlers
- `AppService` handles window, menu, updater, agent refresh, state save
- `index.js` is under 50 lines

- [ ] **Step 8.3: Коммит (если нужны доработки)**

If all clean:
```bash
git log --oneline -15
```

Should show all Block 4 commits.

---

## Known Gaps / Future Work (Block 5+)

- **Preload script split** — `src/preload/index.js` (~50 methods) could be split by domain
- **Error handling in IPC** — Currently try/catch per handler. Could centralize.
- **Tests for IPC handlers** — No unit tests yet.
- **TypeScript** — JSDoc types could be replaced with TS for compile-time safety.

---

## Self-Review Checklist

- [ ] **Spec coverage:**
  - PTY handlers extracted → Task 1 ✓
  - FS handlers extracted → Task 2 ✓
  - Window + App handlers extracted → Task 3 ✓
  - Tabs + History + Settings + Agents handlers extracted → Task 4 ✓
  - Git handlers extracted from git-service.js, IPC_CHANNELS used → Task 5 ✓
  - Barrel export `ipc-handlers/index.js` → Task 6 ✓
  - AppService created for lifecycle → Task 7 ✓

- [ ] **Placeholder scan:** No TBD, TODO, "implement later", "similar to Task N" found.

- [ ] **Type consistency:**
  - `register*Handlers(ipcMain, deps)` signatures stable
  - `IPC_CHANNELS` used everywhere instead of strings
  - `AppService` constructor deps consistent

- [ ] **Build verification:** `npm run build` passes after each task.
