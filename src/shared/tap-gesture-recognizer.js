/**
 * Распознаватель «тап N пальцами» и «двойной тап N пальцами» по потоку касаний.
 * Чистая логика без DOM/Electron: на вход — полный набор касаний в момент времени, поэтому один
 * и тот же код работает для сырых касаний тачпада (main, нормализованные координаты 0..1) и для
 * сенсорного экрана (renderer, пиксели) — различаются только профили порогов.
 *
 * Тап — это касание 2–3 пальцев, которые опустились почти одновременно, почти не сдвинулись и
 * были отпущены быстро. Источник — именно касания, а не клики мыши: они приходят независимо от
 * настройки macOS «Касание для имитации нажатия».
 */

export const TAP_GESTURES = Object.freeze({
  TWO_FINGER_DOUBLE_TAP: 'two-finger-double-tap',
  THREE_FINGER_DOUBLE_TAP: 'three-finger-double-tap'
})

const GESTURE_BY_FINGERS = Object.freeze({
  2: TAP_GESTURES.TWO_FINGER_DOUBLE_TAP,
  3: TAP_GESTURES.THREE_FINGER_DOUBLE_TAP
})

const MAX_FINGERS = 3

/** Профиль для тачпада: координаты нормализованы (0..1 по ширине/высоте площадки). */
export const TRACKPAD_TAP_PROFILE = Object.freeze({
  slop: 0.05,
  doubleSlop: 0.25,
  tapMaxMs: 300,
  landMaxMs: 120,
  doubleGapMs: 350
})

/** Профиль для сенсорного экрана: координаты в пикселях. */
export const TOUCHSCREEN_TAP_PROFILE = Object.freeze({
  slop: 16,
  doubleSlop: 80,
  tapMaxMs: 300,
  landMaxMs: 150,
  doubleGapMs: 400
})

export class TapGestureRecognizer {
  /**
   * @param {object} opts
   * @param {typeof TRACKPAD_TAP_PROFILE} opts.profile
   * @param {(gesture: string) => void} opts.onGesture
   */
  constructor({ profile, onGesture }) {
    this._p = profile
    this._onGesture = onGesture
    this._cur = null
    this._lastTap = null
  }

  reset() {
    this._cur = null
    this._lastTap = null
  }

  /**
   * @param {number} timeMs — монотонное время кадра, мс
   * @param {Array<{ id: number, x: number, y: number }>} contacts — все касания в этот момент
   */
  update(timeMs, contacts) {
    const n = contacts.length
    if (n === 0) {
      this._finish(timeMs)
      return
    }
    if (!this._cur) {
      this._cur = { start: timeMs, peak: 0, valid: true, origin: new Map() }
    }
    const cur = this._cur
    for (const c of contacts) {
      if (!cur.origin.has(c.id)) {
        cur.origin.set(c.id, { x: c.x, y: c.y })
        if (cur.origin.size > 1 && timeMs - cur.start > this._p.landMaxMs) cur.valid = false
      } else {
        const o = cur.origin.get(c.id)
        if (Math.hypot(c.x - o.x, c.y - o.y) > this._p.slop) cur.valid = false
      }
    }
    cur.peak = Math.max(cur.peak, n)
    if (cur.peak > MAX_FINGERS || timeMs - cur.start > this._p.tapMaxMs) cur.valid = false
  }

  _finish(timeMs) {
    const cur = this._cur
    this._cur = null
    if (!cur) return
    const isTap = cur.valid && cur.peak >= 2 && timeMs - cur.start <= this._p.tapMaxMs
    if (!isTap) {
      this._lastTap = null
      return
    }

    let sx = 0
    let sy = 0
    for (const o of cur.origin.values()) {
      sx += o.x
      sy += o.y
    }
    const tap = { fingers: cur.peak, start: cur.start, end: timeMs, x: sx / cur.origin.size, y: sy / cur.origin.size }

    const prev = this._lastTap
    const isSecond = prev &&
      prev.fingers === tap.fingers &&
      tap.start - prev.end <= this._p.doubleGapMs &&
      Math.hypot(tap.x - prev.x, tap.y - prev.y) <= this._p.doubleSlop
    if (isSecond) {
      this._lastTap = null
      this._onGesture(GESTURE_BY_FINGERS[tap.fingers])
    } else {
      this._lastTap = tap
    }
  }
}
