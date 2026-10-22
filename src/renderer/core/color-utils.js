/**
 * Разбирает `#rgb` / `#rrggbb` в [r, g, b] (0–255); иначе null.
 * @param {string} hex
 */
export function parseHex(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1]
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
}

/**
 * [r, g, b] (0–255, дробные округляются) → `#rrggbb`.
 * @param {number[]} rgb
 */
export function toHex(rgb) {
  return '#' + rgb
    .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Относительная яркость (sRGB, WCAG) в диапазоне 0–1. Нераспознанный цвет → 0.
 * @param {string} hex
 */
export function luminance(hex) {
  const rgb = parseHex(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map(v => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Светлый ли цвет: относительная яркость (sRGB, WCAG) > 0.5. Нераспознанный цвет считается тёмным.
 * @param {string} hex
 */
export function isLightColor(hex) {
  return parseHex(hex) ? luminance(hex) > 0.5 : false
}

/**
 * Контраст двух цветов по WCAG (1–21).
 * @param {string} a
 * @param {string} b
 */
export function contrastRatio(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * Линейное смешивание в sRGB: t=0 → a, t=1 → b. Нераспознанный `a` возвращается как есть.
 * @param {string} a
 * @param {string} b
 * @param {number} t 0..1
 */
export function mix(a, b, t) {
  const ca = parseHex(a)
  const cb = parseHex(b)
  if (!ca) return a
  if (!cb) return a
  return toHex(ca.map((v, i) => v + (cb[i] - v) * t))
}

/**
 * Доводит `fg` до контраста не ниже `ratio` относительно каждого из фонов: сдвигает цвет к белому
 * на тёмном фоне и к чёрному на светлом (оттенок сохраняется, пока это возможно).
 * Если контраст уже достаточен — возвращает `fg` без изменений.
 * @param {string} fg
 * @param {string|string[]} bgs фон или список фонов, на которых текст должен читаться
 * @param {number} [ratio=4.5]
 */
export function ensureContrast(fg, bgs, ratio = 4.5) {
  if (!parseHex(fg)) return fg
  const list = (Array.isArray(bgs) ? bgs : [bgs]).filter(parseHex)
  if (list.length === 0) return fg
  const ok = c => list.every(bg => contrastRatio(c, bg) >= ratio)
  if (ok(fg)) return fg

  // Направление: к тому полюсу, который контрастнее самому тёмному/светлому из фонов.
  const avgLum = list.reduce((s, bg) => s + luminance(bg), 0) / list.length
  const pole = avgLum > 0.5 ? '#000000' : '#ffffff'
  if (!ok(pole)) return pole

  let lo = 0
  let hi = 1
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2
    if (ok(mix(fg, pole, mid))) hi = mid
    else lo = mid
  }
  return mix(fg, pole, hi)
}

/**
 * Читаемый цвет текста на заливке: чёрный или белый, что контрастнее.
 * @param {string} bg
 */
export function inkOn(bg) {
  return contrastRatio('#000000', bg) >= contrastRatio('#ffffff', bg) ? '#000000' : '#ffffff'
}
