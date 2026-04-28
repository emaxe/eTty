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
