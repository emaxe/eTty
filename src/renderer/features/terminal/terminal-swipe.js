import { SWIPE_GESTURES } from '../../../shared/swipe-gesture-recognizer.js'
import { SWIPE_CONFIG } from '../../core/config/swipe-config.js'

/**
 * Чистые хелперы свайпов двумя пальцами по терминалу. Без DOM.
 */

const ARROW_FINAL = Object.freeze({
  [SWIPE_GESTURES.UP]: 'A',
  [SWIPE_GESTURES.DOWN]: 'B',
  [SWIPE_GESTURES.RIGHT]: 'C',
  [SWIPE_GESTURES.LEFT]: 'D'
})

/**
 * Приводит настройки к валидным значениям (неизвестное → «выключено»).
 * @param {{ swipeVertical?: string, swipeHorizontal?: string }|null|undefined} terminalConfig
 * @returns {{ vertical: string, horizontal: string }}
 */
export function normalizeSwipeSettings(terminalConfig) {
  const pick = (value, options) => (options.some(o => o.key === value) ? value : SWIPE_CONFIG.DEFAULT_MODE)
  return {
    vertical: pick(terminalConfig?.swipeVertical, SWIPE_CONFIG.VERTICAL_OPTIONS),
    horizontal: pick(terminalConfig?.swipeHorizontal, SWIPE_CONFIG.HORIZONTAL_OPTIONS)
  }
}

export function isSwipeGesture(gesture) {
  return Object.values(SWIPE_GESTURES).includes(gesture)
}

/** Включён ли хоть один режим свайпа (нужны ли нативные касания). */
export function hasActiveSwipe(settings) {
  return settings.vertical !== 'off' || settings.horizontal !== 'off'
}

/**
 * Что делать по свайпу.
 * @param {string} gesture — одно из SWIPE_GESTURES
 * @param {{ vertical: string, horizontal: string }} settings
 * @param {{ appCursor?: boolean }} [term] — включён ли у терминала режим application cursor keys
 * @returns {{ kind: 'arrow', seq: string } | { kind: 'tab', delta: number } | null}
 */
export function swipeAction(gesture, settings, { appCursor = false } = {}) {
  const isVertical = gesture === SWIPE_GESTURES.UP || gesture === SWIPE_GESTURES.DOWN
  const mode = isVertical ? settings.vertical : settings.horizontal
  if (mode === 'arrows' && ARROW_FINAL[gesture]) {
    return { kind: 'arrow', seq: `\x1b${appCursor ? 'O' : '['}${ARROW_FINAL[gesture]}` }
  }
  // Содержимое следует за пальцами: свайп влево открывает следующую вкладку
  if (mode === 'tabs' && !isVertical) {
    return { kind: 'tab', delta: gesture === SWIPE_GESTURES.LEFT ? 1 : -1 }
  }
  return null
}

/**
 * Нужно ли погасить событие колеса: идёт (или только что закончился) жест двумя пальцами и
 * для оси этого колеса включён свайп — иначе терминал прокрутился бы вместе со свайпом.
 */
export function shouldSuppressWheel(event, settings, { twoFingers, momentumUntil, now }) {
  if (event.ctrlKey || !(twoFingers || now < momentumUntil)) return false
  const vertical = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
  return (vertical ? settings.vertical : settings.horizontal) !== 'off'
}
