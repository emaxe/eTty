/**
 * Ширины боковых панелей между запусками. Хранятся в localStorage окна: это личное удобство,
 * не настройка приложения. Любая ошибка хранилища (приватный режим, очистка данных) не ломает UI.
 */
const STORAGE_KEY = 'etty.panelWidths'

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @returns {number|null} ширина в пределах [min, max] или null, если значение не число
 */
export function clampWidth(value, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.round(Math.max(min, Math.min(max, n)))
}

/** @returns {Record<string, number>} сохранённые ширины по именам панелей */
export function loadPanelWidths() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * @param {string} name имя панели ('sidebar' | 'editor' | 'ssh')
 * @param {number} width
 */
export function savePanelWidth(name, width) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadPanelWidths(), [name]: Math.round(width) }))
  } catch {
    // хранилище недоступно — ширина просто не запомнится
  }
}
