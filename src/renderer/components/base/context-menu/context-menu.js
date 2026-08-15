/**
 * Простое контекстное меню: show(items, x, y, options) → отображает список действий.
 * options.placement: 'below' (default) | 'above' — 'above' растёт вверх от (x,y),
 * с фоллбэком вниз если сверху не помещается (для кнопок у нижнего края экрана,
 * например в статус-баре).
 * options.onClose — вызывается при каждом hide() (в т.ч. закрытие кликом вне меню).
 */
export class ContextMenu {
  constructor() {
    this._el = null
    this._onCloseCb = null
    this._onDocClick = this._onDocClick.bind(this)
  }

  show(items, x, y, options = {}) {
    this.hide()
    this._onCloseCb = options.onClose || null

    const menu = document.createElement('div')
    menu.className = 'context-menu'

    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div')
        sep.className = 'context-menu-separator'
        menu.appendChild(sep)
        continue
      }
      const el = document.createElement('div')
      el.className = 'context-menu-item'
      el.textContent = item.label
      if (item.disabled) {
        el.classList.add('disabled')
        el.addEventListener('click', (e) => e.stopPropagation())
      } else {
        el.addEventListener('click', () => {
          this.hide()
          item.action()
        })
      }
      menu.appendChild(el)
    }

    document.body.appendChild(menu)
    this._el = menu

    // Position — keep inside viewport
    const rect = menu.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (x + rect.width > vw) x = vw - rect.width - 4
    if (x < 4) x = 4

    let top = options.placement === 'above' ? y - rect.height : y
    if (options.placement === 'above' && top < 4) {
      // Not enough room above the anchor — fall back below it instead
      top = Math.min(y, vh - rect.height - 4)
    } else if (options.placement !== 'above' && top + rect.height > vh) {
      top = vh - rect.height - 4
    }
    if (top < 4) top = 4

    menu.style.left = `${x}px`
    menu.style.top = `${top}px`

    setTimeout(() => document.addEventListener('click', this._onDocClick), 0)
  }

  hide() {
    const onClose = this._onCloseCb
    this._onCloseCb = null
    if (this._el) {
      this._el.remove()
      this._el = null
    }
    document.removeEventListener('click', this._onDocClick)
    onClose?.()
  }

  destroy() {
    this.hide()
    this._onDocClick = null
  }

  _onDocClick(e) {
    if (this._el && !this._el.contains(e.target)) {
      this.hide()
    }
  }
}
