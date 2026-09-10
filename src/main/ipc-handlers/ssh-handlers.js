import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

/**
 * Register SSH connection IPC handlers.
 * @param {Electron.IpcMain} ipcMain
 * @param {{ sshStore: typeof import('../ssh-store.js') }} deps
 */
export function registerSshHandlers(ipcMain, { sshStore }) {
  ipcMain.handle(IPC_CHANNELS.SSH_LIST, () => sshStore.loadConnections())

  ipcMain.handle(IPC_CHANNELS.SSH_SAVE, (_, connection) => sshStore.saveConnection(connection))

  ipcMain.handle(IPC_CHANNELS.SSH_DELETE, (_, id) => sshStore.deleteConnection(id))

  ipcMain.handle(IPC_CHANNELS.SSH_REORDER, (_, ids) => sshStore.reorderConnections(ids))
}
