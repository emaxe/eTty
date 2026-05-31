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

  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win.minimize()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win.maximize()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win.close()
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win.isMaximized()
  })
}
