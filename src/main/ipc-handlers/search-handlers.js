import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

/**
 * IPC handlers for project search.
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ fileManager: import('../file-manager').FileManager }} deps
 */
export function registerSearchHandlers(ipcMain, { fileManager }) {
  ipcMain.handle(IPC_CHANNELS.SEARCH_QUERY, async (_, { dirPath, query, options }) => {
    try {
      const results = await fileManager.searchFiles(dirPath, query, options)
      return { success: true, results }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
}
