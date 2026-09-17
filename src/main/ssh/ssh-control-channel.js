import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import log from 'electron-log'
import { SSH_FS_CONFIG } from '../../shared/ssh-fs-config.js'

const IS_WIN = process.platform === 'win32'
// sun_path — 104 байта на macOS/BSD, 108 на Linux; берём меньший лимит с запасом на случай
// более длинного userData/tmp-префикса на других системах.
const MAX_SOCKET_PATH = 90

/**
 * КРИТИЧНО для exec(): в отличие от локального spawn() (execve с argv-массивом, где элементы
 * изолированы всегда), OpenSSH-клиент, получив НЕСКОЛЬКО позиционных аргументов после target,
 * склеивает их ПРОБЕЛОМ в ОДНУ строку и отправляет её на sshd как единую remote-команду —
 * т.е. `spawn('ssh', [..., target, '/bin/sh', '-c', script, 'etty', ...args])` на удалённой
 * стороне превращается в `<login-shell> -c "/bin/sh -c <script БЕЗ КАВЫЧЕК> etty <args>"`, и
 * содержащиеся в script пробелы/`;` становятся обычным (ломающим) синтаксисом внешнего -c —
 * подтверждено вживую (см. Этап 4 тесты). Поэтому каждый токен ОБЯЗАН быть индивидуально
 * POSIX-quoted (та же `'...'`→`'\''`-схема, что и в remote-shell-hooks.js) ПЕРЕД тем, как
 * попасть в argv локального spawn() — тогда после склейки пробелом внешний login-shell
 * (какой бы он ни был — sh/bash/zsh/fish/csh) восстановит каждый токен как единое слово.
 */
function posixQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

/**
 * Создаёт уникальный каталог под control-сокет ControlMaster. НЕ в userData (там путь может
 * быть слишком длинным — `~/Library/Application Support/eTty` уже съедает часть лимита
 * sun_path), а в os.tmpdir(), с фолбэком на `/tmp` при переполнении лимита длины.
 * @returns {{ dir: string, path: string } | null} null — на этой платформе/машине ControlMaster
 *   технически недоступен (Windows, либо путь всё равно не влезает).
 */
export function createControlSocket() {
  if (IS_WIN) return null

  const tryDir = (base) => {
    const dir = fs.mkdtempSync(path.join(base, 'etty-cm-'))
    const socketPath = path.join(dir, 's')
    if (socketPath.length > MAX_SOCKET_PATH) {
      fs.rmSync(dir, { recursive: true, force: true })
      return null
    }
    return { dir, path: socketPath }
  }

  try {
    const primary = tryDir(os.tmpdir())
    if (primary) return primary
  } catch (e) {
    log.warn('ssh-control-channel: failed to create control socket in tmpdir', e.message)
  }
  try {
    const fallback = tryDir('/tmp')
    if (fallback) return fallback
  } catch (e) {
    log.warn('ssh-control-channel: failed to create control socket in /tmp', e.message)
  }
  return null
}

/** Простой семафор — ограничивает число параллельных служебных ssh-вызовов по каналу. */
class Semaphore {
  constructor(max) {
    this._max = max
    this._active = 0
    this._queue = []
  }

  async run(fn) {
    if (this._active >= this._max) {
      await new Promise((resolve) => this._queue.push(resolve))
    }
    this._active++
    try {
      return await fn()
    } finally {
      this._active--
      const next = this._queue.shift()
      if (next) next()
    }
  }
}

/**
 * Канал служебных вызовов `ssh` к уже установленному ControlMaster-соединению SSH-вкладки:
 * `-O check`/`-O exit` для жизненного цикла мастера и `exec()` — короткоживущие non-interactive
 * вызовы (`ssh ... user@host /bin/sh -c <script> etty <args...>`) для операций удалённой ФС
 * (Этап 4). НЕ управляет самим интерактивным PTY-соединением (см. `pty-manager.js`) — только
 * параллельный служебный канал поверх того же мультиплексированного сокета.
 */
export class SshControlChannel {
  /**
   * @param {{ sshFile: string, target: string, port: number, controlPath: string, controlDir: string }} params
   *   `target` — `user@host`. `controlPath`/`controlDir` — из `createControlSocket()`; канал
   *   владеет полным жизненным циклом каталога сокета (см. `dispose()`).
   */
  constructor({ sshFile, target, port, controlPath, controlDir }) {
    this._sshFile = sshFile
    this._target = target
    this._port = port
    this._controlPath = controlPath
    this._controlDir = controlDir
    this._semaphore = new Semaphore(SSH_FS_CONFIG.MAX_CONCURRENT_EXEC)
    this._aliveCache = { value: null, checkedAt: 0 }
    this._disposed = false
  }

  _serviceArgs() {
    return [
      '-o', 'BatchMode=yes',
      '-o', 'ControlMaster=no',
      '-o', `ControlPath=${this._controlPath}`,
      '-o', 'ConnectTimeout=5',
      '-o', 'LogLevel=ERROR',
      '-p', String(this._port)
    ]
  }

  /** `ssh -O check` — true, если мастер жив. Кэш на SSH_FS_CONFIG.MASTER_ALIVE_CACHE_MS. */
  async isAlive() {
    const now = Date.now()
    if (this._aliveCache.value !== null && now - this._aliveCache.checkedAt < SSH_FS_CONFIG.MASTER_ALIVE_CACHE_MS) {
      return this._aliveCache.value
    }
    const alive = await this._checkOnce()
    this._aliveCache = { value: alive, checkedAt: Date.now() }
    return alive
  }

  _checkOnce() {
    return new Promise((resolve) => {
      const child = spawn(this._sshFile, [...this._serviceArgs(), '-O', 'check', this._target], { stdio: 'ignore' })
      child.on('error', () => resolve(false))
      child.on('exit', (code) => resolve(code === 0))
    })
  }

  /** Инвалидирует кэш isAlive() — вызывать после exec(), вернувшего код 255 (соединение оборвалось). */
  _invalidateAliveCache() {
    this._aliveCache = { value: null, checkedAt: 0 }
  }

  /**
   * Опрашивает `-O check` до появления мастера. Пользователь может долго вводить пароль/2FA —
   * жёсткого таймаута в разумных пределах нет, только предохранитель на maxWaitMs.
   * @param {{ maxWaitMs?: number, isCancelled?: () => boolean }} [opts]
   */
  async waitReady({ maxWaitMs = SSH_FS_CONFIG.MASTER_WAIT_MAX_MS, isCancelled } = {}) {
    if (IS_WIN) return false
    const deadline = Date.now() + maxWaitMs
    while (Date.now() < deadline) {
      if (isCancelled?.()) return false
      if (await this._checkOnce()) {
        this._aliveCache = { value: true, checkedAt: Date.now() }
        return true
      }
      await new Promise((r) => setTimeout(r, SSH_FS_CONFIG.MASTER_CHECK_INTERVAL_MS))
    }
    return false
  }

  /**
   * Короткоживущий non-interactive вызов по мультиплексированному соединению:
   * `ssh <serviceOpts> target /bin/sh -c <script> etty <arg1> <arg2> ...`. Каждый токен
   * POSIX-quoted перед spawn() — см. `posixQuote()` выше: OpenSSH-клиент склеивает позиционные
   * аргументы после target пробелом в единую remote-команду, поэтому непрозрачность каждого
   * токена для внешнего login-shell приходится обеспечивать вручную.
   * @param {string} script
   * @param {string[]} [args]
   * @param {{ stdin?: Buffer|string, timeoutMs?: number, maxBuffer?: number }} [opts]
   * @returns {Promise<{ code: number|null, signal: string|null, stdout: Buffer, stderr: Buffer, timedOut: boolean }>}
   */
  exec(script, args = [], { stdin, timeoutMs = SSH_FS_CONFIG.OP_TIMEOUT_MS, maxBuffer = SSH_FS_CONFIG.MAX_EXEC_BUFFER_BYTES } = {}) {
    if (this._disposed) return Promise.resolve({ code: null, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), timedOut: false, error: 'disposed' })
    return this._semaphore.run(() => this._execOnce(script, args, { stdin, timeoutMs, maxBuffer }))
  }

  _execOnce(script, args, { stdin, timeoutMs, maxBuffer }) {
    return new Promise((resolve) => {
      // Только то, что идёт ПОСЛЕ target (= remote-команда), квотится — _serviceArgs()/target
      // потребляются локальным ssh-клиентом и квотировка их сломала бы (это его CLI-опции,
      // а не то, что уходит на удалённую сторону).
      const remoteCommandTokens = ['/bin/sh', '-c', script, 'etty', ...args].map(posixQuote)
      const argv = [...this._serviceArgs(), this._target, ...remoteCommandTokens]
      const child = spawn(this._sshFile, argv, { stdio: ['pipe', 'pipe', 'pipe'] })

      const stdoutChunks = []
      const stderrChunks = []
      let stdoutLen = 0
      let stderrLen = 0
      let timedOut = false
      let settled = false

      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, timeoutMs)

      const finish = (result) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      }

      child.on('error', (e) => {
        finish({ code: null, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), timedOut, error: e.message })
      })

      child.stdout.on('data', (chunk) => {
        if (stdoutLen >= maxBuffer) return
        stdoutChunks.push(chunk)
        stdoutLen += chunk.length
      })
      child.stderr.on('data', (chunk) => {
        if (stderrLen >= maxBuffer) return
        stderrChunks.push(chunk)
        stderrLen += chunk.length
      })

      if (stdin !== undefined) {
        child.stdin.on('error', () => { /* EPIPE при досрочном завершении удалённой команды — ожидаемо */ })
        child.stdin.end(stdin)
      } else {
        child.stdin.end()
      }

      child.on('exit', (code, signal) => {
        if (code === 255) this._invalidateAliveCache()
        finish({
          code,
          signal,
          stdout: Buffer.concat(stdoutChunks),
          stderr: Buffer.concat(stderrChunks),
          timedOut
        })
      })
    })
  }

  /**
   * `ssh -O exit` гасит мастер (после ControlPersist это единственный способ закрыть его
   * раньше таймаута), затем удаляет каталог сокета. Полностью fire-and-forget — вызывающий
   * код (PtyManager) не ждёт этого при закрытии вкладки. Удаление каталога — ПОСЛЕ попытки
   * `-O exit` (а не сразу): иначе рискуем стереть сокет раньше, чем `-O exit` успеет по нему
   * подключиться, и he закрыть мастер немедленно (сам он всё равно умрёт по ControlPersist=10,
   * но лучше не полагаться на таймаут без необходимости).
   */
  dispose() {
    if (this._disposed) return
    this._disposed = true
    let cleaned = false
    const cleanupDir = () => {
      if (cleaned || !this._controlDir) return
      cleaned = true
      try {
        fs.rmSync(this._controlDir, { recursive: true, force: true })
      } catch (e) {
        log.warn('ssh-control-channel: failed to cleanup controlDir', this._controlDir, e.message)
      }
    }
    if (IS_WIN) {
      cleanupDir()
      return
    }
    try {
      const child = spawn(this._sshFile, [...this._serviceArgs(), '-O', 'exit', this._target], { stdio: 'ignore' })
      child.on('exit', cleanupDir)
      child.on('error', cleanupDir)
      // Предохранитель — если событие exit/error почему-то не придёт
      setTimeout(cleanupDir, 3000).unref?.()
    } catch (e) {
      log.warn('ssh-control-channel: failed to spawn -O exit', e.message)
      cleanupDir()
    }
  }
}
