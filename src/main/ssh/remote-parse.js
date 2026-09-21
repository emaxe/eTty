/**
 * Чистые парсеры вывода скриптов из `remote-scripts.js`. Без побочных эффектов — принимают
 * `Buffer`/строку, возвращают структуры. Все функции предполагают успешный (`code === 0`)
 * exec() — проверка кода возврата остаётся на стороне вызывающего кода (`ssh-fs-provider.js`).
 */

/**
 * @param {string} stdout — вывод PROBE_SCRIPT
 * @returns {{ uname: string, home: string, user: string, shell: string,
 *   statFlavor: 'gnu'|'bsd', find0: boolean, inotify: boolean, rg: boolean,
 *   tmuxVersion: string|null, tmuxPassthrough: boolean, pkgManager: string|null }}
 */
export function parseProbe(stdout) {
  const lines = stdout.split('\n')
  const tmuxLine = (lines[8] || '').trim()
  const pkgManagerLine = (lines[9] || '').trim()
  return {
    uname: (lines[0] || '').trim(),
    home: (lines[1] || '').trim(),
    user: (lines[2] || '').trim(),
    shell: (lines[3] || '').trim(),
    statFlavor: (lines[4] || '').trim() === 'gnu' ? 'gnu' : 'bsd',
    find0: (lines[5] || '').trim() === 'find0',
    inotify: (lines[6] || '').trim() === 'inotify',
    rg: (lines[7] || '').trim() === 'rg',
    tmuxVersion: tmuxLine && tmuxLine !== '-' ? tmuxLine : null,
    tmuxPassthrough: tmuxSupportsPassthrough(tmuxLine),
    pkgManager: pkgManagerLine && pkgManagerLine !== '-' ? pkgManagerLine : null
  }
}

/**
 * `tmux -V` печатает `tmux X.Y[letter]` (напр. `tmux 3.3a`) либо `tmux next-X.Y` на снапшотах
 * (считаем поддерживающими — снапшот заведомо новее любого релиза). Сравнение версий —
 * побайтовое посимвольное (лексикографическое) сравнение числовой части с порогом
 * `SSH_SESSION_CONFIG.TMUX_PASSTHROUGH_MIN_VERSION` ('3.3'), с поправкой на буквенный суффикс
 * (3.3a > 3.3 в семантике tmux) и на то, что "3.10" лексикографически МЕНЬШЕ "3.3" при
 * посимвольном сравнении строк — поэтому сравниваем major/minor как числа, не строки.
 */
function tmuxSupportsPassthrough(tmuxVersionLine) {
  if (!tmuxVersionLine || tmuxVersionLine === '-') return false
  if (/^tmux next-/.test(tmuxVersionLine)) return true
  const match = tmuxVersionLine.match(/^tmux (\d+)\.(\d+)/)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  const [minMajor, minMinor] = SSH_SESSION_MIN_PASSTHROUGH
  if (major !== minMajor) return major > minMajor
  return minor >= minMinor
}

const SSH_SESSION_MIN_PASSTHROUGH = [3, 3]

/**
 * @param {string} stdout — вывод TMUX_SESSION_STATE_SCRIPT: `<pane_current_path>|<pane_path>|<pane_current_command>`
 * @returns {{ currentPath: string, pathFromOsc: string, currentCommand: string } | null}
 */
export function parseTmuxSessionState(stdout) {
  const line = stdout.split('\n')[0]
  if (!line) return null
  const [currentPath = '', pathFromOsc = '', currentCommand = ''] = line.split('|')
  if (!currentPath && !pathFromOsc && !currentCommand) return null
  return { currentPath, pathFromOsc, currentCommand }
}

/**
 * Разбирает вывод TMUX_LIST_SESSIONS_SCRIPT: строки-записи (`\n` — естественный разделитель от
 * самого tmux), поля внутри строки — NUL (см. докстринг скрипта — TAB→NUL, а не TAB/NEWLINE→NUL,
 * именно чтобы пустое `session_activity` не путалось с границей секций). Секции — «сессии»
 * (5 полей) и «активная команда каждой сессии» (4 поля, из `list-panes -a`) — разделены ровно
 * ОДНОЙ ПУСТОЙ строкой; запись сессии, даже с пустой `activity`, никогда не бывает пустой строкой
 * целиком (минимум 4 NUL между 5 полями), поэтому первая пустая строка после `split('\n')`
 * ГАРАНТИРОВАННО разделитель секций — тот же инвариант, что у `parseReadDir` с NUL.
 * @param {Buffer} stdoutBuffer
 * @returns {Array<{ name: string, windows: number, attached: number, createdAt: number|null,
 *   activityAt: number|null, currentCommand: string|null }>} attached первыми, дальше по
 *   activityAt убыв. (сессии без activity — в конце, в исходном порядке).
 */
export function parseTmuxSessions(stdoutBuffer) {
  const lines = stdoutBuffer.toString('utf-8').split('\n')
  // Хвостовой элемент после split('\n') — всегда артефакт финального \n второй секции
  // (или единственного \n при пустом сервере), отбрасывается безусловно.
  if (lines.length && lines[lines.length - 1] === '') lines.pop()

  const sepIndex = lines.findIndex((l) => l === '')
  const sessionLines = sepIndex === -1 ? lines : lines.slice(0, sepIndex)
  const paneLines = sepIndex === -1 ? [] : lines.slice(sepIndex + 1)

  const commandBySession = new Map()
  for (const line of paneLines) {
    const fields = line.split('\0')
    if (fields.length < 4) continue
    const [windowActive, paneActive, command, name] = fields
    if (windowActive === '1' && paneActive === '1' && name) {
      commandBySession.set(name, command || null)
    }
  }

  const sessions = []
  for (const line of sessionLines) {
    const fields = line.split('\0')
    if (fields.length < 5) continue
    const [windowsRaw, attachedRaw, createdRaw, activityRaw, name] = fields
    // Защита от TAB (→NUL) в имени сессии (возможно только через ручной rename-session) —
    // если числовые поля не числа, запись сдвинулась и разбирать её нельзя; пропускаем
    // битую запись целиком, соседние (валидные) записи не трогаем.
    if (!name || !/^\d+$/.test(windowsRaw) || !/^\d+$/.test(attachedRaw) || !/^\d+$/.test(createdRaw)) continue
    sessions.push({
      name,
      windows: Number(windowsRaw),
      attached: Number(attachedRaw),
      createdAt: Number(createdRaw) * 1000,
      activityAt: /^\d+$/.test(activityRaw) ? Number(activityRaw) * 1000 : null,
      currentCommand: commandBySession.get(name) ?? null
    })
  }

  sessions.sort((a, b) => {
    if (a.attached !== b.attached) return b.attached - a.attached
    const aAct = a.activityAt ?? -1
    const bAct = b.activityAt ?? -1
    return bAct - aAct
  })
  return sessions
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
