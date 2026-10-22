/**
 * Распознаватель свайпа двумя пальцами по потоку касаний (тот же формат кадров, что у
 * `TapGestureRecognizer`: полный набор касаний в момент времени). Чистая логика без DOM/Electron.
 *
 * Один свайп на жест: после срабатывания остальное движение до отпускания всех пальцев
 * игнорируется («один свайп — одна команда»). Направление — куда двигались пальцы.
 * Жест недействителен, если пальцев было не ровно два или они опустились не одновременно.
 */

export const SWIPE_GESTURES = Object.freeze({
  UP: 'swipe-up',
  DOWN: 'swipe-down',
  LEFT: 'swipe-left',
  RIGHT: 'swipe-right'
})

/** Тачпад macOS: координаты нормализованы (0..1), ось Y направлена ВВЕРХ (от нижнего края). */
export const TRACKPAD_SWIPE_PROFILE = Object.freeze({
  threshold: 0.12,
  landMaxMs: 150,
  yUp: true
})

export class SwipeGestureRecognizer {
  /**
   * @param {object} opts
   * @param {typeof TRACKPAD_SWIPE_PROFILE} opts.profile
   * @param {(gesture: string) => void} opts.onGesture
   */
  constructor({ profile, onGesture }) {
    this._p = profile
    this._onGesture = onGesture
    this._s = null
  }

  reset() {
    this._s = null
  }

  /**
   * @param {number} timeMs
   * @param {Array<{ id: number, x: number, y: number }>} contacts
   */
  update(timeMs, contacts) {
    const n = contacts.length
    if (n === 0) {
      this._s = null
      return
    }
    if (!this._s) this._s = { start: timeMs, valid: true, fired: false, origin: null, ids: new Set() }
    const s = this._s
    if (!s.valid || s.fired) return

    for (const c of contacts) s.ids.add(c.id)
    if (s.ids.size > 2 || (n === 1 && s.origin)) {
      // третий палец или один из двух отпущен — центр «прыгает», жест не считаем
      s.valid = false
      return
    }
    if (n < 2) return

    const centroid = this._centroid(contacts)
    if (!s.origin) {
      if (timeMs - s.start > this._p.landMaxMs) {
        s.valid = false
        return
      }
      s.origin = centroid
      return
    }

    const dx = centroid.x - s.origin.x
    const dy = centroid.y - s.origin.y
    if (Math.hypot(dx, dy) < this._p.threshold) return
    s.fired = true
    this._onGesture(this._direction(dx, dy))
  }

  _centroid(contacts) {
    let x = 0
    let y = 0
    for (const c of contacts) {
      x += c.x
      y += c.y
    }
    return { x: x / contacts.length, y: y / contacts.length }
  }

  _direction(dx, dy) {
    if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? SWIPE_GESTURES.LEFT : SWIPE_GESTURES.RIGHT
    const up = this._p.yUp ? dy > 0 : dy < 0
    return up ? SWIPE_GESTURES.UP : SWIPE_GESTURES.DOWN
  }
}
