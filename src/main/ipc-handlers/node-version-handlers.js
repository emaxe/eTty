import { IPC_CHANNELS } from '../../shared/ipc-channels.js'
import log from 'electron-log'

export function registerNodeVersionHandlers(ipcMain, { nodeVersionManager }) {
  ipcMain.handle(IPC_CHANNELS.NODE_VERSION_DETECT_MANAGER, async () => {
    try {
      return await nodeVersionManager.detectManager()
    } catch (e) {
      log.error('[NodeVersionHandlers] detectManager error:', e.message)
      return { manager: null, version: null }
    }
  })

  ipcMain.handle(IPC_CHANNELS.NODE_VERSION_GET_CURRENT, async (_, { cwd }) => {
    try {
      return await nodeVersionManager.getCurrentVersion(cwd)
    } catch (e) {
      log.error('[NodeVersionHandlers] getCurrentVersion error:', e.message)
      return null
    }
  })

  ipcMain.handle(IPC_CHANNELS.NODE_VERSION_LIST_INSTALLED, async () => {
    try {
      return await nodeVersionManager.listInstalled()
    } catch (e) {
      log.error('[NodeVersionHandlers] listInstalled error:', e.message)
      return { manager: null, versions: [] }
    }
  })

  ipcMain.handle(IPC_CHANNELS.NODE_VERSION_LIST_REMOTE, async () => {
    try {
      return await nodeVersionManager.listRemote()
    } catch (e) {
      log.error('[NodeVersionHandlers] listRemote error:', e.message)
      return { manager: null, versions: [] }
    }
  })

  ipcMain.handle(IPC_CHANNELS.NODE_VERSION_INSTALL, async (_, { version }) => {
    try {
      return await nodeVersionManager.install(version)
    } catch (e) {
      log.error('[NodeVersionHandlers] install error:', e.message)
      throw e
    }
  })

  ipcMain.handle(IPC_CHANNELS.NODE_VERSION_USE, async (_, { version, cwd }) => {
    try {
      return await nodeVersionManager.use(version, cwd)
    } catch (e) {
      log.error('[NodeVersionHandlers] use error:', e.message)
      throw e
    }
  })

  ipcMain.handle(IPC_CHANNELS.NODE_VERSION_UNINSTALL, async (_, { version }) => {
    try {
      return await nodeVersionManager.uninstall(version)
    } catch (e) {
      log.error('[NodeVersionHandlers] uninstall error:', e.message)
      throw e
    }
  })

  ipcMain.handle(IPC_CHANNELS.NODE_VERSION_INSTALL_MANAGER, async () => {
    try {
      return await nodeVersionManager.installManager()
    } catch (e) {
      log.error('[NodeVersionHandlers] installManager error:', e.message)
      throw e
    }
  })
}
