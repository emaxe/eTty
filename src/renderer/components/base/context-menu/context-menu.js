/**
 * Простое контекстное меню: show(items, x, y, options) → отображает список действий.
 *
 * item: { label, action, disabled?, danger?, hint? } | { separator: true }
 *   hint — подсказка хоткея справа серым ("⌘E").
 *
 * options.placement: 'below' (default) | 'above' — 'above' растёт вверх от (x,y),
 * с фоллбэком вниз если сверху не помещается (для кнопок у нижнего края экрана,
 * например в статус-баре).
 * options.onClose — вызывается при каждом hide() (в т.ч. закрытие кликом вне меню).
 *
 * Клавиатура: ↑/↓ — навигация по пунктам, Home/End — первый/последний, Enter/Space — выбрать,
 * Esc/Tab — закрыть с возвратом фокуса туда, где он был до открытия меню.
 */
export class ContextMenu {
  constructor() {
    this._el = null
    this._onCloseCb = null
    this._opener = null
    this._onDocClick = this._onDocClick.bind(this)
    this._onKeyDown = this._onKeyDown.bind(this)
  }

  show(items, x, y, options = {}) {
    this.hide()
    this._onCloseCb = options.onClose || null
    this._opener = document.activeElement

    const menu = document.createElement('div')
    menu.className = 'context-menu'
    menu.setAttribute('role', 'menu')
    menu.tabIndex = -1

    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div')
        sep.className = 'context-menu-separator'
        sep.setAttribute('role', 'separator')
        menu.appendChild(sep)
        continue
      }
      const el = document.createElement('div')
      el.className = 'context-menu-item'
      el.setAttribute('role', 'menuitem')

      const label = document.createElement('span')
      label.className = 'context-menu-label'
      label.textContent = item.label
      el.appendChild(label)

      if (item.hint) {
        const hint = document.createElement('span')
        hint.className = 'context-menu-hint'
        hint.textContent = item.hint
        el.appendChild(hint)
      }
      if (item.danger) el.classList.add('danger')

      if (item.disabled) {
        el.classList.add('disabled')
        el.setAttribute('aria-disabled', 'true')
        el.addEventListener('click', (e) => e.stopPropagation())
      } else {
        el.tabIndex = -1
        el.addEventListener('click', () => {
          this.hide()
          item.action()
        })
        el.addEventListener('mousemove', () => {
          if (document.activeElement !== el) el.focus({ preventScroll: true })
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

    // Фокус в меню, чтобы работала клавиатура; на первый пункт — только если меню открыто с клавиатуры
    menu.focus({ preventScroll: true })
    document.addEventListener('keydown', this._onKeyDown, true)
    setTimeout(() => document.addEventListener('click', this._onDocClick), 0)
  }

  hide() {
    const onClose = this._onCloseCb
    this._onCloseCb = null
    const opener = this._opener
    this._opener = null
    if (this._el) {
      this._el.remove()
      this._el = null
      if (opener && document.contains(opener) && typeof opener.focus === 'function') {
        opener.focus({ preventScroll: true })
      }
    }
    document.removeEventListener('click', this._onDocClick)
    document.removeEventListener('keydown', this._onKeyDown, true)
    onClose?.()
  }

  destroy() {
    this.hide()
    this._onDocClick = null
    this._onKeyDown = null
  }

  _items() {
    return this._el ? [...this._el.querySelectorAll('.context-menu-item:not(.disabled)')] : []
  }

  _onKeyDown(e) {
    if (!this._el) return
    const items = this._items()
    const current = items.indexOf(document.activeElement)

    switch (e.key) {
      case 'Escape':
      case 'Tab':
        e.preventDefault()
        e.stopPropagation()
        this.hide()
        return
      case 'ArrowDown':
        e.preventDefault()
        e.stopPropagation()
        items[(current + 1) % items.length]?.focus()
        return
      case 'ArrowUp':
        e.preventDefault()
        e.stopPropagation()
        items[(current <= 0 ? items.length : current) - 1]?.focus()
        return
      case 'Home':
        e.preventDefault()
        items[0]?.focus()
        return
      case 'End':
        e.preventDefault()
        items[items.length - 1]?.focus()
        return
      case 'Enter':
      case ' ':
        if (current !== -1) {
          e.preventDefault()
          e.stopPropagation()
          items[current].click()
        }
        return
    }
  }

  _onDocClick(e) {
    if (this._el && !this._el.contains(e.target)) {
      this.hide()
    }
  }
}
