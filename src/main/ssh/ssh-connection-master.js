import { spawn } from 'child_process'
import fs from 'fs'
import log from 'electron-log'
import { createControlSocket, SshControlChannel } from './ssh-control-channel.js'
import { applyAskpassEnv } from './askpass.js'
import { SSH_SESSION_CONFIG } from '../../shared/ssh-session-config.js'

/**
 * Служебный ControlMaster на КОНКРЕТНОЕ ПОДКЛЮЧЕНИЕ (не на PTY-вкладку) — источник списка
 * tmux-сессий для боковой панели, когда для этого подключения нет открытой вкладки.
 *
 * Намеренно ОТДЕЛЁН от per-PTY ControlMaster в `pty-manager.js`/`ssh-command.js`:
 * 1. У OpenSSH смерть процесса-мастера рвёт ВСЕ сессии на его сокете — если бы мастером
 *    становилась вкладка, закрытие вкладки №1 убивало бы вкладки №2..N того же хоста; если бы
 *    мастером всегда была панель — её сбой (askpass/2FA/таймаут) стал бы единой точкой отказа
 *    для создания терминальных вкладок.
 * 2. Разная семантика аутентификации — вкладке нужен интерактивный `-tt` с вводом пароля/2FA
 *    в терминале, этот мастер обязан быть неинтерактивным (`stdio:'ignore'`).
 * Цена раздельности — одно лишнее SSH-соединение на РАСКРЫТОЕ подключение, ограниченное
 * idle-таймером (см. `SshConnectionMasterRegistry` — она же предпочитает «одолжить» уже живой
 * канал вкладки вместо подъёма этого мастера, когда такая вкладка есть).
 */
export class SshConnectionMaster {
  /**
   * @param {{ connectionId: string, sshFile: string, target: string, port: number,
   *   privateKeyPath?: string, extraArgs?: string, secret?: string|null }} params
   */
  constructor({ connectionId, sshFile, target, port, privateKeyPath, extraArgs, secret }) {
    this._connectionId = connectionId
    this._sshFile = sshFile
    this._target = target
    this._port = port
    this._privateKeyPath = privateKeyPath || ''
    this._extraArgs = extraArgs || ''
    this._secret = secret || null

    this._channel = null
    this._masterProcess = null
    this._askpassTmpDir = null
    this._state = 'idle'
    this._pendingEnsure = null
    this._failure = null // { reason, at }
    this._refCount = 0
    this._idleTimer = null
  }

  get state() {
    return this._state
  }

  /** Держит мастер живым — гасит отложенный dispose от предыдущего release(). */
  acquire() {
    this._refCount++
    if (this._idleTimer) {
      clearTimeout(this._idleTimer)
      this._idleTimer = null
    }
  }

  /** Планирует dispose() после `MASTER_IDLE_DISPOSE_MS` простоя, если больше никто не держит. */
  release() {
    this._refCount = Math.max(0, this._refCount - 1)
    if (this._refCount > 0 || this._idleTimer) return
    this._idleTimer = setTimeout(() => {
      this._idleTimer = null
      if (this._refCount === 0) this.dispose()
    }, SSH_SESSION_CONFIG.MASTER_IDLE_DISPOSE_MS)
    this._idleTimer.unref?.()
  }

  /**
   * Поднимает мастер, если он ещё не готов (single-flight — параллельные вызовы ждут один
   * и тот же промис). Провал кешируется на `MASTER_FAILURE_COOLDOWN_MS` — без этого
   * автообновление списка сессий раз в `SESSIONS_POLL_MS` долбило бы сервер паролем при каждой
   * попытке и могло упереться в `MaxAuthTries`/fail2ban.
   * @param {{ force?: boolean }} [opts] — `force` сбрасывает cooldown (ручное «Обновить»)
   * @returns {Promise<{ ok: true }|{ ok: false, reason: string }>}
   */
  async ensure({ force = false } = {}) {
    if (this._state === 'ready' && this._channel) return { ok: true }
    if (!force && this._failure && Date.now() - this._failure.at < SSH_SESSION_CONFIG.MASTER_FAILURE_COOLDOWN_MS) {
      return { ok: false, reason: this._failure.reason }
    }
    if (this._pendingEnsure) return this._pendingEnsure
    this._pendingEnsure = this._connect().finally(() => { this._pendingEnsure = null })
    return this._pendingEnsure
  }

  async _connect() {
    this._state = 'connecting'
    this._failure = null

    const socket = createControlSocket()
    if (!socket) {
      // null — либо Windows (OpenSSH для Windows не поддерживает ControlMaster), либо путь к
      // сокету не влезает в лимит sun_path даже с фолбэком на /tmp (см. createControlSocket).
      const reason = process.platform === 'win32' ? 'no-controlmaster' : 'socket-path-too-long'
      return this._fail(reason)
    }

    const env = { ...process.env }
    const askpass = this._secret ? applyAskpassEnv(env, this._secret, { sshFile: this._sshFile }) : { tmpDir: null }
    this._askpassTmpDir = askpass.tmpDir

    const args = [
      '-N',
      '-o', 'ControlMaster=yes',
      '-o', `ControlPath=${socket.path}`,
      '-o', `ControlPersist=${SSH_SESSION_CONFIG.MASTER_CONTROL_PERSIST}`,
      '-o', 'ConnectTimeout=10',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      '-o', 'NumberOfPasswordPrompts=1',
      '-o', 'LogLevel=ERROR',
      '-p', String(this._port)
    ]
    // Политику host-key НЕ трогаем (никакого StrictHostKeyChecking) — панель не должна тихо
    // подтверждать незнакомый ключ за пользователя.
    // Нет сохранённого секрета — только agent/ключ (BatchMode=yes: быстрый отказ вместо
    // зависания на интерактивном промпте, который здесь некому показать — stdio:'ignore').
    if (!this._secret) args.push('-o', 'BatchMode=yes')
    if (this._privateKeyPath) args.push('-i', this._privateKeyPath)
    const extra = this._extraArgs.trim()
    if (extra) args.push(...extra.split(/\s+/).filter(Boolean))
    args.push(this._target)

    const stderrChunks = []
    // ВАЖНО: с ControlPersist ssh после успешной аутентификации ДЕМОНИЗИРУЕТСЯ — исходный
    // дочерний процесс, который спавнит Node, штатно завершается с кодом 0, а реальный мастер
    // продолжает жить отдельным отсоединённым процессом и держит control-сокет (подтверждено
    // вживую: `ssh -O check` после такого exit видит «Master running»). Поэтому провалом
    // считаем только НЕНУЛЕВОЙ код выхода/ошибку spawn — иначе успешное подключение на каждый
    // раз ошибочно отменяло бы само себя.
    let masterFailed = false
    const child = spawn(this._sshFile, args, { stdio: ['ignore', 'ignore', 'pipe'], env })
    child.stderr.on('data', (chunk) => {
      if (stderrChunks.length < 20) stderrChunks.push(chunk)
    })
    child.on('exit', (code) => { if (code !== 0) masterFailed = true })
    child.on('error', (e) => {
      masterFailed = true
      log.warn('[SshConnectionMaster] master spawn error', this._connectionId, e.message)
    })
    this._masterProcess = child

    const channel = new SshControlChannel({
      sshFile: this._sshFile,
      target: this._target,
      port: this._port,
      controlPath: socket.path,
      controlDir: socket.dir
    })

    const ready = await channel.waitReady({
      maxWaitMs: SSH_SESSION_CONFIG.MASTER_CONNECT_TIMEOUT_MS,
      isCancelled: () => masterFailed
    })

    if (!ready) {
      const stderr = Buffer.concat(stderrChunks).toString('utf-8')
      const reason = classifyMasterFailure(stderr, masterFailed)
      try { child.kill() } catch (e) { /* уже мог завершиться (в т.ч. штатно, ControlPersist) */ }
      channel.dispose()
      this._cleanupAskpass()
      return this._fail(reason)
    }

    this._channel = channel
    this._state = 'ready'
    return { ok: true }
  }

  _fail(reason) {
    this._state = 'failed'
    this._failure = { reason, at: Date.now() }
    this._cleanupAskpass()
    return { ok: false, reason }
  }

  _cleanupAskpass() {
    if (!this._askpassTmpDir) return
    try {
      fs.rmSync(this._askpassTmpDir, { recursive: true, force: true })
    } catch (e) {
      log.warn('[SshConnectionMaster] failed to cleanup askpass tmpDir', this._askpassTmpDir, e.message)
    }
    this._askpassTmpDir = null
  }

  /**
   * @param {string} script
   * @param {string[]} [args]
   * @param {object} [opts]
   * @returns {Promise<{ code: number|null, signal: string|null, stdout: Buffer, stderr: Buffer, timedOut: boolean }>}
   */
  exec(script, args = [], opts = {}) {
    if (!this._channel) return Promise.resolve({ code: null, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), timedOut: false, error: 'not-ready' })
    return this._channel.exec(script, args, opts)
  }

  dispose() {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer)
      this._idleTimer = null
    }
    this._state = 'idle'
    this._refCount = 0
    if (this._channel) {
      this._channel.dispose()
      this._channel = null
    }
    if (this._masterProcess) {
      try { this._masterProcess.kill() } catch (e) { /* уже мог завершиться */ }
      this._masterProcess = null
    }
    this._cleanupAskpass()
  }
}

/**
 * Классифицирует провал поднятия мастера по stderr — для понятного сообщения в панели.
 * @param {boolean} masterFailed — процесс завершился ненулевым кодом/ошибкой spawn (см.
 *   комментарий в `_connect()` — штатный exit 0 от демонизации ControlPersist НЕ провал).
 */
function classifyMasterFailure(stderr, masterFailed) {
  if (/permission denied|publickey|password/i.test(stderr)) return 'auth-required'
  if (/could not resolve|connection refused|connection timed out|no route/i.test(stderr)) return 'unreachable'
  if (!masterFailed) return 'timeout'
  return 'error'
}
