import { IPC_CHANNELS } from '../../shared/ipc-channels.js'
import log from 'electron-log'

/**
 * Все каналы принимают `ctx` (`{kind:'ssh', sessionId}` для SSH-вкладки): команды выполняются
 * в шелле соответствующей машины. Переключение версии в терминале вкладки делает renderer
 * (команда в PTY), здесь его нет.
 */
export function registerNodeVersionHandlers(ipcMain, { nodeVersionManager }) {
  ipcMain.handle(IPC_CHANNELS.NODE_VERSION_DETECT_MANAGER, async (_, { ctx } = {}) => {
    try {
      return await nodeVersionManager.detectManager(ctx)
    } catch (e) {
      log.error('[NodeVersionHandlers] detectManager error:', e.message)
      return { manager: null, version: null }
    }
  })

  ipcMain.handle(IPC_CHANNELS.NODE_VERSION_RESOLVE, async (_, { nodePath, ctx }) => {
    try {
      return await nodeVersionManager.resolveNodePath(nodePath, ctx)
    } catch (e) {
      log.error('[NodeVersionHandlers] resolveNodePath error:', e.message)
      return null
    }
  })

  ipcMain.handle(IPC_CHANNELS.NODE_VERSION_LIST_INSTALLED, async (_, { ctx } = {}) => {
    try {
      return await nodeVersionManager.listInstalled(ctx)
    } catch (e) {
      log.error('[NodeVersionHandlers] listInstalled error:', e.message)
      return { manager: null, versions: [] }
    }
  })

  ipcMain.handle(IPC_CHANNELS.NODE_VERSION_LIST_REMOTE, async (_, { ctx } = {}) => {
    try {
      return await nodeVersionManager.listRemote(ctx)
    } catch (e) {
      log.error('[NodeVersionHandlers] listRemote error:', e.message)
      return { manager: null, versions: [] }
    }
  })

  ipcMain.handle(IPC_CHANNELS.NODE_VERSION_INSTALL, async (_, { version, ctx }) => {
    try {
      return await nodeVersionManager.install(version, ctx)
    } catch (e) {
      log.error('[NodeVersionHandlers] install error:', e.message)
      throw e
    }
  })

  ipcMain.handle(IPC_CHANNELS.NODE_VERSION_UNINSTALL, async (_, { version, ctx }) => {
    try {
      return await nodeVersionManager.uninstall(version, ctx)
    } catch (e) {
      log.error('[NodeVersionHandlers] uninstall error:', e.message)
      throw e
    }
  })

  ipcMain.handle(IPC_CHANNELS.NODE_VERSION_INSTALL_MANAGER, async (_, { ctx } = {}) => {
    try {
      return await nodeVersionManager.installManager(ctx)
    } catch (e) {
      log.error('[NodeVersionHandlers] installManager error:', e.message)
      throw e
    }
  })
}
