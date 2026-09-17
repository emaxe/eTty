import { IPC_CHANNELS } from '../../shared/ipc-channels.js'
import { establishSshFs } from './pty-handlers.js'

/**
 * Register SSH connection IPC handlers.
 * @param {Electron.IpcMain} ipcMain
 * @param {{ sshStore: typeof import('../ssh-store.js'), sshSessionRegistry: import('../ssh/ssh-session-registry.js').SshSessionRegistry }} deps
 */
export function registerSshHandlers(ipcMain, { sshStore, sshSessionRegistry }) {
  ipcMain.handle(IPC_CHANNELS.SSH_LIST, () => sshStore.loadConnections())

  ipcMain.handle(IPC_CHANNELS.SSH_SAVE, (_, connection) => sshStore.saveConnection(connection))

  ipcMain.handle(IPC_CHANNELS.SSH_DELETE, (_, id) => sshStore.deleteConnection(id))

  ipcMain.handle(IPC_CHANNELS.SSH_REORDER, (_, ids) => sshStore.reorderConnections(ids))

  // «Повторить» на плашке удалённого дерева. Если провайдер уже поднят — просто перепроверяем
  // мастер (быстро). Если нет (первая попытка сорвалась — таймаут/probe) — гоняем establishSshFs
  // заново по тому же каналу; sshLaunch для этого не нужен, он был нужен только для
  // Windows/socket-too-long проверок ДО создания канала, которые уже пройдены раз канал есть.
  ipcMain.handle(IPC_CHANNELS.SSH_FS_RETRY, async (event, sessionId) => {
    const session = sshSessionRegistry.get(sessionId)
    if (!session) return { success: false, error: 'no-session' }

    if (session.fsProvider) {
      const alive = await session.channel.isAlive()
      if (!event.sender.isDestroyed()) {
        event.sender.send(IPC_CHANNELS.SSH_FS_READY, {
          pid: sessionId,
          sessionId,
          available: alive,
          ...(alive ? {} : { reason: 'master-lost' })
        })
      }
      return { success: alive }
    }

    const ok = await establishSshFs(sessionId, { sshSessionRegistry, webContents: event.sender })
    return { success: ok }
  })
}
