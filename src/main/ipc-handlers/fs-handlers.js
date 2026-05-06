import { BrowserWindow, dialog } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

/**
 * Register file system IPC handlers.
 * @param {Electron.IpcMain} ipcMain
 * @param {{ fileManager: import('../file-manager').FileManager }} deps
 */
export function registerFsHandlers(ipcMain, { fileManager }) {
  ipcMain.handle(IPC_CHANNELS.FS_READ_DIR, async (_, { dirPath }) => {
    try { return await fileManager.readDir(dirPath) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_CREATE_FILE, async (_, { filePath }) => {
    try { return await fileManager.createFile(filePath) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_CREATE_DIR, async (_, { dirPath }) => {
    try { return await fileManager.createDir(dirPath) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_RENAME, async (_, { oldPath, newPath }) => {
    try { return await fileManager.rename(oldPath, newPath) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_DELETE, async (_, { targetPath }) => {
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

  ipcMain.handle(IPC_CHANNELS.FS_COPY, async (_, { srcPath, destDir }) => {
    try { return await fileManager.copy(srcPath, destDir) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_MOVE, async (_, { srcPaths, destDir }) => {
    try { return await fileManager.move(srcPaths, destDir) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_READ_FILE, async (_, { filePath }) => {
    try { return await fileManager.readFile(filePath) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_WRITE_FILE, async (_, { filePath, content }) => {
    try { return await fileManager.writeFile(filePath, content) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_STAT_FILE, async (_, { filePath }) => {
    try { return await fileManager.statFile(filePath) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_GET_CWD, () => fileManager.getCwd())

  ipcMain.handle(IPC_CHANNELS.FS_SET_ROOT, (_, { dirPath }) => {
    fileManager.setRoot(dirPath)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.FS_WATCH_DIR, (event, { dirPath }) => {
    return fileManager.watchDir(dirPath, event.sender)
  })

  ipcMain.handle(IPC_CHANNELS.FS_UNWATCH_DIR, (_, { dirPath }) => {
    fileManager.unwatchDir(dirPath)
  })
}
