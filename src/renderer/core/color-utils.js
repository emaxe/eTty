/**
 * Разбирает `#rgb` / `#rrggbb` в [r, g, b] (0–255); иначе null.
 * @param {string} hex
 */
function parseHex(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1]
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
}

/**
 * Светлый ли цвет: относительная яркость (sRGB, WCAG) > 0.5. Нераспознанный цвет считается тёмным.
 * @param {string} hex
 */
export function isLightColor(hex) {
  const rgb = parseHex(hex)
  if (!rgb) return false
  const [r, g, b] = rgb.map(v => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5
}
