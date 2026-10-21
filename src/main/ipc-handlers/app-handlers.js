import os from 'os'
import { shell } from 'electron'
import log from 'electron-log'
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

const OPEN_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

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

  // Ссылки из терминала — в системный браузер; допускаем только безопасные схемы.
  ipcMain.handle(IPC_CHANNELS.APP_OPEN_URL, async (_, url) => {
    try {
      const { protocol } = new URL(url)
      if (!OPEN_URL_PROTOCOLS.has(protocol)) return { success: false, error: `Unsupported protocol: ${protocol}` }
      await shell.openExternal(url)
      return { success: true }
    } catch (err) {
      log.error('app:open-url failed:', err)
      return { success: false, error: err.message }
    }
  })
}
