/**
 * Main process — точка входа приложения.
 * Создаёт frameless BrowserWindow, регистрирует все IPC-обработчики,
 * управляет жизненным циклом: tab state save/restore, history merge при закрытии.
 */
import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron'
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
import { AgentService } from './agent-service.js'

const ptyManager = new PtyManager()
const fileManager = new FileManager()
const historyManager = new HistoryManager()
const agentService = new AgentService()

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

let _mainWindow = null

app.whenReady().then(() => {
  agentService.refresh().then(async (result) => {
    try {
      const { config, warnings } = await loadSettings()
      if (warnings.length > 0) {
        log.warn('settings: warnings during load:', warnings)
      }
      if (!config.agents.lastDetected) config.agents.lastDetected = {}

      let changed = false
      for (const agent of result.agents) {
        // Авто-включение: агент появился, ранее не был обнаружен, переключатель был выключен
        if (
          agent.detected &&
          config.agents.lastDetected[agent.id] === false &&
          config.agents.forceDisabled[agent.id] === true
        ) {
          config.agents.forceDisabled[agent.id] = false
          changed = true
        }
        // Обновить историю обнаружения
        if (config.agents.lastDetected[agent.id] !== agent.detected) {
          config.agents.lastDetected[agent.id] = agent.detected
          changed = true
        }
      }

      if (changed) {
        await saveSettings(config)
        if (_mainWindow && !_mainWindow.isDestroyed()) {
          _mainWindow.webContents.send('agents:settings-updated', {
            forceDisabled: config.agents.forceDisabled
          })
        }
      }
    } catch {}
  }).catch(() => {})

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

  ipcMain.handle('app:open-external', async (_, filePath) => {
    const { error } = await shell.openPath(filePath)
    if (error) log.error('app:open-external failed:', error)
    return { success: !error, error }
  })

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

  ipcMain.handle('fs:move', async (_, { srcPaths, destDir }) => {
    try {
      return await fileManager.move(srcPaths, destDir)
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
    console.log('[Main] fs:watch-dir called:', dirPath)
    const result = fileManager.watchDir(dirPath, event.sender)
    console.log('[Main] fs:watch-dir result:', dirPath, result)
    return result
  })

  ipcMain.handle('fs:unwatch-dir', (_, { dirPath }) => {
    fileManager.unwatchDir(dirPath)
  })

  ipcMain.handle('settings:load', () => loadSettings())
  ipcMain.handle('settings:save', (_, settings) => saveSettings(settings))
  ipcMain.handle('agents:get-status', async () => agentService.getStatus())
  ipcMain.handle('agents:refresh', async () => agentService.refresh())

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
        tabId: tab.tabId,
        editorState: tab.editorState || null
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

  _mainWindow = createWindow()
  const mainWindow = _mainWindow

  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('window:fullscreen-change', true)
  })
  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('window:fullscreen-change', false)
  })

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
