import { execFile } from 'child_process'
import { promisify } from 'util'
import log from 'electron-log'
import { SSH_FS_CONFIG } from '../../shared/ssh-fs-config.js'
import { execProgram } from '../exec-utils.js'
import { findExecutable, getPathValue } from '../env-utils.js'
import {
  stripTerminalEscapes,
  parseNvmList,
  parseNvmRemote,
  parseFnmList,
  parseFnmRemote,
  parseAsdfList,
  parseAsdfRemote,
  parseNvmWindowsList,
  parseNvmWindowsRemote,
  parseVoltaList,
  versionFromNodePath,
  validateVersion,
} from './node-version-parse.js'

const execFileAsync = promisify(execFile)
const COMMAND_TIMEOUT_MS = 15000
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000
const DETECT_CACHE_MS = 60 * 1000
const NVM_INSTALL_URL = 'https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh'

const MANAGERS = Object.freeze({
  NVM: 'nvm',
  FNM: 'fnm',
  ASDF: 'asdf',
  VOLTA: 'volta',
})

/**
 * Windows (локальные вкладки): менеджеры — исполняемые файлы, а не shell-функции, поэтому команды
 * запускаются напрямую (без shell и без NVM_PRELUDE), аргументы — массивом. Порядок = приоритет детекта.
 * nvm здесь — nvm-windows (`nvm.exe`); volta не умеет listRemote и uninstall отдельной версии.
 */
const WIN_MANAGERS = Object.freeze([
  { id: MANAGERS.FNM, bin: 'fnm', version: ['--version'], list: ['list'], remote: ['list-remote'], parseList: parseFnmList, parseRemote: parseFnmRemote, install: v => ['install', v], uninstall: v => ['uninstall', v] },
  { id: MANAGERS.NVM, bin: 'nvm', version: ['version'], list: ['list'], remote: ['list', 'available'], parseList: parseNvmWindowsList, parseRemote: parseNvmWindowsRemote, install: v => ['install', v], uninstall: v => ['uninstall', v] },
  { id: MANAGERS.VOLTA, bin: 'volta', version: ['--version'], list: ['list', 'node', '--format', 'plain'], remote: null, parseList: parseVoltaList, parseRemote: null, install: v => ['install', `node@${v}`], uninstall: null },
])

/**
 * nvm — shell-функция: в интерактивном шелле она уже есть (если .zshrc/.bashrc её загружает),
 * иначе пробуем типовые расположения nvm.sh, включая Homebrew. NVM_DIR раскрывает сам шелл —
 * process.env у Electron при запуске из Finder пуст.
 */
const NVM_PRELUDE =
  'if ! command -v nvm >/dev/null 2>&1; then ' +
  'for f in "${NVM_DIR:-$HOME/.nvm}/nvm.sh" /opt/homebrew/opt/nvm/nvm.sh /usr/local/opt/nvm/nvm.sh; do ' +
  '[ -s "$f" ] && . "$f" && break; done; fi'

/** Печатает имя менеджера и его версию (две строки) либо ничего. */
const DETECT_SCRIPT = [
  NVM_PRELUDE,
  'if command -v nvm >/dev/null 2>&1; then echo nvm; nvm --version',
  'elif command -v fnm >/dev/null 2>&1; then echo fnm; fnm --version',
  'elif command -v asdf >/dev/null 2>&1; then echo asdf; asdf --version',
  'fi'
].join('; ')

function isUnix() {
  return process.platform !== 'win32'
}

/**
 * Универсальный менеджер версий Node.js (nvm, fnm, asdf).
 * Команды выполняются в login+interactive шелле — локальном или удалённом (по SSH-каналу вкладки),
 * в зависимости от `ctx` (`{kind:'ssh', sessionId}` | undefined). Переключение версии
 * в терминале вкладки делает renderer (команда в PTY), здесь только запросы и установка.
 */
export class NodeVersionManager {
  /**
   * @param {{ shellPathResolver: import('../shell-path-resolver.js').ShellPathResolver,
   *   sshSessionRegistry?: import('../ssh/ssh-session-registry.js').SshSessionRegistry }} deps
   */
  constructor({ shellPathResolver, sshSessionRegistry = null }) {
    this._resolver = shellPathResolver
    this._sshSessionRegistry = sshSessionRegistry
    /** @type {Map<string, {at: number, promise: Promise<object>}>} */
    this._detectCache = new Map()
  }

  // ── Detection ──

  /**
   * Определяет доступный менеджер версий. Результат кэшируется на минуту по контексту
   * (каждое обращение — запуск интерактивного шелла с загрузкой rc-файлов).
   * @returns {Promise<{manager: 'nvm'|'fnm'|'asdf'|null, version: string|null}>}
   */
  detectManager(ctx) {
    const key = this._ctxKey(ctx)
    const cached = this._detectCache.get(key)
    if (cached && Date.now() - cached.at < DETECT_CACHE_MS) return cached.promise

    const promise = this._detectManager(ctx)
    this._detectCache.set(key, { at: Date.now(), promise })
    // Не кэшируем сбои/«не найден» дольше обычного — но и не дёргаем шелл параллельно
    promise.catch(() => this._detectCache.delete(key))
    return promise
  }

  /** Локальная вкладка на Windows: менеджеры ищутся по PATH, команды запускаются без shell. */
  _isWinLocal(ctx) {
    return !isUnix() && ctx?.kind !== 'ssh'
  }

  _winManager(id) {
    return WIN_MANAGERS.find(m => m.id === id)
  }

  async _winRun(manager, args, timeoutMs = COMMAND_TIMEOUT_MS) {
    const resolvedPath = await this._resolver.resolve()
    const { stdout, stderr } = await execProgram(manager.bin, args, { resolvedPath, timeout: timeoutMs })
    return { stdout: stripTerminalEscapes(stdout), stderr }
  }

  async _detectManagerWin() {
    const resolvedPath = (await this._resolver.resolve()) || getPathValue(process.env)
    for (const manager of WIN_MANAGERS) {
      if (!findExecutable(manager.bin, resolvedPath)) continue
      let version = null
      try {
        const { stdout } = await this._winRun(manager, manager.version)
        version = stdout.split(/\r?\n/).map(l => l.trim()).find(Boolean)?.match(/\d+\.\d+(?:\.\d+)?/)?.[0] || null
      } catch (e) {
        log.warn(`[NodeVersionManager] ${manager.bin} version check failed:`, e.message)
      }
      log.info(`[NodeVersionManager] Detected ${manager.id} ${version || ''} (local, win32)`)
      return { manager: manager.id, version }
    }
    return { manager: null, version: null }
  }

  async _detectManager(ctx) {
    if (this._isWinLocal(ctx)) return this._detectManagerWin()
    try {
      const { stdout } = await this._exec(ctx, DETECT_SCRIPT)
      const [manager, version] = stripTerminalEscapes(stdout).split('\n').map(l => l.trim()).filter(Boolean)
      if (Object.values(MANAGERS).includes(manager)) {
        log.info(`[NodeVersionManager] Detected ${manager} ${version || ''} (${this._ctxKey(ctx)})`)
        return { manager, version: version || null }
      }
    } catch (e) {
      log.warn('[NodeVersionManager] detectManager failed:', e.message)
    }
    return { manager: null, version: null }
  }

  /**
   * Версия node по абсолютному пути к бинарю (приходит из OSC 6973 шелла вкладки).
   * Типовые менеджеры (nvm/fnm/asdf/volta image) определяются по пути без запуска процесса,
   * для shim'ов и системных установок спрашивается сам бинарь.
   * @returns {Promise<{version: string, source: 'path'|'binary'}|null>}
   */
  async resolveNodePath(nodePath, ctx) {
    const isAbsolute = typeof nodePath === 'string'
      && (nodePath.startsWith('/') || (this._isWinLocal(ctx) && /^[A-Za-z]:[\\/]/.test(nodePath)))
    if (!isAbsolute) return null
    const fromPath = versionFromNodePath(nodePath)
    if (fromPath) return { version: fromPath, source: 'path' }
    try {
      const { stdout } = this._isWinLocal(ctx)
        ? await execFileAsync(nodePath, ['--version'], { timeout: COMMAND_TIMEOUT_MS, windowsHide: true })
        : await this._exec(ctx, '"$1" --version', [nodePath], { interactive: false })
      const m = stripTerminalEscapes(stdout).trim().match(/^v?(\d+\.\d+\.\d+)/)
      return m ? { version: m[1], source: 'binary' } : null
    } catch (e) {
      log.warn('[NodeVersionManager] resolveNodePath failed:', e.message)
      return null
    }
  }

  // ── Queries ──

  async listInstalled(ctx) {
    const { manager } = await this.detectManager(ctx)
    if (!manager) return { manager: null, versions: [] }

    if (this._isWinLocal(ctx)) {
      const m = this._winManager(manager)
      try {
        const { stdout } = await this._winRun(m, m.list)
        return { manager, versions: m.parseList(stdout) }
      } catch (e) {
        log.warn(`[NodeVersionManager] Failed to list installed versions (${manager}):`, e.message)
        return { manager, versions: [] }
      }
    }

    try {
      switch (manager) {
        case MANAGERS.NVM: {
          const { stdout } = await this._exec(ctx, `${NVM_PRELUDE}; nvm ls --no-colors`)
          return { manager, versions: parseNvmList(stdout) }
        }
        case MANAGERS.FNM: {
          const { stdout } = await this._exec(ctx, 'fnm list')
          return { manager, versions: parseFnmList(stdout) }
        }
        case MANAGERS.ASDF: {
          const { stdout } = await this._exec(ctx, 'asdf list nodejs')
          return { manager, versions: parseAsdfList(stdout) }
        }
      }
    } catch (e) {
      log.warn(`[NodeVersionManager] Failed to list installed versions (${manager}):`, e.message)
    }
    return { manager, versions: [] }
  }

  async listRemote(ctx) {
    const { manager } = await this.detectManager(ctx)
    if (!manager) return { manager: null, versions: [] }

    if (this._isWinLocal(ctx)) {
      const m = this._winManager(manager)
      if (!m.remote) return { manager, versions: [] }
      try {
        const { stdout } = await this._winRun(m, m.remote, 60000)
        return { manager, versions: m.parseRemote(stdout) }
      } catch (e) {
        log.warn(`[NodeVersionManager] Failed to list remote versions (${manager}):`, e.message)
        return { manager, versions: [] }
      }
    }

    try {
      switch (manager) {
        case MANAGERS.NVM: {
          const { stdout } = await this._exec(ctx, `${NVM_PRELUDE}; nvm ls-remote --no-colors`, [], { timeoutMs: 60000 })
          return { manager, versions: parseNvmRemote(stdout) }
        }
        case MANAGERS.FNM: {
          const { stdout } = await this._exec(ctx, 'fnm list-remote', [], { timeoutMs: 60000 })
          return { manager, versions: parseFnmRemote(stdout) }
        }
        case MANAGERS.ASDF: {
          const { stdout } = await this._exec(ctx, 'asdf list-all nodejs', [], { timeoutMs: 60000 })
          return { manager, versions: parseAsdfRemote(stdout) }
        }
      }
    } catch (e) {
      log.warn(`[NodeVersionManager] Failed to list remote versions (${manager}):`, e.message)
    }
    return { manager, versions: [] }
  }

  // ── Mutations ──

  async install(version, ctx) {
    return this._versionCommand('install', version, ctx)
  }

  async uninstall(version, ctx) {
    return this._versionCommand('uninstall', version, ctx)
  }

  /** `install`/`uninstall` выбранной версии; версия передаётся позиционным аргументом, не в строке команды. */
  async _versionCommand(action, version, ctx) {
    const v = validateVersion(version)
    const { manager } = await this.detectManager(ctx)
    if (!manager) throw new Error('No node version manager found')

    if (this._isWinLocal(ctx)) {
      const m = this._winManager(manager)
      const buildArgs = m[action]
      if (!buildArgs) throw new Error(`${m.bin} does not support "${action}" for a single Node version`)
      try {
        await this._winRun(m, buildArgs(v), INSTALL_TIMEOUT_MS)
        return { success: true, manager, version: v }
      } catch (e) {
        log.warn(`[NodeVersionManager] Failed to ${action} ${v} (${manager}):`, e.message)
        throw e
      }
    }

    const script = {
      [MANAGERS.NVM]: `${NVM_PRELUDE}; nvm ${action} "$1"`,
      [MANAGERS.FNM]: `fnm ${action} "$1"`,
      [MANAGERS.ASDF]: `asdf ${action} nodejs "$1"`,
    }[manager]

    try {
      await this._exec(ctx, script, [v], { timeoutMs: INSTALL_TIMEOUT_MS })
      return { success: true, manager, version: v }
    } catch (e) {
      log.warn(`[NodeVersionManager] Failed to ${action} ${v} (${manager}):`, e.message)
      throw e
    }
  }

  /** Автоустановка nvm (только локально). */
  async installManager(ctx) {
    if (ctx?.kind === 'ssh') {
      throw new Error('Automatic nvm installation is only supported for local tabs. Install nvm on the server manually.')
    }
    if (!isUnix()) {
      throw new Error('Automatic installation is only supported on Unix-like systems. On Windows install fnm (winget install Schniz.fnm) or nvm-windows (https://github.com/coreybutler/nvm-windows) manually.')
    }

    try {
      const { stdout, stderr } = await this._exec(undefined, `curl -o- ${NVM_INSTALL_URL} | bash`, [], { timeoutMs: INSTALL_TIMEOUT_MS })
      this._detectCache.clear()
      // invalidate() обнуляет кэш PATH — сразу пересобираем, иначе последующие вызовы остались бы без PATH
      this._resolver.invalidate()
      await this._resolver.resolve()
      return { success: true, output: stdout + stderr }
    } catch (e) {
      log.warn('[NodeVersionManager] Failed to install nvm:', e.message)
      throw e
    }
  }

  // ── Private helpers ──

  _ctxKey(ctx) {
    return ctx?.kind === 'ssh' ? `ssh:${ctx.sessionId}` : 'local'
  }

  /**
   * Выполняет `script` в login-шелле: локально (`$SHELL`) или на удалённом хосте через
   * SSH-канал вкладки. Аргументы доступны скрипту как `$1..` (не интерполируются в строку).
   * @returns {Promise<{stdout: string, stderr: string}>}
   */
  async _exec(ctx, script, args = [], { timeoutMs = COMMAND_TIMEOUT_MS, interactive = true } = {}) {
    if (ctx?.kind === 'ssh') return this._execRemote(ctx, script, args, timeoutMs, interactive)

    const resolvedPath = await this._resolver.resolve()
    const env = { ...process.env, PATH: resolvedPath || process.env.PATH }
    const shell = isUnix() ? (process.env.SHELL || this._resolver.getDefaultShell()) : (process.env.ComSpec || 'cmd.exe')
    const shellArgs = isUnix()
      ? ['-l', ...(interactive ? ['-i'] : []), '-c', script, 'etty', ...args]
      : ['/c', script]
    const { stdout, stderr } = await execFileAsync(shell, shellArgs, {
      timeout: timeoutMs,
      env,
      cwd: process.env.HOME,
    })
    return { stdout: stripTerminalEscapes(stdout), stderr }
  }

  async _execRemote(ctx, script, args, timeoutMs, interactive) {
    const session = this._sshSessionRegistry?.get(ctx.sessionId)
    if (!session?.fsProvider) throw new Error('SSH session is not ready')

    // login(+interactive) шелл пользователя: nvm/fnm обычно подключаются в .bashrc/.zshrc
    const wrapper = interactive
      ? 'exec "${SHELL:-/bin/sh}" -l -i -c "$@"'
      : 'exec "${SHELL:-/bin/sh}" -l -c "$@"'
    const result = await session.channel.exec(wrapper, [script, 'etty', ...args], {
      timeoutMs: Math.max(timeoutMs, SSH_FS_CONFIG.OP_TIMEOUT_MS),
    })
    if (result.error) throw new Error(result.error)
    if (result.timedOut) throw new Error('timeout')
    const stdout = stripTerminalEscapes(result.stdout.toString('utf-8'))
    const stderr = result.stderr.toString('utf-8')
    if (result.code !== 0) throw new Error(stderr.trim() || `exit code ${result.code}`)
    return { stdout, stderr }
  }
}
