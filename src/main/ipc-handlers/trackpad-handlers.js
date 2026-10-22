import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

/**
 * Register trackpad gesture IPC handlers.
 * @param {Electron.IpcMain} ipcMain
 * @param {{ trackpadService: import('../services/trackpad-gesture-service.js').TrackpadGestureService }} deps
 */
export function registerTrackpadHandlers(ipcMain, { trackpadService }) {
  ipcMain.on(IPC_CHANNELS.TRACKPAD_SET_ENABLED, (_event, enabled) => {
    trackpadService.setEnabled(enabled)
  })
}
