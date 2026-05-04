import { execFile } from 'child_process'
import { promisify } from 'util'
import os from 'os'
import log from 'electron-log'

const execFileAsync = promisify(execFile)

const FALLBACK_PATHS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
  os.homedir() + '/.cargo/bin',
  os.homedir() + '/.local/bin'
]

const SHELL = '/bin/zsh'
const TIMEOUT_MS = 3000
const DELIMITER = '_SHELL_PATH_DELIMITER_'

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

  async _doResolve() {
    const script = `printf "%s" "${DELIMITER}$PATH${DELIMITER}"`

    try {
      const { stdout } = await execFileAsync(
        SHELL,
        ['-l', '-i', '-c', script],
        { timeout: TIMEOUT_MS, env: process.env }
      )

      const raw = stdout || ''
      const start = raw.indexOf(DELIMITER)
      const end = raw.indexOf(DELIMITER, start + DELIMITER.length)

      let resolved
      if (start !== -1 && end !== -1 && end > start) {
        resolved = raw.slice(start + DELIMITER.length, end)
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
    const system = (process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin').split(':').filter(Boolean)
    const user = (resolved || '').split(':').filter(Boolean)
    const merged = [...new Set([...user, ...system])]
    return merged.join(':')
  }

  _buildFallbackPath() {
    const base = process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'
    const parts = [
      ...base.split(':'),
      ...FALLBACK_PATHS
    ]
    const resolved = [...new Set(parts)].filter(Boolean).join(':')
    const merged = this._mergeWithSystemPath(resolved)
    log.info('[ShellPathResolver] Fallback PATH:', merged)
    return merged
  }
}
