import { IPC_CHANNELS } from '../../shared/ipc-channels.js'
import { buildSshLaunch } from '../ssh-command.js'
import { PROBE_SCRIPT, TMUX_SESSION_STATE_SCRIPT } from '../ssh/remote-scripts.js'
import { parseProbe, parseTmuxSessionState } from '../ssh/remote-parse.js'
import { buildTmuxInstallCommand } from '../ssh/tmux-install.js'
import { resolveSshPersistence } from '../../shared/ssh-persistence.js'
import { SshFsProvider } from '../fs/ssh-fs-provider.js'
import { createPathUtils } from '../../shared/path-utils.js'
import { SSH_FS_CONFIG } from '../../shared/ssh-fs-config.js'
import { SSH_SESSION_CONFIG } from '../../shared/ssh-session-config.js'
import log from 'electron-log'

const IS_WIN = process.platform === 'win32'

/**
 * Спрашивает у tmux состояние панели (cwd, foreground-процесс) и пушит `ssh:session-state`.
 * Вызывается сразу после attach и повторно по запросу renderer (`ssh:session-resync`) — если первый
 * ресинк не удался (tmux не в PATH, таймаут), вкладка с уже запущенным агентом иначе так и
 * осталась бы без панели быстрых команд.
 * @param {number} pid
 * @returns {Promise<boolean>} true — состояние получено и отправлено
 */
export async function resyncTmuxSessionState(pid, { sshSessionRegistry, webContents }) {
  const session = sshSessionRegistry.get(pid)
  const target = sshSessionRegistry.getTmuxTarget(pid)
  if (!session || !target) return false
  try {
    const result = await session.channel.exec(
      TMUX_SESSION_STATE_SCRIPT,
      [target.socketName, target.sessionName],
      { timeoutMs: SSH_FS_CONFIG.OP_TIMEOUT_MS }
    )
    if (!sshSessionRegistry.get(pid) || result.code !== 0) return false
    const state = parseTmuxSessionState(result.stdout.toString('utf-8'))
    if (!state || webContents.isDestroyed()) return false
    webContents.send(IPC_CHANNELS.SSH_SESSION_STATE, { pid, ...state })
    return true
  } catch (e) {
    log.warn('[PtyHandlers] tmux session-state resync failed', pid, e.message)
    return false
  }
}

/**
 * Ждёт поднятия ControlMaster для сессии `pid`, гонит одноразовый probe (ОС/флавор `stat`/
 * поддержка `find -print0`, см. `ssh/remote-scripts.js`), поднимает `SshFsProvider` и пушит
 * `ssh:fs-ready` в renderer. Переиспользуется и при первом подключении (см. `watchSshFsReadiness`),
 * и при ручном «Повторить» (см. `ssh-handlers.js` — там `sshLaunch` уже недоступен, но и не нужен:
 * весь необходимый контекст канала уже хранится в самом `SshControlChannel`).
 * @param {number} pid
 */
export async function establishSshFs(pid, { sshSessionRegistry, webContents, persistence, sessionName, socketName }) {
  const send = (payload) => {
    if (!webContents.isDestroyed()) {
      webContents.send(IPC_CHANNELS.SSH_FS_READY, { pid, sessionId: pid, ...payload })
    }
  }

  const session = sshSessionRegistry.get(pid)
  if (!session) return false // сессия уже закрылась до старта опроса

  const ready = await session.channel.waitReady({ isCancelled: () => !sshSessionRegistry.get(pid) })
  if (!sshSessionRegistry.get(pid)) return false // вкладку закрыли/переподключили, пока ждали
  if (!ready) {
    send({ available: false, reason: 'master-timeout' })
    return false
  }

  // Ресинк cwd/busy персистентной (tmux) сессии сразу после attach — без него вкладка не узнает
  // состояние до следующего промпта (может быть через часы), см. план, Этап 2. Не блокирует и
  // не зависит от FS-проба ниже — отдельная операция по тому же каналу.
  if (persistence === 'tmux' && sessionName) {
    sshSessionRegistry.setTmuxTarget(pid, { socketName: socketName || '', sessionName })
    resyncTmuxSessionState(pid, { sshSessionRegistry, webContents })
  }

  const probeResult = await session.channel.exec(PROBE_SCRIPT, [], { timeoutMs: SSH_FS_CONFIG.PROBE_TIMEOUT_MS })
  if (!sshSessionRegistry.get(pid)) return false
  if (probeResult.code !== 0 || !probeResult.stdout.length) {
    log.warn('[PtyHandlers] SSH probe failed', pid, probeResult.error || probeResult.code)
    send({ available: false, reason: 'probe-failed' })
    return false
  }

  const caps = parseProbe(probeResult.stdout.toString('utf-8'))
  if (!caps.home) {
    send({ available: false, reason: 'probe-failed' })
    return false
  }
  sshSessionRegistry.setCaps(pid, caps)

  // Постоянные сессии запрошены, но tmux на сервере не найден — предлагаем установить (с
  // подтверждением на стороне renderer, команда вводится в реальный терминал вкладки, а не
  // выполняется здесь привилегированно — см. tmux-install.js). Молчим, если менеджер пакетов
  // не распознан: без готовой команды предлагать нечего.
  if (persistence === 'tmux' && !caps.tmuxVersion) {
    const installCmd = buildTmuxInstallCommand(caps.pkgManager)
    if (installCmd && !webContents.isDestroyed()) {
      webContents.send(IPC_CHANNELS.SSH_TMUX_MISSING, { pid, installCmd })
    }
  }

  const fsProvider = new SshFsProvider({
    channel: session.channel,
    root: caps.home,
    caps,
    pathUtils: createPathUtils('/')
  })
  sshSessionRegistry.setFsProvider(pid, fsProvider)

  send({ available: true, caps })
  return true
}

/** Предварительные, специфичные для первого подключения проверки (см. `establishSshFs`). */
async function watchSshFsReadiness(pid, { sshSessionRegistry, sshLaunch, webContents, persistence, sessionName, socketName }) {
  const send = (payload) => {
    if (!webContents.isDestroyed()) {
      webContents.send(IPC_CHANNELS.SSH_FS_READY, { pid, sessionId: pid, ...payload })
    }
  }

  if (IS_WIN) {
    send({ available: false, reason: 'no-controlmaster-on-windows' })
    return
  }
  if (!sshLaunch.control) {
    send({ available: false, reason: 'socket-path-too-long' })
    return
  }

  await establishSshFs(pid, { sshSessionRegistry, webContents, persistence, sessionName, socketName })
}

/**
 * Register PTY IPC handlers.
 * @param {Electron.IpcMain} ipcMain
 * @param {{
 *   ptyManager: import('../pty-manager').PtyManager,
 *   historyManager: import('../history-manager').HistoryManager,
 *   sshStore: typeof import('../ssh-store.js'),
 *   shellPathResolver: import('../shell-path-resolver').ShellPathResolver,
 *   sshSessionRegistry: import('../ssh/ssh-session-registry.js').SshSessionRegistry
 * }} deps
 */
export function registerPtyHandlers(ipcMain, { ptyManager, historyManager, sshStore, shellPathResolver, sshSessionRegistry }) {
  ipcMain.handle(IPC_CHANNELS.PTY_CREATE, async (event, options) => {
    const tabId = options.tabId || crypto.randomUUID()

    if (options.ssh?.connectionId) {
      const connection = await sshStore.getConnectionForLaunch(options.ssh.connectionId)
      if (!connection) {
        return { error: 'connection-not-found' }
      }
      // Режим ЭТОГО запуска — из панели SSH/tmux (renderer передаёт options.ssh.persistence
      // явно), а не только из сохранённой настройки подключения; connection.persistence
      // остаётся fallback для обратной совместимости (вкладки, восстановленные до этой фичи —
      // см. ssh/ssh-persistence.js).
      const persistence = resolveSshPersistence(options.ssh, connection)
      // Имя сессии — единственная интерполяция данных в текст remote-команды (см.
      // remote-shell-hooks.js) — проверяем ДО buildSshLaunch, а не полагаемся только на
      // проверку внутри билдера, чтобы вернуть понятную ошибку вызывающей стороне.
      if (persistence === 'tmux' && !SSH_SESSION_CONFIG.SESSION_NAME_RE.test(options.ssh.sessionName || '')) {
        return { error: 'invalid-session-name' }
      }
      const sshLaunch = buildSshLaunch({
        connection,
        resolvedPath: shellPathResolver.getResolvedPath(),
        skipShellIntegration: !!options.ssh.skipShellIntegration,
        sessionName: options.ssh.sessionName || null,
        persistence
      })
      let result
      try {
        result = ptyManager.create({ ...options, tabId, sshLaunch, webContents: event.sender })
      } catch (e) {
        log.error('[PtyHandlers] Failed to spawn SSH session', e.message)
        return { error: e.message }
      }
      watchSshFsReadiness(result.pid, {
        sshSessionRegistry,
        sshLaunch,
        webContents: event.sender,
        persistence,
        sessionName: options.ssh.sessionName || null,
        socketName: connection.tmuxSocket ?? SSH_SESSION_CONFIG.DEFAULT_SOCKET
      }).catch((e) => log.warn('[PtyHandlers] watchSshFsReadiness failed', e.message))
      // persistence — resolved-значение этого запуска; renderer пишет его в tab.ssh.persistence
      // (self-heal для восстановленных вкладок без явного persistence в tabs-state.json).
      return { ...result, persistence }
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
