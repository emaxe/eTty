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
      if (norm.startsWith('\\\\')) return '\\\\' // UNC — упрощённо, без разбора \\server\share
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

  return { sep, join, dirname, basename, extname, normalize, isInside, split }
}
