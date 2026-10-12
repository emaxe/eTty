/**
 * Парсеры вывода git, общие для локального и SSH-раннеров (см. git-runner.js).
 */

/**
 * Разбирает строку `## ...` из `git status -b --porcelain`.
 * Примеры: `## main...origin/main [ahead 1, behind 2]`, `## main`,
 * `## No commits yet on main`, `## HEAD (no branch)`.
 * @param {string} line — без префикса `## `
 * @returns {string|null} имя ветки (null — detached HEAD)
 */
export function parseBranchHeader(line) {
  let s = line.trim()
  const noCommits = s.match(/^(?:No commits yet on|Initial commit on) (.+)$/)
  if (noCommits) return noCommits[1]
  if (s.startsWith('HEAD (no branch)')) return null
  const dots = s.indexOf('...')
  if (dots !== -1) s = s.slice(0, dots)
  else s = s.replace(/\s+\[.*\]$/, '')
  return s || null
}

/** @returns {{ ahead: number, behind: number }} из хвоста `[ahead 1, behind 2]` заголовка `## ...` */
export function parseAheadBehind(line) {
  const ahead = line.match(/ahead (\d+)/)
  const behind = line.match(/behind (\d+)/)
  return { ahead: ahead ? parseInt(ahead[1], 10) : 0, behind: behind ? parseInt(behind[1], 10) : 0 }
}

/**
 * Разбирает `git status --porcelain=v1 -b -z -uall [--ignored]`.
 * Игнорируемые пути (`!!`) приходят в `ignored`, а не в `files`.
 * @param {string} output
 * @returns {{ branch: string|null, ahead: number, behind: number,
 *   files: Array<{path: string, from?: string, index: string, working_dir: string}>, ignored: string[] }}
 */
export function parseStatusPorcelainZ(output) {
  const parts = (output || '').split('\0')
  let branch = null
  let ahead = 0
  let behind = 0
  const files = []
  const ignored = []
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (!entry) continue
    if (entry.startsWith('## ')) {
      branch = parseBranchHeader(entry.slice(3))
      ;({ ahead, behind } = parseAheadBehind(entry.slice(3)))
      continue
    }
    if (entry.length < 4) continue
    const index = entry[0]
    const workingDir = entry[1]
    if (index === '!' && workingDir === '!') {
      ignored.push(entry.slice(3))
      continue
    }
    const file = { path: entry.slice(3), index, working_dir: workingDir }
    // Rename/copy: в -z следующий NUL-токен — исходный путь
    if (index === 'R' || index === 'C' || workingDir === 'R' || workingDir === 'C') {
      file.from = parts[++i] || undefined
    }
    files.push(file)
  }
  return { branch, ahead, behind, files, ignored }
}

/**
 * Разбирает `git diff --numstat`. Бинарные файлы выводятся как `-\t-\tpath`.
 * @returns {Map<string, {additions: number, deletions: number}>}
 */
export function parseNumstat(output) {
  const map = new Map()
  for (const line of (output || '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split('\t')
    if (parts.length < 3) continue
    const additions = parts[0] === '-' ? 0 : (parseInt(parts[0], 10) || 0)
    const deletions = parts[1] === '-' ? 0 : (parseInt(parts[1], 10) || 0)
    const rawPath = parts.slice(2).join('\t')
    const normPath = rawPath.includes('=>')
      ? rawPath.replace(/\{.*? => (.*?)\}/g, '$1').replace(/^.*? => /, '')
      : rawPath
    map.set(rawPath, { additions, deletions })
    if (normPath !== rawPath) {
      map.set(normPath, { additions, deletions })
    }
  }
  return map
}

/**
 * Разбирает `git branch --no-color` (локальные ветки).
 * @returns {{ current: string|null, all: string[] }}
 */
export function parseBranchList(output) {
  let current = null
  const all = []
  for (const raw of (output || '').split('\n')) {
    if (!raw.trim()) continue
    const isCurrent = raw.startsWith('*')
    const name = raw.slice(2).trim()
    if (!name) continue
    if (name.startsWith('(')) {
      // detached HEAD / rebase: не настоящая ветка
      if (isCurrent) current = null
      continue
    }
    const clean = name.split(' -> ')[0]
    all.push(clean)
    if (isCurrent) current = clean
  }
  return { current, all }
}
