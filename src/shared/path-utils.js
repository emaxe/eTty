/**
 * POSIX-safe утилиты путей без `node:path` — годятся и для main (SSH-провайдер, всегда POSIX
 * на удалённой стороне), и для renderer (`file-tree.js` и т.п. используют `path.win32`/`path.posix`
 * не напрямую, а через этот модуль, параметризованный разделителем текущего FS-контекста вкладки).
 * Для локального провайдера на Windows разделитель — `\\`; для SSH и локального posix — `/`.
 */

/** @param {string} sep — '/' или '\\' */
export function createPathUtils(sep = '/') {
  const isWin = sep === '\\'
  // На Windows допустим и '/', и '\\' во входных путях (так исторически ведёт себя node:path.win32)
  const splitRe = isWin ? /[\\/]/ : /\//

  function normalizeSlashes(p) {
    return isWin ? p.replace(/\//g, '\\') : p
  }

  function split(p) {
    return normalizeSlashes(p).split(splitRe).filter(Boolean)
  }

  /** Абсолютный ли путь начинается с root-маркера (используется join/isInside). */
  function rootPrefix(p) {
    const norm = normalizeSlashes(p)
    if (isWin) {
      const m = norm.match(/^[A-Za-z]:\\/)
      if (m) return m[0]
      const unc = norm.match(/^\\\\[^\\]+\\[^\\]+\\?/)
      if (unc) return unc[0].endsWith('\\') ? unc[0] : unc[0] + '\\'
      return ''
    }
    return norm.startsWith('/') ? sep : ''
  }

  function join(dir, ...parts) {
    const root = rootPrefix(dir)
    // split() режет по разделителям, но не знает о корневом маркере (`C:\`) — без явного
    // среза он попадёт в сегменты как обычный кусок пути и задвоится с `root`.
    const dirWithoutRoot = root ? normalizeSlashes(dir).slice(root.length) : dir
    const segments = split(dirWithoutRoot).concat(parts.flatMap((p) => split(p)))
    return (root || '') + segments.join(sep)
  }

  function dirname(p) {
    const root = rootPrefix(p)
    const withoutRoot = root ? normalizeSlashes(p).slice(root.length) : p
    const segments = split(withoutRoot)
    if (segments.length <= 1) return root || sep
    return (root || '') + segments.slice(0, -1).join(sep)
  }

  function basename(p) {
    const segments = split(p)
    return segments[segments.length - 1] || ''
  }

  function extname(name) {
    const base = basename(name)
    // Паритет с node:path.extname: ведущие точки (dotfile) не считаются расширением
    const idx = base.lastIndexOf('.')
    if (idx <= 0) return ''
    return base.slice(idx)
  }

  function normalize(p) {
    const root = rootPrefix(p)
    const withoutRoot = root ? normalizeSlashes(p).slice(root.length) : p
    const out = []
    for (const seg of split(withoutRoot)) {
      if (seg === '.') continue
      if (seg === '..') {
        if (out.length && out[out.length - 1] !== '..') out.pop()
        else if (!root) out.push('..')
        continue
      }
      out.push(seg)
    }
    return (root || '') + out.join(sep) || (root || '.')
  }

  /** true, если `child` лежит внутри (или равен) `root`. Регистронезависимо на Windows. */
  function isInside(root, child) {
    const eq = (a, b) => (isWin ? a.toLowerCase() === b.toLowerCase() : a === b)
    const rootNorm = normalize(root)
    const childNorm = normalize(child)
    if (eq(rootNorm, childNorm)) return true
    const prefix = rootNorm.endsWith(sep) ? rootNorm : rootNorm + sep
    return isWin ? childNorm.toLowerCase().startsWith(prefix.toLowerCase()) : childNorm.startsWith(prefix)
  }

  /** Сравнение путей: регистронезависимо на Windows, разделители и `..` нормализуются. */
  function equals(a, b) {
    const na = normalize(a)
    const nb = normalize(b)
    return isWin ? na.toLowerCase() === nb.toLowerCase() : na === nb
  }

  /** true, если путь — корень ФС (`/`, `C:\\`, `\\\\server\\share\\`). */
  function isRoot(p) {
    const root = rootPrefix(p)
    return !!root && normalize(p) === normalize(root)
  }

  /** Относительный путь `to` от `from` (разделитель — `sep`); '' если пути равны. */
  function relative(from, to) {
    if (equals(from, to)) return ''
    if (!isInside(from, to)) return normalize(to)
    return split(normalize(to).slice(normalize(from).length)).join(sep)
  }

  /**
   * `file://` URL (OSC 7) → путь. Windows: `file:///C:/a%20b` → `C:\\a b`,
   * `file://server/share/x` → `\\\\server\\share\\x`. POSIX: хост отбрасывается.
   */
  function fromFileUrl(url) {
    const m = /^file:\/\/([^/]*)(\/.*)?$/.exec(url)
    if (!m) return null
    let rest = m[2] || '/'
    try { rest = decodeURIComponent(rest) } catch { /* оставляем как есть */ }
    if (isWin) {
      const drive = rest.match(/^\/([A-Za-z]:)(\/.*)?$/)
      if (drive) rest = drive[1] + (drive[2] || '/')
      else if (m[1] && m[1] !== 'localhost') rest = '//' + m[1] + rest
      const out = normalizeSlashes(rest)
      return /^[A-Za-z]:\\?$/.test(out) ? out.replace(/\\?$/, '\\') : out.replace(/\\+$/, '')
    }
    return rest.replace(/\/+$/, '') || '/'
  }

  /** Путь для показа: домашний каталог → `~` (только POSIX; Windows показывает путь как есть). */
  function toDisplay(p, home) {
    if (isWin || !home) return p
    if (p === home) return '~'
    return p.startsWith(home + '/') ? '~' + p.slice(home.length) : p
  }

  return { sep, join, dirname, basename, extname, normalize, isInside, split, equals, isRoot, relative, fromFileUrl, toDisplay }
}
