import { IPC_CHANNELS } from '../../shared/ipc-channels.js'
import { SSH_SESSION_CONFIG } from '../../shared/ssh-session-config.js'
import { TMUX_LIST_SESSIONS_SCRIPT, TMUX_KILL_SESSION_SCRIPT, TMUX_RENAME_SESSION_SCRIPT } from '../ssh/remote-scripts.js'
import { parseTmuxSessions } from '../ssh/remote-parse.js'
import { establishSshFs } from './pty-handlers.js'

/** connectionId'ы, удержанные (acquire) каждым webContents — страховка на случай, если
 *  renderer перезагрузился/закрылся, не дождавшись парного ssh:master-release. */
const acquiredByWebContents = new Map()
const trackedSenders = new WeakSet()

function trackAcquired(sender, sshConnectionMasters, connectionId) {
  let ids = acquiredByWebContents.get(sender.id)
  if (!ids) {
    ids = new Set()
    acquiredByWebContents.set(sender.id, ids)
  }
  ids.add(connectionId)
  if (trackedSenders.has(sender)) return
  trackedSenders.add(sender)
  sender.once('destroyed', () => {
    const held = acquiredByWebContents.get(sender.id)
    acquiredByWebContents.delete(sender.id)
    if (held) sshConnectionMasters.releaseAllFor([...held])
  })
}

function untrackReleased(sender, connectionId) {
  acquiredByWebContents.get(sender.id)?.delete(connectionId)
}

/**
 * Register SSH connection IPC handlers.
 * @param {Electron.IpcMain} ipcMain
 * @param {{ sshStore: typeof import('../ssh-store.js'), sshSessionRegistry: import('../ssh/ssh-session-registry.js').SshSessionRegistry,
 *   sshConnectionMasters: import('../ssh/ssh-connection-master-registry.js').SshConnectionMasterRegistry }} deps
 */
export function registerSshHandlers(ipcMain, { sshStore, sshSessionRegistry, sshConnectionMasters }) {
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

  // — Панель tmux-сессий (SshConnectionMaster, ssh/ssh-connection-master.js) —

  ipcMain.handle(IPC_CHANNELS.SSH_MASTER_ACQUIRE, async (event, connectionId) => {
    const connection = await sshStore.getConnectionForLaunch(connectionId)
    if (!connection) return { success: false, reason: 'connection-not-found' }
    const result = await sshConnectionMasters.acquire(connectionId, connection)
    if (result.ok) trackAcquired(event.sender, sshConnectionMasters, connectionId)
    return { success: result.ok, reason: result.ok ? undefined : result.reason }
  })

  ipcMain.on(IPC_CHANNELS.SSH_MASTER_RELEASE, (event, connectionId) => {
    sshConnectionMasters.release(connectionId)
    untrackReleased(event.sender, connectionId)
  })

  ipcMain.handle(IPC_CHANNELS.SSH_SESSIONS_LIST, async (_, connectionId, force = false) => {
    const connection = await sshStore.getConnectionForLaunch(connectionId)
    if (!connection) return { success: false, reason: 'connection-not-found' }
    const result = await sshConnectionMasters.exec(
      connectionId, connection, TMUX_LIST_SESSIONS_SCRIPT,
      [connection.tmuxSocket ?? SSH_SESSION_CONFIG.DEFAULT_SOCKET],
      { timeoutMs: SSH_SESSION_CONFIG.SESSIONS_OP_TIMEOUT_MS, force }
    )
    if (result.error) return { success: false, reason: result.error }
    if (result.code === 127) return { success: false, reason: 'no-tmux' }
    if (result.timedOut) return { success: false, reason: 'timeout' }
    if (result.code !== 0) return { success: false, reason: 'error' }
    return { success: true, sessions: parseTmuxSessions(result.stdout) }
  })

  ipcMain.handle(IPC_CHANNELS.SSH_SESSION_KILL, async (_, { connectionId, name }) => {
    // Валидация ДО подстановки — имя сессии уходит позиционным параметром, но проверка на
    // обеих сторонах (main + renderer) — часть общего инварианта проекта для этого поля.
    if (!SSH_SESSION_CONFIG.SESSION_NAME_RE.test(name || '')) return { success: false, error: 'invalid-session-name' }
    const connection = await sshStore.getConnectionForLaunch(connectionId)
    if (!connection) return { success: false, error: 'connection-not-found' }
    const result = await sshConnectionMasters.exec(
      connectionId, connection, TMUX_KILL_SESSION_SCRIPT,
      [connection.tmuxSocket ?? SSH_SESSION_CONFIG.DEFAULT_SOCKET, name],
      { timeoutMs: SSH_SESSION_CONFIG.SESSIONS_OP_TIMEOUT_MS }
    )
    if (result.error) return { success: false, error: result.error }
    if (result.code === 3) return { success: false, error: 'not-found' }
    if (result.code !== 0) return { success: false, error: 'error' }
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SSH_SESSION_RENAME, async (_, { connectionId, name, newName }) => {
    if (!SSH_SESSION_CONFIG.SESSION_NAME_RE.test(name || '')) return { success: false, error: 'invalid-session-name' }
    if (!SSH_SESSION_CONFIG.SESSION_NAME_RE.test(newName || '')) return { success: false, error: 'invalid-new-name' }
    const connection = await sshStore.getConnectionForLaunch(connectionId)
    if (!connection) return { success: false, error: 'connection-not-found' }
    const result = await sshConnectionMasters.exec(
      connectionId, connection, TMUX_RENAME_SESSION_SCRIPT,
      [connection.tmuxSocket ?? SSH_SESSION_CONFIG.DEFAULT_SOCKET, name, newName],
      { timeoutMs: SSH_SESSION_CONFIG.SESSIONS_OP_TIMEOUT_MS }
    )
    if (result.error) return { success: false, error: result.error }
    if (result.code === 3) return { success: false, error: 'not-found' }
    if (result.code === 17) return { success: false, error: 'name-taken' }
    if (result.code !== 0) return { success: false, error: 'error' }
    return { success: true }
  })
}
