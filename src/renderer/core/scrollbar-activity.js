import { SCROLLBAR_CONFIG } from './config/scrollbar-config.js'

/**
 * Показывает ползунок скроллбара только во время прокрутки (как оверлейные скроллбары macOS):
 * вешает `.is-scrolling` на прокручиваемый элемент и снимает его после паузы.
 * Событие `scroll` не всплывает, поэтому слушатель стоит на документе в фазе capture —
 * он ловит и динамические контейнеры (диалоги, CodeMirror, xterm viewport).
 */
export class ScrollbarActivity {
  constructor({ doc = document } = {}) {
    this._doc = doc
    /** @type {Map<Element, number>} */
    this._timers = new Map()
    this._onScroll = this._onScroll.bind(this)
    this._doc.addEventListener('scroll', this._onScroll, { capture: true, passive: true })
  }

  _onScroll(e) {
    const target = e.target === this._doc ? this._doc.documentElement : e.target
    if (!(target instanceof Element)) return

    clearTimeout(this._timers.get(target))
    target.classList.add(SCROLLBAR_CONFIG.ACTIVE_CLASS)
    this._timers.set(target, setTimeout(() => {
      target.classList.remove(SCROLLBAR_CONFIG.ACTIVE_CLASS)
      this._timers.delete(target)
    }, SCROLLBAR_CONFIG.HIDE_DELAY_MS))
  }

  destroy() {
    this._doc.removeEventListener('scroll', this._onScroll, { capture: true })
    for (const [el, timer] of this._timers) {
      clearTimeout(timer)
      el.classList.remove(SCROLLBAR_CONFIG.ACTIVE_CLASS)
    }
    this._timers.clear()
  }
}
