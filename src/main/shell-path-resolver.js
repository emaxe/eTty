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
const TIMEOUT_MS = 3000
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
  constructor() {
    this._resolvedPath = null
    this._promise = null
  }

  /**
   * Возвращает (лениво) единый resolved PATH.
   * При ошибке/таймауте — fallback на process.env.PATH + типовые пути.
   */
  async resolve() {
    if (this._resolvedPath !== null) {
      return this._resolvedPath
    }
    if (this._promise !== null) {
      return this._promise
    }
    this._promise = this._doResolve()
    this._resolvedPath = await this._promise
    this._promise = null
    return this._resolvedPath
  }

  /**
   * Синхронный доступ к кэшированному PATH.
   * Возвращает null, если resolve() ещё не вызывался.
   */
  getResolvedPath() {
    return this._resolvedPath
  }

  /**
   * Сбросить кэш. Следующий resolve() перечитает PATH.
   */
  invalidate() {
    this._resolvedPath = null
    this._promise = null
  }

  /**
   * Возвращает shell по умолчанию для текущей платформы.
   * @returns {string}
   */
  getDefaultShell() {
    return SHELL
  }

  async _doResolve() {
    // На Windows zsh отсутствует — сразу fallback
    if (!isUnix()) {
      return this._buildFallbackPath()
    }

    // Уникальный маркер, чтобы избежать коллизий, если PATH уже содержит старый DELIMITER
    const delimiter = `${DELIMITER}_${Date.now()}_${Math.random().toString(36).slice(2)}_`
    // Разделяем маркер и $PATH отдельными аргументами, иначе zsh склеивает
    // $PATH и маркер в одно имя переменной (например $PATH_SHELL_PATH_DELIMITER_...)
    const script = `printf '%s%s%s' '${delimiter}' "\${PATH}" '${delimiter}'`

    try {
      const { stdout } = await execFileAsync(
        SHELL,
        ['-l', '-i', '-c', script],
        { timeout: TIMEOUT_MS, env: process.env }
      )

      // macOS zsh -l -i может выводить OSC-sequences (например, \033]7;…\007) перед командой.
      const raw = (stdout || '').replace(/\x1b\][0-9]*;[^\x07]*\x07/g, '')
      const start = raw.indexOf(delimiter)
      const end = raw.indexOf(delimiter, start + delimiter.length)

      let resolved
      if (start !== -1 && end !== -1 && end > start) {
        resolved = raw.slice(start + delimiter.length, end)
      } else {
        // Если маркеры не найдены — берём весь stdout, очищаем
        resolved = raw.trim()
      }

      if (resolved) {
        const merged = this._mergeWithSystemPath(resolved)
        log.info(`[ShellPathResolver] Resolved PATH (${merged.length} chars): ${merged.slice(0, 120)}...`)
        return merged
      }
    } catch (err) {
      log.warn('[ShellPathResolver] Failed to resolve via zsh, falling back:', err.message)
    }

    return this._buildFallbackPath()
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
    const system = (process.env.PATH || systemDefault).split(sep).filter(Boolean)
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
    const base = process.env.PATH || systemDefault
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
