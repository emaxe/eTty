/**
 * Main process — точка входа приложения.
 * Создаёт frameless BrowserWindow, регистрирует все IPC-обработчики,
 * управляет жизненным циклом: tab state save/restore, history merge при закрытии,
 * авто-детект ИИ-агентов, меню приложения.
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
import { IPC_CHANNELS } from '../shared/ipc-channels.js'
import { registerPtyHandlers } from './ipc-handlers/pty-handlers.js'
import { registerFsHandlers } from './ipc-handlers/fs-handlers.js'

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
          _mainWindow.webContents.send(IPC_CHANNELS.AGENTS_SETTINGS_UPDATED, {
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


  registerPtyHandlers(ipcMain, { ptyManager, historyManager })
  registerFsHandlers(ipcMain, { fileManager })

  ipcMain.handle(IPC_CHANNELS.APP_HOMEDIR, () => os.homedir())

  ipcMain.handle(IPC_CHANNELS.APP_OPEN_EXTERNAL, async (_, filePath) => {
    const { error } = await shell.openPath(filePath)
    if (error) log.error('app:open-external failed:', error)
    return { success: !error, error }
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_GET_POSITION, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win.getPosition()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_MOVE, (event, { x, y }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win.setPosition(Math.round(x), Math.round(y))
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_LOAD, () => loadSettings())
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SAVE, (_, settings) => saveSettings(settings))
  ipcMain.handle(IPC_CHANNELS.AGENTS_GET_STATUS, async () => agentService.getStatus())
  ipcMain.handle(IPC_CHANNELS.AGENTS_REFRESH, async () => agentService.refresh())

  registerGitHandlers(ipcMain)

  ipcMain.handle(IPC_CHANNELS.HISTORY_CLEANUP, async (_, activeTabIds) => {
    await historyManager.cleanupOrphanedHistories(activeTabIds || [])
  })

  // --- Tab state: restore dialog ---
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
    return response === 0 // true = restore
  })

  _mainWindow = createWindow()
  const mainWindow = _mainWindow

  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGE, true)
  })
  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGE, false)
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
              mainWindow.webContents.send(IPC_CHANNELS.TABS_TRIGGER_RESTORE)
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

  ipcMain.on(IPC_CHANNELS.TABS_STATE_CHANGED, () => buildMenu())
})

app.on('window-all-closed', () => {
  ptyManager.killAll()
  fileManager.unwatchAll()
  app.quit()
})
