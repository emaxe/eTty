import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import os from 'os'
import log from 'electron-log'
import { autoUpdater } from 'electron-updater'
import { PtyManager } from './pty-manager'
import { FileManager } from './file-manager'

const ptyManager = new PtyManager()
const fileManager = new FileManager()

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
  autoUpdater.logger = log
  try {
    autoUpdater.checkForUpdatesAndNotify()
  } catch (e) {
    log.info('auto-updater: no update server configured', e.message)
  }


  ipcMain.handle('pty:create', (event, options) => {
    return ptyManager.create({ ...options, webContents: event.sender })
  })

  ipcMain.on('pty:write', (_, { pid, data }) => {
    ptyManager.write(pid, data)
  })

  ipcMain.on('pty:resize', (_, { pid, cols, rows }) => {
    ptyManager.resize(pid, cols, rows)
  })

  ipcMain.handle('pty:kill', (_, pid) => {
    ptyManager.kill(pid)
  })

  ipcMain.handle('app:homedir', () => os.homedir())

  ipcMain.handle('window:get-position', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win.getPosition()
  })

  ipcMain.on('window:move', (event, { x, y }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win.setPosition(Math.round(x), Math.round(y))
  })

  ipcMain.handle('fs:read-dir', async (_, { dirPath }) => {
    try {
      return await fileManager.readDir(dirPath)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('fs:create-file', async (_, { filePath }) => {
    try {
      return await fileManager.createFile(filePath)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('fs:create-dir', async (_, { dirPath }) => {
    try {
      return await fileManager.createDir(dirPath)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('fs:rename', async (_, { oldPath, newPath }) => {
    try {
      return await fileManager.rename(oldPath, newPath)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('fs:delete', async (_, { targetPath }) => {
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

  ipcMain.handle('fs:copy', async (_, { srcPath, destDir }) => {
    try {
      return await fileManager.copy(srcPath, destDir)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('fs:get-cwd', () => {
    return fileManager.getCwd()
  })

  ipcMain.handle('fs:set-root', (_, { dirPath }) => {
    fileManager.setRoot(dirPath)
    return { success: true }
  })

  ipcMain.handle('fs:watch-dir', (event, { dirPath }) => {
    fileManager.watchDir(dirPath, event.sender)
  })

  ipcMain.handle('fs:unwatch-dir', (_, { dirPath }) => {
    fileManager.unwatchDir(dirPath)
  })

  createWindow()
})

app.on('window-all-closed', () => {
  ptyManager.killAll()
  fileManager.unwatchAll()
  app.quit()
})
