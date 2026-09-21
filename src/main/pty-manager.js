import { spawn } from 'node-pty'
import fs from 'fs'
import os from 'os'
import path from 'path'
import log from 'electron-log'
import { IPC_CHANNELS } from '../shared/ipc-channels.js'
import { SshControlChannel } from './ssh/ssh-control-channel.js'

const IS_WIN = process.platform === 'win32'

// Хвост вывода SSH-PTY для диагностики: при ненулевом коде выхода renderer видит только код,
// а текст ошибки (tmux/ssh/remote-shell) терялся — см. onExit ниже.
const SSH_EXIT_TAIL_BYTES = 2048
// eslint-disable-next-line no-control-regex
const ANSI_CSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

/**
 * Локальный cwd процесса `ssh` ни на что не влияет — но должен существовать: у подключённой
 * SSH-вкладки `tab.rootPath` это УДАЛЁННЫЙ путь (OSC 7/remoteCwd), и renderer передаёт его сюда
 * при реконнекте и при новой вкладке от активной SSH-вкладки. Без проверки node-pty падает на
 * chdir за ~20 мс с exitCode 1 и пустым выводом («соединение разорвано (код 1)»).
 */
function resolveSshSpawnCwd(cwd) {
  try {
    if (cwd && fs.statSync(cwd).isDirectory()) return cwd
  } catch {
    // нет такого локального каталога (удалённый путь) — падаем на домашний
  }
  return os.homedir()
}

const PROMPT_MAP = {
  short: '%1~ %% ',
  minimal: '> ',
  arrow: '%1~ ❯ '
}

/**
 * Управляет PTY-сессиями (псевдотерминалами) для вкладок.
 * На macOS/Linux каждая вкладка получает изолированную zsh-сессию с собственными
 * ZDOTDIR и HISTFILE (история, OSC 7/133 хуки). На Windows — сессия cmd.exe без
 * ZDOTDIR/истории/OSC-хуков (zsh-специфичны).
 */
export class PtyManager {
  /** @param {{ shellPathResolver, sshSessionRegistry: import('./ssh/ssh-session-registry.js').SshSessionRegistry }} deps */
  constructor({ shellPathResolver, sshSessionRegistry }) {
    /** @type {Map<number, {pty, webContents, tabId: string, historyFile: string|null, initialHistSize: number, tmpDir: string|null, isSsh: boolean}>} */
    this.sessions = new Map()
    this._shellPathResolver = shellPathResolver
    this._sshSessionRegistry = sshSessionRegistry
  }

  /**
   * Создаёт временный ZDOTDIR с кастомными .zshenv и .zshrc.
   * .zshenv — sourcing пользовательского ~/.zshenv
   * .zshrc — sourcing ~/.zshrc + настройка истории + zsh-хуки для OSC 7/133
   * @param {string|null} historyFile — путь к HISTFILE для этой сессии
   * @returns {string} путь к временной директории ZDOTDIR
   */
  _createZdotdir(historyFile, promptStyle) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etty-'))
    const home = os.homedir()
    const userZshenv = path.join(home, '.zshenv')
    const userZshrc = path.join(home, '.zshrc')

    fs.writeFileSync(
      path.join(tmpDir, '.zshenv'),
      `[[ -f "${userZshenv}" ]] && builtin source "${userZshenv}"\n`
    )

    const historyLines = historyFile
      ? [
          `HISTFILE="${historyFile}"`,
          `HISTSIZE=5000`,
          `SAVEHIST=5000`,
          `setopt INC_APPEND_HISTORY`,
          `setopt HIST_IGNORE_DUPS`,
          `setopt HIST_IGNORE_SPACE`
        ]
      : []

    fs.writeFileSync(
      path.join(tmpDir, '.zshrc'),
      [
        `[[ -f "${userZshrc}" ]] && builtin source "${userZshrc}"`,
        `PROMPT_EOL_MARK=""`,
        ...historyLines,
        `autoload -Uz add-zsh-hook`,
        `_etty_cwd() { printf '\\033]7;file://%s\\007' "$PWD"; }`,
        `_etty_preexec() { printf '\\033]133;C\\007' }`,
        `_etty_precmd_state() { printf '\\033]133;A\\007' }`,
        `add-zsh-hook precmd _etty_cwd`,
        `add-zsh-hook preexec _etty_preexec`,
        `add-zsh-hook precmd _etty_precmd_state`,
        `_etty_cwd`,
        ...(PROMPT_MAP[promptStyle] ? [`PROMPT='${PROMPT_MAP[promptStyle]}'`] : [])
      ].join('\n') + '\n'
    )

    return tmpDir
  }

  /**
   * Запускает новую сессию в изолированном PTY: локальный shell (zsh на macOS/Linux,
   * cmd.exe на Windows), либо — если передан `sshLaunch` (см. `ssh-command.js`) — SSH-сессию
   * к удалённому хосту через системный `ssh`. Для SSH-сессий с доступным ControlMaster
   * (`sshLaunch.control`) дополнительно поднимает `SshControlChannel` — служебный канал для
   * операций удалённой ФС (Этап 4), регистрируемый в `sshSessionRegistry` по pid PTY.
   * @param {object} params
   * @param {{file: string, args: string[], env: object, tmpDir: string|null,
   *   control: {dir: string, path: string, target: string, port: number}|null}} [params.sshLaunch]
   * @returns {{pid: number}} — PID процесса для идентификации сессии
   */
  create({ cols, rows, cwd, webContents, tabId, historyFile, initialHistSize, promptStyle, sshLaunch, ssh }) {
    const isWin = IS_WIN
    const isSsh = !!sshLaunch

    let spawnFile, spawnArgs, env, tmpDir

    if (isSsh) {
      spawnFile = sshLaunch.file
      spawnArgs = sshLaunch.args
      env = sshLaunch.env
      tmpDir = sshLaunch.tmpDir
    } else {
      spawnFile = this._shellPathResolver.getDefaultShell()
      spawnArgs = []
      tmpDir = isWin ? null : this._createZdotdir(historyFile, promptStyle)
      env = {
        ...process.env,
        PATH: this._shellPathResolver.getResolvedPath()
          || process.env.PATH
          || (isWin ? '' : '/usr/bin:/bin:/usr/sbin:/sbin')
      }
      if (!isWin) {
        env.ZDOTDIR = tmpDir
        env.LANG = process.env.LANG || 'en_US.UTF-8'
        env.LC_CTYPE = process.env.LC_CTYPE || 'en_US.UTF-8'
      }
    }

    const ptyProcess = spawn(spawnFile, spawnArgs, {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: isSsh ? resolveSshSpawnCwd(cwd) : cwd,
      env
    })

    if (isSsh && sshLaunch.control) {
      const channel = new SshControlChannel({
        sshFile: sshLaunch.file,
        target: sshLaunch.control.target,
        port: sshLaunch.control.port,
        controlPath: sshLaunch.control.path,
        controlDir: sshLaunch.control.dir
      })
      // Канал сам владеет жизненным циклом controlDir (создаёт/чистит при dispose()) —
      // PtyManager отдельно этот каталог не отслеживает. connectionId — чтобы панель SSH/tmux
      // могла найти и «одолжить» уже живой канал этой вкладки вместо подъёма отдельного
      // панельного мастера (см. SshConnectionMasterRegistry.acquire()).
      this._sshSessionRegistry.register(ptyProcess.pid, channel, ssh?.connectionId ?? null)
    }

    this.sessions.set(ptyProcess.pid, {
      pty: ptyProcess,
      webContents,
      tabId,
      historyFile: isSsh ? null : historyFile,
      initialHistSize: initialHistSize || 0,
      tmpDir,
      isSsh
    })

    // Batch PTY output: accumulate chunks and flush every ~8 ms.
    // This prevents IPC flooding when TUI apps (Copilot CLI, etc.)
    // redraw the screen at high frequency.
    let dataChunks = []
    let flushTimer = null
    let sshTail = ''
    const startedAt = Date.now()

    const flushData = () => {
      if (dataChunks.length > 0 && !webContents.isDestroyed()) {
        webContents.send(IPC_CHANNELS.PTY_DATA, { pid: ptyProcess.pid, data: dataChunks.join('') })
        dataChunks = []
      }
      flushTimer = null
    }

    ptyProcess.onData((data) => {
      if (isSsh) sshTail = (sshTail + data).slice(-SSH_EXIT_TAIL_BYTES)
      dataChunks.push(data)
      if (!flushTimer) {
        flushTimer = setTimeout(flushData, 8)
      }
    })

    ptyProcess.onExit(({ exitCode, signal }) => {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushData()
      }
      if (isSsh && exitCode !== 0) {
        log.warn('[PtyManager] ssh session exited', {
          pid: ptyProcess.pid,
          exitCode,
          signal,
          lifetimeMs: Date.now() - startedAt,
          sessionName: ssh?.sessionName ?? null,
          persistence: ssh?.persistence ?? null,
          tail: sshTail.replace(ANSI_CSI_RE, '')
        })
      }
      if (!webContents.isDestroyed()) {
        webContents.send(IPC_CHANNELS.PTY_EXIT, { pid: ptyProcess.pid, exitCode, signal })
      }
      this.sessions.delete(ptyProcess.pid)
      // ControlMaster-канал (если был) сам чистит свой controlDir при dispose()
      this._sshSessionRegistry.dispose(ptyProcess.pid)
      // ZDOTDIR (локальные сессии) / SSH_ASKPASS (SSH)
      this._rmDirSafe(tmpDir, 'tmpDir on exit')
    })

    return { pid: ptyProcess.pid }
  }

  _rmDirSafe(dir, label) {
    if (!dir) return
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch (err) {
      log.warn(`pty-manager: failed to cleanup ${label}`, dir, err.message)
    }
  }

  write(pid, data) {
    this.sessions.get(pid)?.pty.write(data)
  }

  getSession(pid) {
    return this.sessions.get(pid) || null
  }

  resize(pid, cols, rows) {
    this.sessions.get(pid)?.pty.resize(cols, rows)
  }

  kill(pid) {
    const session = this.sessions.get(pid)
    if (session) {
      session.pty.kill()
      this.sessions.delete(pid)
      this._sshSessionRegistry.dispose(pid)
      this._rmDirSafe(session.tmpDir, 'tmpDir')
    }
  }

  killAll() {
    const dirs = []
    for (const [pid, session] of this.sessions) {
      if (session.tmpDir) dirs.push(session.tmpDir)
      this._sshSessionRegistry.dispose(pid)
      session.pty.kill()
    }
    this.sessions.clear()
    for (const dir of dirs) {
      this._rmDirSafe(dir, 'dir on killAll')
    }
  }

  getDiagnostics() {
    const result = {}
    for (const [pid, session] of this.sessions) {
      result[pid] = {
        tabId: session.tabId,
        historyFile: session.historyFile,
        rows: session.pty.rows,
        cols: session.pty.cols,
      }
    }
    return result
  }
}
