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
 * @param {{ swipeVertical?: string, swipeHorizontal?: string, swipeModifier?: string }|null|undefined} terminalConfig
 * @returns {{ vertical: string, horizontal: string, modifier: string }}
 */
export function normalizeSwipeSettings(terminalConfig) {
  const pick = (value, options) => (options.some(o => o.key === value) ? value : SWIPE_CONFIG.DEFAULT_MODE)
  return {
    vertical: pick(terminalConfig?.swipeVertical, SWIPE_CONFIG.VERTICAL_OPTIONS),
    horizontal: pick(terminalConfig?.swipeHorizontal, SWIPE_CONFIG.HORIZONTAL_OPTIONS),
    modifier: SWIPE_CONFIG.MODIFIER_OPTIONS.some(o => o.key === terminalConfig?.swipeModifier)
      ? terminalConfig.swipeModifier
      : SWIPE_CONFIG.DEFAULT_MODIFIER
  }
}

/**
 * Зажат ли модификатор вертикального свайпа. `none` — модификатор не нужен (всегда true).
 * @param {string} modifier — none | shift | alt | primary
 * @param {{ shift?: boolean, alt?: boolean, meta?: boolean, ctrl?: boolean }} held
 * @param {boolean} isMac — primary это Cmd (meta) на macOS и Ctrl на остальных
 */
export function isModifierHeld(modifier, held, isMac) {
  switch (modifier) {
    case 'shift': return !!held.shift
    case 'alt': return !!held.alt
    case 'primary': return isMac ? !!held.meta : !!held.ctrl
    default: return true
  }
}

/** Вертикальный ли свайп (вверх/вниз) — тот, что конфликтует с прокруткой. */
export function isVerticalSwipe(gesture) {
  return gesture === SWIPE_GESTURES.UP || gesture === SWIPE_GESTURES.DOWN
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
 * @param {{ appCursor?: boolean, held?: object, isMac?: boolean }} [ctx] — appCursor: режим application cursor keys;
 *   held/isMac — какие модификаторы зажаты сейчас (нужны для вертикального свайпа)
 * @returns {{ kind: 'arrow', seq: string } | { kind: 'tab', delta: number } | null}
 */
export function swipeAction(gesture, settings, { appCursor = false, held = {}, isMac = true } = {}) {
  const isVertical = isVerticalSwipe(gesture)
  // Вертикальный свайп конфликтует с прокруткой: без нужного модификатора это просто прокрутка
  if (isVertical && !isModifierHeld(settings.modifier, held, isMac)) return null
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
export function shouldSuppressWheel(event, settings, { twoFingers, momentumUntil, now, isMac = true, engaged = false }) {
  if (event.ctrlKey || !(twoFingers || now < momentumUntil)) return false
  const held = { shift: event.shiftKey, alt: event.altKey, meta: event.metaKey, ctrl: event.ctrlKey }
  // macOS при зажатом Shift превращает вертикальную прокрутку в горизонтальную
  const swappedByShift = settings.modifier === 'shift' && held.shift
  const vertical = swappedByShift || Math.abs(event.deltaY) >= Math.abs(event.deltaX)
  if (!vertical) return settings.horizontal !== 'off'
  if (settings.vertical === 'off') return false
  // Без модификатора вертикальная прокрутка не гасится — иначе терминал нельзя прокручивать.
  // `engaged` — свайп уже сработал в этом касании: гасим и инерцию, даже если клавишу отпустили.
  return engaged || isModifierHeld(settings.modifier, held, isMac)
}
