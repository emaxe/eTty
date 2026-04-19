import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron'
import { join } from 'path'
import os from 'os'
import log from 'electron-log'
import { autoUpdater } from 'electron-updater'
import { PtyManager } from './pty-manager'
import { FileManager } from './file-manager'
import { saveTabState, loadTabState, deleteTabState, hasTabState, validatePath } from './tab-state'
import { loadSettings, saveSettings } from './settings-store'
import { HistoryManager } from './history-manager'
import { registerGitHandlers } from './git-service.js'

const ptyManager = new PtyManager()
const fileManager = new FileManager()
const historyManager = new HistoryManager()

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 400,
    minHeight: 300,
    frame: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(() => {
  autoUpdater.logger = log
  try {
    autoUpdater.checkForUpdatesAndNotify()
  } catch (e) {
    log.info('auto-updater: no update server configured', e.message)
  }


  ipcMain.handle('pty:create', async (event, options) => {
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

  ipcMain.on('pty:write', (_, { pid, data }) => {
    ptyManager.write(pid, data)
  })

  ipcMain.on('pty:resize', (_, { pid, cols, rows }) => {
    ptyManager.resize(pid, cols, rows)
  })

  ipcMain.handle('pty:kill', async (_, pid) => {
    const session = ptyManager.getSession(pid)
    if (session?.tabId) {
      // Remove from sessions FIRST to prevent double-merge on app exit
      ptyManager.sessions.delete(pid)
      await historyManager.mergeTabToGlobal(session.tabId, session.initialHistSize)
      session.pty.kill()
    } else {
      ptyManager.kill(pid)
    }
  })

  ipcMain.handle('app:homedir', () => os.homedir())

  ipcMain.handle('window:get-position', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win.getPosition()
  })

  ipcMain.on('window:move', (event, { x, y }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win.setPosition(Math.round(x), Math.round(y))
  })

  ipcMain.handle('fs:read-dir', async (_, { dirPath }) => {
    try {
      return await fileManager.readDir(dirPath)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('fs:create-file', async (_, { filePath }) => {
    try {
      return await fileManager.createFile(filePath)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('fs:create-dir', async (_, { dirPath }) => {
    try {
      return await fileManager.createDir(dirPath)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('fs:rename', async (_, { oldPath, newPath }) => {
    try {
      return await fileManager.rename(oldPath, newPath)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('fs:delete', async (_, { targetPath }) => {
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

  ipcMain.handle('fs:copy', async (_, { srcPath, destDir }) => {
    try {
      return await fileManager.copy(srcPath, destDir)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('fs:read-file', async (_, { filePath }) => {
    try {
      return await fileManager.readFile(filePath)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('fs:write-file', async (_, { filePath, content }) => {
    try {
      return await fileManager.writeFile(filePath, content)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('fs:get-cwd', () => {
    return fileManager.getCwd()
  })

  ipcMain.handle('fs:set-root', (_, { dirPath }) => {
    fileManager.setRoot(dirPath)
    return { success: true }
  })

  ipcMain.handle('fs:watch-dir', (event, { dirPath }) => {
    fileManager.watchDir(dirPath, event.sender)
  })

  ipcMain.handle('fs:unwatch-dir', (_, { dirPath }) => {
    fileManager.unwatchDir(dirPath)
  })

  ipcMain.handle('settings:load', () => loadSettings())
  ipcMain.handle('settings:save', (_, settings) => saveSettings(settings))

  registerGitHandlers(ipcMain)

  ipcMain.handle('history:cleanup', async (_, activeTabIds) => {
    await historyManager.cleanupOrphanedHistories(activeTabIds || [])
  })

  // --- Tab state: restore dialog ---
  ipcMain.handle('tabs:export-state', (event, tabs) => {
    return saveTabState(tabs)
  })

  ipcMain.handle('tabs:has-saved-state', () => hasTabState())

  ipcMain.handle('tabs:load-saved-state', async () => {
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
        tabId: tab.tabId
      })
    }
    return validated
  })

  ipcMain.handle('tabs:delete-saved-state', () => deleteTabState())

  ipcMain.handle('tabs:show-restore-dialog', async (event, tabCount) => {
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
    return response === 0 // true = restore
  })

  const mainWindow = createWindow()

  // Save tab state when window is closing (before webContents is destroyed)
  mainWindow.on('close', async (e) => {
    if (mainWindow._tabStateSaved) return
    e.preventDefault()
    try {
      // Merge all tab histories to global before exit
      await historyManager.mergeAllTabsToGlobal(ptyManager)

      const tabs = await mainWindow.webContents.executeJavaScript(
        'window.__exportTabState ? window.__exportTabState() : []'
      )
      if (tabs.length > 0) {
        await saveTabState(tabs)
      }
    } catch (err) {
      log.error('tab-state: failed to save on close', err.message)
    }
    mainWindow._tabStateSaved = true
    mainWindow.close()
  })

  // --- App menu with "Restore tabs" ---
  const buildMenu = async () => {
    const hasSaved = await hasTabState()
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
              mainWindow.webContents.send('tabs:trigger-restore')
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

  buildMenu()

  ipcMain.on('tabs:state-changed', () => buildMenu())
})

app.on('window-all-closed', () => {
  ptyManager.killAll()
  fileManager.unwatchAll()
  app.quit()
})
