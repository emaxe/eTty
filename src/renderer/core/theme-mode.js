/** Режимы выбора темы: вручную или по системной схеме (светлая/тёмная). */
export const THEME_MODES = Object.freeze({ MANUAL: 'manual', AUTO: 'auto' })

const FALLBACK_THEME = 'dark'

/**
 * Какую тему применить сейчас.
 *
 * - `manual` — `appearance.theme`;
 * - `auto` — `themeDark` или `themeLight` по системной схеме.
 *
 * Если выбранной темы нет среди доступных (удалили файл темы), берётся `appearance.theme`,
 * а затем `dark`: приложение не остаётся без темы.
 *
 * @param {{ theme?: string, themeMode?: string, themeDark?: string, themeLight?: string }} appearance
 * @param {boolean} systemDark
 * @param {Record<string, unknown>} themes доступные темы (id → тема)
 * @returns {string} id темы
 */
export function resolveThemeName(appearance, systemDark, themes) {
  const a = appearance || {}
  const wanted = a.themeMode === THEME_MODES.AUTO
    ? (systemDark ? a.themeDark : a.themeLight)
    : a.theme
  for (const candidate of [wanted, a.theme, FALLBACK_THEME]) {
    if (candidate && themes[candidate]) return candidate
  }
  return FALLBACK_THEME
}

/**
 * Подписка на смену системной схемы. Возвращает функцию отписки (для destroy()).
 * @param {(systemDark: boolean) => void} onChange
 * @returns {() => void}
 */
export function watchSystemScheme(onChange) {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = e => onChange(e.matches)
  query.addEventListener('change', handler)
  return () => query.removeEventListener('change', handler)
}

/** Тёмная ли сейчас системная схема. */
export function isSystemDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}
