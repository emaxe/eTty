/**
 * Main process — slim bootstrap only.
 * Creates services, wires all IPC handlers via domain modules, instantiates AppService.
 * All application lifecycle logic lives in AppService (window, menu, updater, state save).
 */
import { app, ipcMain } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import log from 'electron-log'
import { PtyManager } from './pty-manager'
import { FileManager } from './file-manager'
import { HistoryManager } from './history-manager'
import { AgentService } from './agent-service.js'
import { ShellPathResolver } from './shell-path-resolver.js'
import { NodeVersionManager } from './services/node-version-manager.js'
import { SshSessionRegistry } from './ssh/ssh-session-registry.js'
import { SshConnectionMasterRegistry } from './ssh/ssh-connection-master-registry.js'
import { FsProviderRegistry } from './fs/fs-provider-registry.js'
import { GitRunnerRegistry } from './git/git-runner-registry.js'
import {
  saveTabState, loadTabState, deleteTabState, hasTabState, validatePath
} from './tab-state'
import { loadSettings, saveSettings } from './settings-store'
import * as sshStore from './ssh-store.js'
import { AppService } from './services/app-service.js'
import { TrackpadGestureService } from './services/trackpad-gesture-service.js'
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
  registerSearchHandlers,
  registerNodeVersionHandlers,
  registerSshHandlers,
  registerClipboardHandlers,
  registerTrackpadHandlers,
} from './ipc-handlers/index.js'
import { IPC_CHANNELS } from '../shared/ipc-channels.js'

const shellPathResolver = new ShellPathResolver()
const sshSessionRegistry = new SshSessionRegistry()
const sshConnectionMasters = new SshConnectionMasterRegistry({ sshSessionRegistry, shellPathResolver })

const ptyManager = new PtyManager({ shellPathResolver, sshSessionRegistry })
const fileManager = new FileManager()
const fsProviderRegistry = new FsProviderRegistry({ fileManager, sshSessionRegistry })
const gitRunnerRegistry = new GitRunnerRegistry({ sshSessionRegistry })
const historyManager = new HistoryManager()
const agentService = new AgentService({ shellPathResolver })
const nodeVersionManager = new NodeVersionManager({ shellPathResolver, sshSessionRegistry })

const appService = new AppService({
  ptyManager,
  fileManager,
  historyManager,
  agentService,
  tabState: { saveTabState, loadTabState, deleteTabState, hasTabState, validatePath },
  loadSettings,
  saveSettings,
  sshConnectionMasters,
})

let trackpadService = null
let diagnosticsInterval = null
let isQuitting = false

/**
 * Удаляет осиротевшие каталоги ControlMaster-сокетов (`etty-cm-*`) и askpass-скриптов
 * (`etty-ssh-*`) в `os.tmpdir()` старше суток — например после аварийного завершения (kill -9),
 * когда `PtyManager.killAll()`/`SshConnectionMasterRegistry.disposeAll()` не успели отработать.
 * `SshControlChannel.dispose()`/`SshConnectionMaster.dispose()` штатно чистят их сами при
 * обычном закрытии вкладки/панели/приложения.
 */
function cleanupOrphanedControlSockets() {
  const tmpDir = os.tmpdir()
  const maxAgeMs = 24 * 60 * 60 * 1000
  let entries
  try {
    entries = fs.readdirSync(tmpDir, { withFileTypes: true })
  } catch (e) {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !(entry.name.startsWith('etty-cm-') || entry.name.startsWith('etty-ssh-'))) continue
    const dirPath = path.join(tmpDir, entry.name)
    try {
      const stat = fs.statSync(dirPath)
      if (Date.now() - stat.mtimeMs > maxAgeMs) {
        fs.rmSync(dirPath, { recursive: true, force: true })
      }
    } catch (e) {
      // сокет уже мог исчезнуть между readdir и stat — не критично
    }
  }
}

app.whenReady().then(async () => {
  await shellPathResolver.resolve()
  cleanupOrphanedControlSockets()

  appService.startAgentAutoRefresh()
  appService.startAutoUpdater()

  registerPtyHandlers(ipcMain, { ptyManager, historyManager, sshStore, shellPathResolver, sshSessionRegistry })
  registerFsHandlers(ipcMain, { fsProviderRegistry })
  registerWindowHandlers(ipcMain)
  registerAppHandlers(ipcMain)
  registerTabsHandlers(ipcMain, { saveTabState, loadTabState, deleteTabState, hasTabState, validatePath })
  registerHistoryHandlers(ipcMain, { historyManager })
  registerSettingsHandlers(ipcMain, { loadSettings, saveSettings })
  registerAgentsHandlers(ipcMain, { agentService })
  registerGitHandlers(ipcMain, { gitRunnerRegistry })
  registerSearchHandlers(ipcMain, { fileManager })
  registerNodeVersionHandlers(ipcMain, { nodeVersionManager })
  registerSshHandlers(ipcMain, { sshStore, sshSessionRegistry, sshConnectionMasters })
  registerClipboardHandlers(ipcMain, { sshSessionRegistry })
  trackpadService = new TrackpadGestureService({ getWindow: () => appService.mainWindow })
  registerTrackpadHandlers(ipcMain, { trackpadService })

  ipcMain.on(IPC_CHANNELS.TABS_STATE_CHANGED, () => appService.rebuildMenu())

  appService.createWindow()

  // Periodic main-process diagnostics (every 10s)
  diagnosticsInterval = setInterval(() => {
    const mem = process.memoryUsage()
    log.info(
      `[MainDiagnostics] Watchers=${fileManager.getWatcherCount()} ` +
      `PTYs=${ptyManager.sessions.size} ` +
      `HeapMB=${(mem.heapUsed / 1024 / 1024).toFixed(1)} ` +
      `RSSMB=${(mem.rss / 1024 / 1024).toFixed(1)}`
    )
  }, 10000)
})

app.on('window-all-closed', () => {
  trackpadService?.dispose()
  if (diagnosticsInterval) {
    clearInterval(diagnosticsInterval)
    diagnosticsInterval = null
  }
  appService.quit()
})

app.on('before-quit', async (e) => {
  if (isQuitting) return
  isQuitting = true
  e.preventDefault()
  await appService.beforeQuit()
  app.quit()
})
