import {
  TapGestureRecognizer,
  TOUCHSCREEN_TAP_PROFILE
} from '../../../shared/tap-gesture-recognizer.js'

/**
 * Жесты радиального меню для сенсорного экрана: касания (Pointer Events, pointerType=touch) на
 * элементе терминала кормят общий `TapGestureRecognizer`. Жесты тачпада macOS приходят из main
 * (см. trackpad-gesture-service.js) — DOM их не видит. Ничего не перехватывает и не блокирует.
 */
export class TouchGestureDetector {
  /**
   * @param {object} opts
   * @param {() => { enabled: boolean }} opts.getSettings
   * @param {(gesture: string, point: { x: number, y: number }) => void} opts.onGesture
   */
  constructor({ getSettings, onGesture }) {
    this._getSettings = getSettings
    this._point = { x: 0, y: 0 }
    this._contacts = new Map()
    this._el = null
    this._recognizer = new TapGestureRecognizer({
      profile: TOUCHSCREEN_TAP_PROFILE,
      onGesture: (gesture) => onGesture(gesture, this._point)
    })
    this._onDown = (e) => this._track(e, true)
    this._onMove = (e) => this._track(e, true)
    this._onEnd = (e) => this._track(e, false)
  }

  attach(el) {
    this.detach()
    if (!el) return
    this._el = el
    el.addEventListener('pointerdown', this._onDown, true)
    el.addEventListener('pointermove', this._onMove, true)
    el.addEventListener('pointerup', this._onEnd, true)
    el.addEventListener('pointercancel', this._onEnd, true)
  }

  detach() {
    if (this._el) {
      this._el.removeEventListener('pointerdown', this._onDown, true)
      this._el.removeEventListener('pointermove', this._onMove, true)
      this._el.removeEventListener('pointerup', this._onEnd, true)
      this._el.removeEventListener('pointercancel', this._onEnd, true)
      this._el = null
    }
    this._contacts.clear()
    this._recognizer.reset()
  }

  _track(e, down) {
    if (e.pointerType !== 'touch' || !this._getSettings()?.enabled) return
    if (down) this._contacts.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY })
    else this._contacts.delete(e.pointerId)
    this._point = { x: e.clientX, y: e.clientY }
    this._recognizer.update(e.timeStamp, [...this._contacts.values()])
  }
}
