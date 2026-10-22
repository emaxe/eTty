import { ensureContrast, inkOn, isLightColor, mix } from './color-utils.js'

/** Минимальный контраст текста (WCAG AA). */
export const TEXT_CONTRAST = 4.5
/** Минимальный контраст неТекстовых элементов (фокус, границы контролов). */
export const UI_CONTRAST = 3

/**
 * Необязательные ключи `theme.ui`, которыми тема может явно переопределить выведенную роль.
 * Ключ темы → CSS-переменная.
 */
export const UI_ROLE_OVERRIDES = {
  ground: '--ground',
  raised: '--raised',
  active: '--active',
  rule: '--rule',
  control: '--control',
  textSecondary: '--text-secondary',
  textTertiary: '--text-tertiary',
  accentInk: '--accent-ink',
  positive: '--positive',
  negative: '--negative',
  warning: '--warning',
  focus: '--focus',
  scrim: '--scrim',
  shadowFloat: '--shadow-float'
}

/** Фон плашки статуса: заливка 14% цвета статуса поверх фона. */
const PILL_MIX = 0.14

/**
 * Выводит из десяти базовых цветов темы (`theme.ui`) полный набор семантических CSS-переменных:
 * поверхности, линии, три уровня текста с гарантированным контрастом, статусы, фокус, scrim, тень.
 * Старые имена (`--bg`, `--subtext`, `--green`, …) отдаются алиасами на новые роли.
 *
 * Чистая функция: один и тот же `ui` всегда даёт один и тот же результат.
 *
 * @param {Record<string, string>} ui `theme.ui`
 * @returns {Record<string, string>} `{ '--имя': 'значение' }`
 */
export function deriveUiTokens(ui) {
  const light = isLightColor(ui.bg)
  const ground = ui.ground || ui.bg
  const surface = ui.surface

  // Фоны, на которых обязан читаться любой текст.
  const grounds = [ground, surface]
  const text = ensureContrast(ui.text, grounds, TEXT_CONTRAST)

  const raised = mix(ground, text, light ? 0.03 : 0.07)
  const active = ui.hover
  const border = ui.border
  const rule = mix(border, ground, 0.5)
  const control = mix(border, text, light ? 0.3 : 0.25)

  const textSecondary = ensureContrast(ui.subtext, grounds, TEXT_CONTRAST)
  const textTertiary = ensureContrast(ui.muted, grounds, TEXT_CONTRAST)

  const accent = ui.accent
  const accentInk = inkOn(accent)
  const focus = ensureContrast(accent, grounds, UI_CONTRAST)

  const positive = ensureContrast(ui.green, grounds, TEXT_CONTRAST)
  const negative = ensureContrast(ui.red, grounds, TEXT_CONTRAST)
  const warning = ensureContrast(light ? '#92400e' : '#d9a441', grounds, TEXT_CONTRAST)

  const pill = color => {
    const bg = mix(ground, color, PILL_MIX)
    return { bg, ink: ensureContrast(color, bg, TEXT_CONTRAST) }
  }
  const pillPositive = pill(positive)
  const pillNegative = pill(negative)
  const pillWarning = pill(warning)
  const pillNeutral = { bg: active, ink: ensureContrast(textSecondary, active, TEXT_CONTRAST) }

  const tokens = {
    '--ground': ground,
    '--surface': surface,
    '--raised': raised,
    '--active': active,
    '--border': border,
    '--rule': rule,
    '--control': control,
    '--text': text,
    '--text-secondary': textSecondary,
    '--text-tertiary': textTertiary,
    '--accent': accent,
    '--accent-ink': accentInk,
    '--focus': focus,
    '--positive': positive,
    '--negative': negative,
    '--warning': warning,
    '--pill-positive-bg': pillPositive.bg,
    '--pill-positive-ink': pillPositive.ink,
    '--pill-negative-bg': pillNegative.bg,
    '--pill-negative-ink': pillNegative.ink,
    '--pill-warning-bg': pillWarning.bg,
    '--pill-warning-ink': pillWarning.ink,
    '--pill-neutral-bg': pillNeutral.bg,
    '--pill-neutral-ink': pillNeutral.ink,
    '--scrim': light ? 'rgba(0, 0, 0, 0.35)' : 'rgba(0, 0, 0, 0.55)',
    '--shadow-float': light
      ? '0 8px 24px rgba(0, 0, 0, 0.16)'
      : '0 8px 24px rgba(0, 0, 0, 0.45)'
  }

  for (const [key, cssVar] of Object.entries(UI_ROLE_OVERRIDES)) {
    if (typeof ui[key] === 'string' && ui[key]) tokens[cssVar] = ui[key]
  }

  // Алиасы старых имён: код и CSS, ещё не переведённые на новые роли, продолжают работать
  // и заодно получают исправленный контраст.
  tokens['--bg'] = tokens['--ground']
  tokens['--subtext'] = tokens['--text-secondary']
  tokens['--muted'] = tokens['--text-tertiary']
  tokens['--green'] = tokens['--positive']
  tokens['--red'] = tokens['--negative']
  tokens['--hover'] = tokens['--active']

  return tokens
}

/**
 * Применяет токены к элементу (обычно `document.documentElement`).
 * @param {CSSStyleDeclaration} style
 * @param {Record<string, string>} tokens
 */
export function applyTokens(style, tokens) {
  for (const [name, value] of Object.entries(tokens)) style.setProperty(name, value)
}
