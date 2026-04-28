import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {{ loadSettings, saveSettings }} deps
 */
export function registerSettingsHandlers(ipcMain, { loadSettings, saveSettings }) {
  ipcMain.handle(IPC_CHANNELS.SETTINGS_LOAD, () => loadSettings())
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SAVE, (_, settings) => saveSettings(settings))
}
