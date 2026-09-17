/**
 * Чистые парсеры вывода скриптов из `remote-scripts.js`. Без побочных эффектов — принимают
 * `Buffer`/строку, возвращают структуры. Все функции предполагают успешный (`code === 0`)
 * exec() — проверка кода возврата остаётся на стороне вызывающего кода (`ssh-fs-provider.js`).
 */

/**
 * @param {string} stdout — вывод PROBE_SCRIPT
 * @returns {{ uname: string, home: string, user: string, shell: string,
 *   statFlavor: 'gnu'|'bsd', find0: boolean, inotify: boolean, rg: boolean }}
 */
export function parseProbe(stdout) {
  const lines = stdout.split('\n')
  return {
    uname: (lines[0] || '').trim(),
    home: (lines[1] || '').trim(),
    user: (lines[2] || '').trim(),
    shell: (lines[3] || '').trim(),
    statFlavor: (lines[4] || '').trim() === 'gnu' ? 'gnu' : 'bsd',
    find0: (lines[5] || '').trim() === 'find0',
    inotify: (lines[6] || '').trim() === 'inotify',
    rg: (lines[7] || '').trim() === 'rg'
  }
}

/**
 * Разбирает вывод READ_DIR_SCRIPT/READ_DIR_FALLBACK_SCRIPT: `<dirs NUL-terminated>` +
 * один разделительный `\0` + `<files NUL-terminated>`. Первая пустая строка после split('\0')
 * ГАРАНТИРОВАННО разделитель — реальное имя файла не может быть пустым, поэтому она не
 * спутается с содержимым. Финальный элемент после split — всегда артефакт завершающего NUL,
 * отбрасывается безусловно.
 * @param {Buffer} stdoutBuffer
 * @param {string} dirPath — уже посчитанный posix-путь каталога (для сборки `path` элементов)
 * @param {(dir: string, name: string) => string} joinFn — posix-safe join (см. `shared/path-utils.js`)
 * @returns {Array<{ name: string, path: string, isDirectory: boolean }>}
 */
export function parseReadDir(stdoutBuffer, dirPath, joinFn) {
  const parts = stdoutBuffer.toString('utf-8').split('\0')
  const sepIndex = parts.findIndex((p) => p === '')
  const dirNames = sepIndex === -1 ? [] : parts.slice(0, sepIndex)
  const fileNames = sepIndex === -1 ? [] : parts.slice(sepIndex + 1, -1)

  const stripPrefix = (raw) => (raw.startsWith('./') ? raw.slice(2) : raw)

  const entries = []
  for (const raw of dirNames) {
    const name = stripPrefix(raw)
    if (!name) continue
    entries.push({ name, path: joinFn(dirPath, name), isDirectory: true })
  }
  for (const raw of fileNames) {
    const name = stripPrefix(raw)
    if (!name) continue
    entries.push({ name, path: joinFn(dirPath, name), isDirectory: false })
  }
  return entries
}

/**
 * Разбирает вывод MOVE_SCRIPT/COPY_MANY_SCRIPT: пары `O\0<newPath>\0` (успех) или
 * `E\0<srcPath>\0` (ошибка), по одной на каждый исходный путь, в порядке входа.
 * @param {Buffer} stdoutBuffer
 * @param {string[]} srcPaths — исходный порядок вызова (для сопоставления с `path` в ответе)
 * @returns {Array<{ path: string, success: boolean, newPath?: string, error?: string }>}
 */
export function parseMoveOrCopyMany(stdoutBuffer, srcPaths) {
  const tokens = stdoutBuffer.toString('utf-8').split('\0').filter((_, i, arr) => i < arr.length - 1)
  const results = []
  let srcIndex = 0
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const status = tokens[i]
    const value = tokens[i + 1]
    const src = srcPaths[srcIndex++] ?? value
    if (status === 'O') {
      results.push({ path: src, success: true, newPath: value })
    } else {
      results.push({ path: src, success: false, error: 'Operation failed' })
    }
  }
  return results
}

/**
 * Разбирает `"%s\0"`-вывод COPY_SCRIPT (один путь — новый путь после разрешения коллизии).
 * @param {Buffer} stdoutBuffer
 * @returns {string|null}
 */
export function parseSinglePathResult(stdoutBuffer) {
  const s = stdoutBuffer.toString('utf-8')
  const idx = s.indexOf('\0')
  const value = idx === -1 ? s : s.slice(0, idx)
  return value || null
}

/**
 * @param {string} stdout — "<mtimeSec> <sizeBytes>" (см. STAT_FILE_*_SCRIPT)
 * @returns {{ mtimeMs: number, size: number } | null}
 */
export function parseStatFile(stdout) {
  const match = stdout.trim().match(/^(\d+)\s+(\d+)$/)
  if (!match) return null
  return { mtimeMs: Number(match[1]) * 1000, size: Number(match[2]) }
}

/**
 * @param {string} stdout — POLL_MTIME_*_SCRIPT: по одной строке (mtime сек либо `x`) на каждый
 *   переданный каталог, в том же порядке.
 * @param {string[]} dirPaths
 * @returns {Map<string, number|null>} null — каталог исчез/недоступен
 */
export function parsePollMtimes(stdout, dirPaths) {
  const lines = stdout.split('\n').filter((_, i, arr) => i < arr.length - 1 || arr[i] !== '')
  const result = new Map()
  dirPaths.forEach((dir, i) => {
    const line = (lines[i] || '').trim()
    result.set(dir, line === 'x' || line === '' ? null : Number(line))
  })
  return result
}
