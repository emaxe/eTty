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
