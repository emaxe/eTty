import fs from 'fs'
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
  pathExt = process.env.PATHEXT
} = {}) {
  const win = platform === 'win32'
  const sep = win ? ';' : ':'
  const join = win ? path.win32.join : path.posix.join
  const hasExt = win && path.win32.extname(name) !== ''
  const exts = win
    ? (hasExt ? [''] : ['', ...(pathExt || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)])
    : ['']
  for (const dir of (pathValue || '').split(sep).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext)
      if (exists(candidate)) return candidate
    }
  }
  return null
}

export function fileExists(p) {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}
