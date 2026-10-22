import { SWIPE_GESTURES } from '../../../shared/swipe-gesture-recognizer.js'
import { SWIPE_CONFIG } from '../../core/config/swipe-config.js'

const ARROW_SVG =
  '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" ' +
  'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>'

// Поворот стрелки «вверх» и сдвиг вспышки по направлению свайпа
const DIRECTIONS = Object.freeze({
  [SWIPE_GESTURES.UP]: { rotate: 0, dx: 0, dy: -1 },
  [SWIPE_GESTURES.RIGHT]: { rotate: 90, dx: 1, dy: 0 },
  [SWIPE_GESTURES.DOWN]: { rotate: 180, dx: 0, dy: 1 },
  [SWIPE_GESTURES.LEFT]: { rotate: 270, dx: -1, dy: 0 }
})

/**
 * Вспышка стрелки в центре терминала: подтверждает, какой свайп сработал.
 * Не перехватывает мышь, каждая новая вспышка заменяет предыдущую.
 */
export class SwipeFlash {
  /** @param {{ containerEl: HTMLElement }} opts — позиционированный контейнер терминалов */
  constructor({ containerEl }) {
    this._containerEl = containerEl
    this._el = null
  }

  /** @param {string} gesture — одно из SWIPE_GESTURES */
  show(gesture) {
    const dir = DIRECTIONS[gesture]
    if (!dir) return
    this._remove()

    const el = document.createElement('div')
    el.className = 'swipe-flash'
    el.style.setProperty('--swipe-dx', `${dir.dx * SWIPE_CONFIG.FLASH_TRAVEL_PX}px`)
    el.style.setProperty('--swipe-dy', `${dir.dy * SWIPE_CONFIG.FLASH_TRAVEL_PX}px`)
    el.style.setProperty('--swipe-ms', `${SWIPE_CONFIG.FLASH_MS}ms`)
    el.innerHTML = ARROW_SVG
    el.firstElementChild.style.transform = `rotate(${dir.rotate}deg)`
    el.addEventListener('animationend', () => this._remove(el))
    this._containerEl.appendChild(el)
    this._el = el
  }

  _remove(el = this._el) {
    el?.remove()
    if (el === this._el) this._el = null
  }

  destroy() {
    this._remove()
    this._containerEl = null
  }
}
