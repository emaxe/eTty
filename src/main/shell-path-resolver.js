import { execFile } from 'child_process'
import { promisify } from 'util'
import os from 'os'
import path from 'path'
import log from 'electron-log'

const execFileAsync = promisify(execFile)

const IS_WIN = process.platform === 'win32'

const FALLBACK_PATHS = IS_WIN
  ? [
      'C:\\Windows\\System32',
      'C:\\Windows',
      'C:\\Windows\\System32\\Wbem',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0',
      'C:\\Program Files\\PowerShell\\7',
      path.join(os.homedir(), '.cargo', 'bin'),
    ]
  : [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      os.homedir() + '/.cargo/bin',
      os.homedir() + '/.local/bin'
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
   * Гарантирует, что системные пути (/usr/bin, /bin и т.д.) присутствуют в PATH,
   * даже если dotfiles пользователя перезаписали PATH без сохранения $PATH.
   * Пользовательские пути идут первыми (приоритет brew/nvm/...), системные — в конце.
   */
  _mergeWithSystemPath(resolved) {
    const sep = path.delimiter
    const systemDefault = isUnix() ? '/usr/bin:/bin:/usr/sbin:/sbin' : ''
    const system = (process.env.PATH || systemDefault).split(sep).filter(Boolean)
    // Очищаем старые маркеры, которые могли остаться в process.env.PATH от предыдущих запусков
    const cleaned = (resolved || '').replace(new RegExp(`_?${DELIMITER}[^${sep.replace(/\\/g, '\\\\')}]*`, 'g'), '')
    const user = cleaned.split(sep).filter(Boolean)
    const merged = [...new Set([...user, ...system])]
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
