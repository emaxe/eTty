import fs from 'fs'
import os from 'os'
import path from 'path'

/**
 * Копия окружения с применёнными override. На Windows имена переменных регистронезависимы
 * (`Path` в process.env), поэтому ключ override сопоставляется с существующим без учёта регистра —
 * иначе в env попадают и `Path`, и `PATH`, и какая из них победит, не определено.
 * @param {Record<string, string|undefined>} base
 * @param {Record<string, string|undefined>} [overrides] — undefined/null удаляют переменную
 * @param {{ platform?: string }} [opts]
 */
export function buildChildEnv(base, overrides = {}, { platform = process.platform } = {}) {
  const env = { ...base }
  const ci = platform === 'win32'
  for (const [key, value] of Object.entries(overrides)) {
    if (ci) {
      const lower = key.toLowerCase()
      for (const existing of Object.keys(env)) {
        if (existing.toLowerCase() === lower) delete env[existing]
      }
    }
    if (value !== undefined && value !== null) env[key] = value
  }
  return env
}

/** Значение PATH из env: на Windows ключ может называться `Path`. */
export function getPathValue(env = process.env, { platform = process.platform } = {}) {
  if (platform !== 'win32') return env.PATH || ''
  const key = Object.keys(env).find(k => k.toLowerCase() === 'path')
  return key ? env[key] || '' : ''
}

/**
 * Ищет исполняемый файл по PATH (на Windows — с учётом PATHEXT). Без запуска shell,
 * поэтому работает там, где нет `sh`/`which`.
 * @param {string} name — `ssh`, `claude`, `pwsh.exe`
 * @param {string} pathValue — значение PATH
 * @param {{ platform?: string, exists?: (p: string) => boolean, pathExt?: string }} [opts]
 * @returns {string|null} полный путь или null
 */
export function findExecutable(name, pathValue, {
  platform = process.platform,
  exists = fileExists,
  pathExt = process.env.PATHEXT,
  homedir = os.homedir()
} = {}) {
  if (!name || typeof name !== 'string') return null
  const trimmed = name.trim()
  if (!trimmed) return null

  const win = platform === 'win32'
  const sep = win ? ';' : ':'
  const join = win ? path.win32.join : path.posix.join
  const expanded = (trimmed.startsWith('~/') || (win && trimmed.startsWith('~\\')))
    ? join(homedir, trimmed.slice(2))
    : trimmed
  const hasExt = win && path.win32.extname(expanded) !== ''
  const exts = win
    ? (hasExt ? [''] : ['', ...(pathExt || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)])
    : ['']

  if (expanded.includes('/') || (win && expanded.includes('\\'))) {
    for (const ext of exts) {
      const candidate = expanded + ext
      if (exists(candidate)) return candidate
    }
    return null
  }

  for (const dir of (pathValue || '').split(sep).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, expanded + ext)
      if (exists(candidate)) return candidate
    }
  }
  return null
}

/**
 * Извлекает имя или путь исполняемого бинарника из командной строки запуска
 * (пропускает ведущие присваивания вида KEY=VAL и снимает кавычки).
 * @param {string} cmdLine
 * @returns {string}
 */
export function extractCommandBinary(cmdLine) {
  if (!cmdLine || typeof cmdLine !== 'string') return ''
  const tokens = cmdLine.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
  for (const raw of tokens) {
    const unquoted = raw.replace(/^["']|["']$/g, '')
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(unquoted)) continue
    return unquoted
  }
  return ''
}

export function fileExists(p) {
  try {
    if (!fs.statSync(p).isFile()) return false
    // На POSIX важен бит исполнения; Windows определяет исполняемость расширением (PATHEXT)
    if (process.platform !== 'win32') fs.accessSync(p, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}
