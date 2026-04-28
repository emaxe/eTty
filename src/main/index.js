/**
 * Main process — slim bootstrap only.
 * Creates services, wires all IPC handlers via domain modules, instantiates AppService.
 * All application lifecycle logic lives in AppService (window, menu, updater, state save).
 */
import { app, ipcMain } from 'electron'
import log from 'electron-log'
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
import { IPC_CHANNELS } from '../shared/ipc-channels.js'

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

  ipcMain.on(IPC_CHANNELS.TABS_STATE_CHANGED, () => appService.rebuildMenu())

  appService.createWindow()

  // Periodic main-process diagnostics (every 10s)
  setInterval(() => {
    const mem = process.memoryUsage()
    log.info(
      `[MainDiagnostics] Watchers=${fileManager.getWatcherCount()} ` +
      `PTYs=${ptyManager.sessions.size} ` +
      `HeapMB=${(mem.heapUsed / 1024 / 1024).toFixed(1)} ` +
      `RSSMB=${(mem.rss / 1024 / 1024).toFixed(1)}`
    )
  }, 10000)
})

app.on('window-all-closed', () => appService.quit())
