import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

/**
 * Register window IPC handlers.
 * @param {Electron.IpcMain} ipcMain
 */
export function registerWindowHandlers(ipcMain) {
  ipcMain.handle(IPC_CHANNELS.WINDOW_GET_POSITION, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win.getPosition()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_MOVE, (event, { x, y }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win.setPosition(Math.round(x), Math.round(y))
  })
}
