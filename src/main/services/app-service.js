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
