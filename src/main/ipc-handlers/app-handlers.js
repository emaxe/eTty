import os from 'os'
import { shell } from 'electron'
import log from 'electron-log'
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

/**
 * Register app-level IPC handlers.
 * @param {Electron.IpcMain} ipcMain
 */
export function registerAppHandlers(ipcMain) {
  ipcMain.handle(IPC_CHANNELS.APP_HOMEDIR, () => os.homedir())

  ipcMain.handle(IPC_CHANNELS.APP_OPEN_EXTERNAL, async (_, filePath) => {
    const { error } = await shell.openPath(filePath)
    if (error) log.error('app:open-external failed:', error)
    return { success: !error, error }
  })
}
