import { IPC_CHANNELS } from '../../shared/ipc-channels.js'
import { buildSshLaunch } from '../ssh-command.js'
import log from 'electron-log'

/**
 * Register PTY IPC handlers.
 * @param {Electron.IpcMain} ipcMain
 * @param {{
 *   ptyManager: import('../pty-manager').PtyManager,
 *   historyManager: import('../history-manager').HistoryManager,
 *   sshStore: typeof import('../ssh-store.js'),
 *   shellPathResolver: import('../shell-path-resolver').ShellPathResolver
 * }} deps
 */
const IS_WIN = process.platform === 'win32'

export function registerPtyHandlers(ipcMain, { ptyManager, historyManager, sshStore, shellPathResolver }) {
  ipcMain.handle(IPC_CHANNELS.PTY_CREATE, async (event, options) => {
    const tabId = options.tabId || crypto.randomUUID()

    if (options.ssh?.connectionId) {
      const connection = await sshStore.getConnectionForLaunch(options.ssh.connectionId)
      if (!connection) {
        return { error: 'connection-not-found' }
      }
      const sshLaunch = buildSshLaunch({ connection, resolvedPath: shellPathResolver.getResolvedPath() })
      try {
        return ptyManager.create({ ...options, tabId, sshLaunch, webContents: event.sender })
      } catch (e) {
        log.error('[PtyHandlers] Failed to spawn SSH session', e.message)
        return { error: e.message }
      }
    }

    let historyFile = null
    let initialHistSize = 0

    if (!IS_WIN) {
      await historyManager.ensureHistoryDir()
      historyFile = historyManager.getTabHistoryPath(tabId)
      const isRestore = await historyManager.tabHistoryExists(tabId)

      if (isRestore) {
        await historyManager.prepareHistoryForRestoredTab(tabId)
      } else {
        await historyManager.prepareHistoryForNewTab(tabId)
      }

      initialHistSize = await historyManager.getFileSize(historyFile)
    }

    return ptyManager.create({
      ...options,
      tabId,
      historyFile,
      initialHistSize,
      webContents: event.sender
    })
  })

  ipcMain.on(IPC_CHANNELS.PTY_WRITE, (_, { pid, data }) => {
    ptyManager.write(pid, data)
  })

  ipcMain.on(IPC_CHANNELS.PTY_RESIZE, (_, { pid, cols, rows }) => {
    ptyManager.resize(pid, cols, rows)
  })

  ipcMain.handle(IPC_CHANNELS.PTY_KILL, async (_, pid) => {
    const session = ptyManager.getSession(pid)
    // Мерж истории — только для локальных сессий с файлом истории (не для SSH).
    // tmpDir (ZDOTDIR / SSH_ASKPASS) в обеих ветках чистится в PtyManager.onExit,
    // который срабатывает на любой kill() нижележащего pty-процесса.
    if (session?.tabId && session.historyFile) {
      ptyManager.sessions.delete(pid)
      await historyManager.mergeTabToGlobal(session.tabId, session.initialHistSize)
      session.pty.kill()
    } else {
      ptyManager.kill(pid)
    }
  })
}
