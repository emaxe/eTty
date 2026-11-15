import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import os from 'os'
import path from 'path'
import log from 'electron-log'

const execFileAsync = promisify(execFile)

const IS_WIN = process.platform === 'win32'

export function getCommonUserBinDirs(home = os.homedir(), platform = process.platform) {
  if (platform === 'win32') {
    return [
      path.win32.join(home, '.opencode', 'bin'),
      path.win32.join(home, '.local', 'bin'),
      path.win32.join(home, '.bun', 'bin'),
      path.win32.join(home, '.deno', 'bin'),
      path.win32.join(home, '.cargo', 'bin'),
      path.win32.join(home, '.volta', 'bin'),
      path.win32.join(home, 'go', 'bin')
    ]
  }
  return [
    path.posix.join(home, '.opencode', 'bin'),
    path.posix.join(home, '.local', 'bin'),
    path.posix.join(home, '.bun', 'bin'),
    path.posix.join(home, '.deno', 'bin'),
    path.posix.join(home, '.cargo', 'bin'),
    path.posix.join(home, '.volta', 'bin'),
    path.posix.join(home, '.asdf', 'shims'),
    path.posix.join(home, 'go', 'bin'),
    path.posix.join(home, 'Library', 'pnpm'),
    path.posix.join(home, '.local', 'share', 'pnpm'),
    path.posix.join(home, '.local', 'share', 'fnm'),
    path.posix.join(home, '.amp', 'bin'),
    path.posix.join(home, '.cursor', 'bin'),
    path.posix.join(home, '.atuin', 'bin'),
    path.posix.join(home, '.fly', 'bin'),
    path.posix.join(home, '.fzf', 'bin'),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin'
  ]
}

/**
 * Извлекает директории PATH из shell-профилей (~/.bashrc, ~/.bash_profile, ~/.profile, ~/.zshrc, ~/.zprofile, ~/.zshenv).
 * Позволяет автоматически подхватывать пакеты, установленные через `curl ... | bash` или `curl ... | sh`,
 * когда инсталлятор прописал export PATH в ~/.bashrc или ~/.bash_profile вместо ~/.zshrc.
 * @param {string} [home]
 * @param {{ exists?: (p: string) => boolean, readFile?: (p: string) => string }} [opts]
 * @returns {string[]}
 */
export function extractPathDirsFromShellProfiles(home = os.homedir(), {
  exists = (p) => {
    try { return fs.statSync(p).isDirectory() } catch { return false }
  },
  readFile = (p) => fs.readFileSync(p, 'utf-8')
} = {}) {
  const rcFiles = [
    '.zshenv',
    '.zprofile',
    '.zshrc',
    '.bash_profile',
    '.bashrc',
    '.profile'
  ]
  const found = []
  const seen = new Set()

  const addCandidate = (rawToken) => {
    if (!rawToken) return
    const expanded = rawToken
      .replace(/^\$\{HOME\}(?=\/)/, home)
      .replace(/^\$HOME(?=\/)/, home)
      .replace(/^~(?=\/)/, home)
    if (!expanded.startsWith('/')) return
    if (expanded.includes('$') || expanded.includes('`') || expanded.includes('*')) return
    if (seen.has(expanded)) return
    seen.add(expanded)
    if (exists(expanded)) {
      found.push(expanded)
    }
  }

  for (const rc of rcFiles) {
    const filePath = path.posix.join(home, rc)
    let content = ''
    try {
      content = readFile(filePath)
    } catch {
      continue
    }
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      if (!/\bPATH\b|\bpath\b/.test(line)) continue
      const tokens = line.match(/(?:\$\{HOME\}|\$HOME|~)?\/[A-Za-z0-9._/@-]+/g) || []
      for (const token of tokens) {
        addCandidate(token)
      }
    }
  }

  return found
}

const FALLBACK_PATHS = IS_WIN
  ? [
      'C:\\Windows\\System32',
      'C:\\Windows',
      'C:\\Windows\\System32\\Wbem',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0',
      'C:\\Program Files\\PowerShell\\7',
      ...getCommonUserBinDirs()
    ]
  : [
      ...getCommonUserBinDirs(),
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin'
    ]

const SHELL = IS_WIN ? (process.env.ComSpec || 'cmd.exe') : '/bin/zsh'
// NVM and other version managers can take several seconds in a cold login shell.
const TIMEOUT_MS = 10000
const DELIMITER = '_SHELL_PATH_DELIMITER_'

function isUnix() {
  return process.platform !== 'win32'
}

/**
 * Резолвит настоящий пользовательский PATH, запуская zsh как login + interactive shell.
 * Кэширует результат в памяти. Используется при спавне PTY и детекте CLI агентов.
 *
 * Защита от случайного вывода из .zshrc:
 *   — PATH обёрнут в DELIMITER, извлекается из stdout по маркерам.
 */
export class ShellPathResolver {
  constructor({ execFile = execFileAsync, env = process.env } = {}) {
    this._execFile = execFile
    this._env = env
    this._resolvedPath = null
    this._promise = null
    this._stale = false
  }

  /**
   * Возвращает единый resolved PATH.
   * Пока кэш свежий, shell не запускается; параллельные вызовы ждут одну проверку.
   */
  async resolve() {
    if (this._resolvedPath !== null && !this._stale) {
      return this._resolvedPath
    }
    return this._resolveShared()
  }

  /**
   * Принудительно перепроверяет PATH (например, после установки агента или nvm).
   * Прошлый удачный PATH сохраняется, если новая проверка не удалась.
   */
  async refresh() {
    return this._resolveShared()
  }

  async _resolveShared() {
    if (this._promise !== null) {
      return this._promise
    }
    const promise = this._doResolve()
    this._promise = promise
    this._stale = false
    try {
      const resolved = await promise
      this._resolvedPath = resolved
      return resolved
    } finally {
      // Отклонённая проверка не должна навсегда остаться в _promise.
      if (this._promise === promise) this._promise = null
    }
  }

  /**
   * Синхронный доступ к последнему удачному PATH.
   * Возвращает null, пока ни одна проверка не завершилась.
   */
  getResolvedPath() {
    return this._resolvedPath
  }

  /**
   * Помечает PATH устаревшим, сохраняя последний удачный для синхронных вызовов.
   * Следующий resolve() перечитает PATH.
   */
  invalidate() {
    this._stale = true
  }

  /**
   * Возвращает shell по умолчанию для текущей платформы.
   * @returns {string}
   */
  getDefaultShell() {
    return SHELL
  }

  async _doResolve() {
    try {
      const probed = await this._probeShellPath()
      if (probed) return probed
    } catch (err) {
      log.warn('[ShellPathResolver] Unexpected probe failure:', err.message)
    }

    // Неудачная перепроверка не должна ухудшать уже найденный рабочий PATH.
    return this._resolvedPath ?? this._buildFallbackPath()
  }

  /** PATH из полного маркированного вывода shell или null, если получить его не удалось. */
  async _probeShellPath() {
    // На Windows zsh отсутствует — сразу fallback
    if (!isUnix()) return null

    // Уникальный маркер, чтобы избежать коллизий, если PATH уже содержит старый DELIMITER
    const delimiter = `${DELIMITER}_${Date.now()}_${Math.random().toString(36).slice(2)}_`
    // Разделяем маркер и $PATH отдельными аргументами, иначе zsh склеивает
    // $PATH и маркер в одно имя переменной (например $PATH_SHELL_PATH_DELIMITER_...)
    const script = `printf '%s%s%s' '${delimiter}' "\${PATH}" '${delimiter}'`

    const env = { ...this._env }
    // An inherited eTty wrapper (including one already deleted) must not replace user rc files.
    // Preserve custom ZDOTDIR outside our temporary directories.
    const normalizeTempPath = (value) => path.resolve(value).replace(/^\/private(?=\/var\/)/, '')
    if (env.ZDOTDIR && /^etty-[A-Za-z0-9]{6}$/.test(path.basename(env.ZDOTDIR)) &&
        normalizeTempPath(path.dirname(env.ZDOTDIR)) === normalizeTempPath(os.tmpdir())) {
      const original = env.ETTY_ORIG_ZDOTDIR || env.ETTY_USER_ZDOTDIR
      if (original) env.ZDOTDIR = original
      else delete env.ZDOTDIR
      delete env.ETTY_ORIG_ZDOTDIR
      delete env.ETTY_USER_ZDOTDIR
    }

    let stdout = ''
    const startedAt = Date.now()
    try {
      const result = await this._execFile(
        SHELL,
        ['-l', '-i', '-c', script],
        { timeout: TIMEOUT_MS, env }
      )
      stdout = String(result.stdout ?? '')
    } catch (err) {
      // A logout hook can fail after PATH was printed; retain complete marked output.
      stdout = String(err.stdout ?? '')
      log.warn('[ShellPathResolver] Shell probe failed:', {
        code: err.code,
        signal: err.signal,
        killed: !!err.killed,
        elapsedMs: Date.now() - startedAt,
        timeoutMs: TIMEOUT_MS
      })
    }

    // macOS zsh -l -i может выводить OSC-sequences (например, \033]7;…\007) перед командой.
    const raw = stdout.replace(/\x1b\][0-9]*;[^\x07]*\x07/g, '')
    const start = raw.indexOf(delimiter)
    const end = raw.indexOf(delimiter, start + delimiter.length)
    if (start !== -1 && end !== -1 && end > start) {
      const resolved = raw.slice(start + delimiter.length, end)
      if (resolved) {
        const merged = this._mergeWithSystemPath(resolved)
        log.info(`[ShellPathResolver] Resolved PATH (${merged.length} chars): ${merged.slice(0, 120)}...`)
        return merged
      }
    }

    return null
  }

  /**
   * Гарантирует, что системные пути (/usr/bin, /bin и т.д.), а также существующие
   * пользовательские bin-директории (установленные через curl в ~/.opencode/bin, ~/.bun/bin,
   * ~/.local/bin или прописанные в ~/.bash_profile / ~/.bashrc / ~/.profile) присутствуют в PATH,
   * даже если они не были вручную перенесены в ~/.zshrc.
   * Пользовательские пути идут первыми, затем авто-обнаруженные user bin-директории, системные — в конце.
   */
  _mergeWithSystemPath(resolved) {
    const sep = path.delimiter
    const systemDefault = isUnix() ? '/usr/bin:/bin:/usr/sbin:/sbin' : ''
    const system = (this._env.PATH || systemDefault).split(sep).filter(Boolean)
    // Очищаем старые маркеры, которые могли остаться в process.env.PATH от предыдущих запусков
    const cleaned = (resolved || '').replace(new RegExp(`_?${DELIMITER}[^${sep.replace(/\\/g, '\\\\')}]*`, 'g'), '')
    const user = cleaned.split(sep).filter(Boolean)

    const existingCommonBins = getCommonUserBinDirs().filter((dir) => {
      try { return fs.statSync(dir).isDirectory() } catch { return false }
    })
    const profileDirs = isUnix() ? extractPathDirsFromShellProfiles() : []

    const merged = [...new Set([...user, ...profileDirs, ...existingCommonBins, ...system])]
    return merged.join(sep)
  }

  _buildFallbackPath() {
    const sep = path.delimiter
    const systemDefault = isUnix() ? '/usr/bin:/bin:/usr/sbin:/sbin' : ''
    const base = this._env.PATH || systemDefault
    const parts = [
      ...base.split(sep),
      ...FALLBACK_PATHS
    ]
    const resolved = [...new Set(parts)].filter(Boolean).join(sep)
    const merged = this._mergeWithSystemPath(resolved)
    log.info('[ShellPathResolver] Fallback PATH:', merged)
    return merged
  }
}
