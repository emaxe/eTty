import { TERMINAL_CONFIG } from './config/terminal-config.js'

/** Допустимые пределы настроек шрифта терминала. */
export const TERMINAL_FONT_LIMITS = Object.freeze({
  FONT_SIZE: Object.freeze({ MIN: 10, MAX: 24 }),
  LINE_HEIGHT: Object.freeze({ MIN: 1, MAX: 1.6 })
})

const clamp = (value, min, max, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}

/**
 * Параметры шрифта xterm из настроек терминала. Некорректные значения заменяются дефолтами,
 * пользовательское семейство дополняется запасным списком — терминал не остаётся без моно-шрифта.
 *
 * @param {{ fontSize?: number, lineHeight?: number, fontFamily?: string }} [terminal] `config.terminal`
 * @returns {{ fontSize: number, lineHeight: number, fontFamily: string }}
 */
export function resolveTerminalFont(terminal = {}) {
  const family = typeof terminal.fontFamily === 'string' ? terminal.fontFamily.trim() : ''
  return {
    fontSize: clamp(terminal.fontSize, TERMINAL_FONT_LIMITS.FONT_SIZE.MIN, TERMINAL_FONT_LIMITS.FONT_SIZE.MAX, TERMINAL_CONFIG.FONT_SIZE),
    lineHeight: clamp(terminal.lineHeight, TERMINAL_FONT_LIMITS.LINE_HEIGHT.MIN, TERMINAL_FONT_LIMITS.LINE_HEIGHT.MAX, 1),
    fontFamily: family ? `${family}, ${TERMINAL_CONFIG.FONT_FAMILY}` : TERMINAL_CONFIG.FONT_FAMILY
  }
}
