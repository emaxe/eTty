import { spawn } from 'child_process'
import crypto from 'crypto'
import log from 'electron-log'
import { SSH_FS_CONFIG } from '../../shared/ssh-fs-config.js'
import { buildDispatcherScript, encodeRequest, encodeKill, FrameParser } from './ssh-stdio-protocol.js'

const CONNECT_TIMEOUT_MS = 30 * 1000
/** Паузы между попытками переподключения после обрыва (мс), дальше — последнее значение. */
const RECONNECT_BACKOFF_MS = [0, 1000, 3000, 10000]

const EMPTY = () => Buffer.alloc(0)
const failure = (error, extra = {}) => ({ code: null, signal: null, stdout: EMPTY(), stderr: EMPTY(), timedOut: false, error, ...extra })

/** Классификация провала подключения по stderr ssh — для сообщения в панели. */
export function classifyConnectFailure(stderr) {
  if (/permission denied|publickey|password|authentication/i.test(stderr)) return 'auth-required'
  if (/could not resolve|connection refused|connection timed out|no route|timed out/i.test(stderr)) return 'unreachable'
  if (/host key verification failed/i.test(stderr)) return 'host-key'
  return 'error'
}

/**
 * Канал служебных вызовов удалённой ФС поверх ОДНОГО долгоживущего `ssh -T target /bin/sh`.
 * Замена `SshControlChannel` там, где нет ControlMaster (Windows): тот же публичный интерфейс —
 * `exec()`, `isAlive()`, `waitReady()`, `dispose()` — поэтому SshFsProvider, git, tmux-панель и
 * остальные потребители не меняются. Протокол и диспетчер — `ssh-stdio-protocol.js`.
 *
 * Отдельное SSH-соединение (не то, что у вкладки): аутентификация неинтерактивная —
 * ключ/ssh-agent либо сохранённый пароль через SSH_ASKPASS (env передаёт вызывающий).
 */
export class SshStdioChannel {
  /**
   * @param {{ sshFile: string, args: string[], env?: object, target: string,
   *   spawnImpl?: Function, onDispose?: () => void }} params
   *   `args` — опции ssh БЕЗ target и remote-команды (-p, -i, -o ..., extraArgs).
   *   `spawnImpl(sshFile, argv, opts)` — подмена `child_process.spawn` (тесты запускают локальный sh).
   */
  constructor({ sshFile, args, env, target, spawnImpl = spawn, onDispose }) {
    this._sshFile = sshFile
    this._args = args
    this._env = env
    this._target = target
    this._spawn = spawnImpl
    this._onDispose = onDispose

    this._child = null
    this._state = 'idle' // idle | connecting | ready | failed
    this._connecting = null
    this._nextId = 1
    this._pending = new Map() // id → { resolve, timer, maxBuffer }
    this._slots = SSH_FS_CONFIG.MAX_CONCURRENT_EXEC
    this._queue = []
    this._reconnectAttempt = 0
    this._notBefore = 0
    this._disposed = false
    /** Причина последнего провала подключения (`auth-required`, `unreachable`, ...) либо null. */
    this.failureReason = null
  }

  get state() {
    return this._state
  }

  // ── Подключение ──

  /** Single-flight подключение. @returns {Promise<boolean>} */
  _connect() {
    if (this._state === 'ready' && this._child) return Promise.resolve(true)
    if (this._connecting) return this._connecting
    this._connecting = this._doConnect().finally(() => { this._connecting = null })
    return this._connecting
  }

  async _doConnect() {
    if (this._disposed) return false
    const wait = this._notBefore - Date.now()
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
    if (this._disposed) return false

    this._state = 'connecting'
    this.failureReason = null
    const nonce = crypto.randomBytes(8).toString('hex')
    const argv = [
      ...this._args,
      '-T',
      '-o', 'LogLevel=ERROR',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      this._target,
      '/bin/sh'
    ]

    let child
    try {
      child = this._spawn(this._sshFile, argv, { stdio: ['pipe', 'pipe', 'pipe'], env: this._env, windowsHide: true })
    } catch (e) {
      return this._fail('error', e.message)
    }
    this._child = child

    const stderrChunks = []
    child.stderr.on('data', (c) => { if (stderrChunks.length < 20) stderrChunks.push(c) })
    child.stdin.on('error', () => { /* EPIPE при обрыве — обработает exit */ })

    return new Promise((resolve) => {
      let settled = false
      const settle = (ok, reason, detail) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(ok ? true : this._fail(reason, detail))
      }
      const timer = setTimeout(() => {
        try { child.kill() } catch { /* уже завершён */ }
        settle(false, 'timeout')
      }, CONNECT_TIMEOUT_MS)

      const parser = new FrameParser({
        nonce,
        onReady: () => {
          this._state = 'ready'
          this._reconnectAttempt = 0
          settle(true)
        },
        onFrame: (frame) => this._onFrame(frame)
      })
      child.stdout.on('data', (chunk) => parser.feed(chunk))

      child.on('error', (e) => settle(false, 'error', e.message))
      child.on('exit', (code) => {
        const wasReady = this._state === 'ready'
        const stderr = Buffer.concat(stderrChunks).toString('utf-8')
        if (this._child === child) this._child = null
        this._rejectAll(255, wasReady ? 'channel-closed' : 'connect-failed')
        if (wasReady) {
          this._state = 'idle'
          this._scheduleBackoff()
          log.warn('[SshStdioChannel] connection closed', this._target, code, stderr.trim().slice(-200))
        }
        settle(false, classifyConnectFailure(stderr), stderr.trim().slice(-300))
      })

      // Диспетчер — в stdin самого sh; запросы шлём только после READY (см. протокол)
      child.stdin.write(buildDispatcherScript(nonce))
    })
  }

  _fail(reason, detail) {
    this._state = 'failed'
    this.failureReason = reason
    this._scheduleBackoff()
    log.warn('[SshStdioChannel] connect failed', this._target, reason, detail || '')
    return false
  }

  _scheduleBackoff() {
    const delay = RECONNECT_BACKOFF_MS[Math.min(this._reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)]
    this._reconnectAttempt++
    this._notBefore = Date.now() + delay
  }

  /** @returns {Promise<boolean>} true — канал поднят. Ожидание ограничено CONNECT_TIMEOUT_MS внутри. */
  async waitReady({ maxWaitMs = SSH_FS_CONFIG.MASTER_WAIT_MAX_MS, isCancelled } = {}) {
    const deadline = Date.now() + maxWaitMs
    while (Date.now() < deadline) {
      if (this._disposed || isCancelled?.()) return false
      if (await this._connect()) return true
      // Неинтерактивная аутентификация: повторы не помогут (пароль/ключ не появятся сами)
      if (this.failureReason === 'auth-required' || this.failureReason === 'host-key') return false
      if (this._reconnectAttempt >= RECONNECT_BACKOFF_MS.length) return false
    }
    return false
  }

  async isAlive() {
    return this._state === 'ready' && !!this._child
  }

  // ── Запросы ──

  exec(script, args = [], { stdin, timeoutMs = SSH_FS_CONFIG.OP_TIMEOUT_MS, maxBuffer = SSH_FS_CONFIG.MAX_EXEC_BUFFER_BYTES } = {}) {
    if (this._disposed) return Promise.resolve(failure('disposed'))
    return new Promise((resolve) => {
      this._queue.push({ script, args, stdin, timeoutMs, maxBuffer, resolve })
      this._pump()
    })
  }

  async _pump() {
    while (this._slots > 0 && this._queue.length) {
      const job = this._queue.shift()
      this._slots--
      this._run(job).finally(() => {
        this._slots++
        this._pump()
      })
    }
  }

  async _run({ script, args, stdin, timeoutMs, maxBuffer, resolve }) {
    if (this._state !== 'ready' && !(await this._connect())) {
      resolve(failure(this.failureReason || 'not-ready', { code: 255 }))
      return
    }
    const child = this._child
    if (!child) {
      resolve(failure('not-ready', { code: 255 }))
      return
    }
    const id = String(this._nextId++)
    await new Promise((done) => {
      const timer = setTimeout(() => {
        this._pending.delete(id)
        try { child.stdin.write(encodeKill(id)) } catch { /* канал уже закрыт */ }
        resolve(failure(null, { timedOut: true, error: undefined }))
        done()
      }, timeoutMs)
      this._pending.set(id, {
        maxBuffer,
        finish: (result) => {
          clearTimeout(timer)
          resolve(result)
          done()
        }
      })
      try {
        child.stdin.write(encodeRequest({ id, script, args, stdin }))
      } catch (e) {
        this._pending.delete(id)
        clearTimeout(timer)
        resolve(failure(e.message, { code: 255 }))
        done()
      }
    })
  }

  _onFrame({ id, code, stdout, stderr }) {
    const entry = this._pending.get(id)
    if (!entry) return // уже истёк по таймауту
    this._pending.delete(id)
    entry.finish({
      code,
      signal: null,
      stdout: stdout.length > entry.maxBuffer ? stdout.subarray(0, entry.maxBuffer) : stdout,
      stderr: stderr.length > entry.maxBuffer ? stderr.subarray(0, entry.maxBuffer) : stderr,
      timedOut: false
    })
  }

  _rejectAll(code, error) {
    for (const [id, entry] of this._pending) {
      this._pending.delete(id)
      entry.finish(failure(error, { code }))
    }
  }

  dispose() {
    if (this._disposed) return
    this._disposed = true
    this._state = 'idle'
    for (const job of this._queue.splice(0)) job.resolve(failure('disposed'))
    this._rejectAll(null, 'disposed')
    const child = this._child
    this._child = null
    if (child) {
      try { child.stdin.end() } catch { /* закрыт */ }
      try { child.kill() } catch { /* уже завершён */ }
    }
    this._onDispose?.()
  }
}
