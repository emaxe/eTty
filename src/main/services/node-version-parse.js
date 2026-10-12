/**
 * Чистые функции для работы с версиями Node.js: парсеры вывода nvm/fnm/asdf, валидация версии,
 * определение версии по пути к бинарю. Без зависимостей от Electron — покрыты тестами.
 */

/**
 * Допустимые идентификаторы версии: semver (`20`, `v20.1`, `20.1.0`), `lts/*`, `lts/iron`,
 * алиасы (`node`, `latest`, `lts`). Целиком анкерится — любые пробелы/метасимволы шелла отклоняются.
 */
const VERSION_RE = /^(v?\d+(\.\d+){0,2}|lts\/[A-Za-z0-9*_-]+|[A-Za-z][A-Za-z0-9._-]*)$/

export function validateVersion(version) {
  if (typeof version !== 'string' || !VERSION_RE.test(version)) {
    throw new Error(`Invalid Node version: ${version}`)
  }
  return version
}

/** Убирает CSI/OSC-последовательности (macOS zsh -i печатает OSC 7 перед выводом команды). */
export function stripTerminalEscapes(text) {
  return String(text || '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
}

const NVM_VERSION_LINE = /^\s*(->)?\s*v(\d+\.\d+\.\d+)\b(.*)$/

/** `nvm ls --no-colors`: строки-алиасы (`default -> ...`, `lts/* -> ...`, `system`) пропускаются. */
export function parseNvmList(stdout) {
  const versions = []
  for (const line of stripTerminalEscapes(stdout).split('\n')) {
    const m = line.match(NVM_VERSION_LINE)
    if (!m) continue
    versions.push({ version: m[2], current: Boolean(m[1]), lts: /LTS/i.test(m[3]) })
  }
  return versions
}

/** `nvm ls-remote --no-colors`, свежие версии первыми. */
export function parseNvmRemote(stdout) {
  const versions = []
  for (const line of stripTerminalEscapes(stdout).split('\n')) {
    const m = line.match(NVM_VERSION_LINE)
    if (!m) continue
    versions.push({ version: m[2], lts: /LTS/i.test(m[3]) })
  }
  return versions.reverse()
}

/** `fnm list`: `* v20.1.0 default`; `system` пропускается, `default` — версия по умолчанию. */
export function parseFnmList(stdout) {
  const versions = []
  for (const line of stripTerminalEscapes(stdout).split('\n')) {
    const m = line.match(/^\s*\*?\s*v?(\d+\.\d+\.\d+)\b(.*)$/)
    if (!m) continue
    versions.push({ version: m[1], current: false, default: /\bdefault\b/.test(m[2]) })
  }
  return versions
}

export function parseFnmRemote(stdout) {
  return stripTerminalEscapes(stdout).split('\n')
    .map(l => l.trim().match(/^v?(\d+\.\d+\.\d+)\b(.*)$/))
    .filter(Boolean)
    .map(m => ({ version: m[1], lts: /\(/.test(m[2]) }))
    .reverse()
}

/** `asdf list nodejs`: активная версия помечена `*`. */
export function parseAsdfList(stdout) {
  const versions = []
  for (const line of stripTerminalEscapes(stdout).split('\n')) {
    const m = line.match(/^\s*(\*)?\s*(\d+\.\d+\.\d+)\s*$/)
    if (m) versions.push({ version: m[2], current: Boolean(m[1]) })
  }
  return versions
}

export function parseAsdfRemote(stdout) {
  return stripTerminalEscapes(stdout).split('\n')
    .map(l => l.trim())
    .filter(l => /^\d+\.\d+\.\d+$/.test(l))
    .map(v => ({ version: v }))
    .reverse()
}

// ~/.nvm/versions/node/v22.1.0/bin/node, fnm: .../node-versions/v20.1.0/installation/bin/node,
// asdf: ~/.asdf/installs/nodejs/20.1.0/bin/node, volta: ~/.volta/tools/image/node/20.1.0/bin/node
const NODE_PATH_VERSION_RE = /\/(?:versions\/node|node-versions|installs\/nodejs|tools\/image\/node)\/v?(\d+\.\d+\.\d+)\//

/** Версия из пути к бинарю node либо null (shim'ы, brew, системная установка — нужен запуск). */
export function versionFromNodePath(nodePath) {
  const m = typeof nodePath === 'string' ? nodePath.match(NODE_PATH_VERSION_RE) : null
  return m ? m[1] : null
}
