import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import os from 'os'
import { PtyManager } from './pty-manager'

const ptyManager = new PtyManager()

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 400,
    minHeight: 300,
    frame: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(() => {
  ipcMain.handle('pty:create', (event, options) => {
    return ptyManager.create({ ...options, webContents: event.sender })
  })

  ipcMain.on('pty:write', (_, { pid, data }) => {
    ptyManager.write(pid, data)
  })

  ipcMain.on('pty:resize', (_, { pid, cols, rows }) => {
    ptyManager.resize(pid, cols, rows)
  })

  ipcMain.handle('app:homedir', () => os.homedir())

  createWindow()
})

app.on('window-all-closed', () => {
  ptyManager.killAll()
  app.quit()
})
