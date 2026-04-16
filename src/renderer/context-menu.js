export class ContextMenu {
  constructor() {
    this._el = null
    this._onDocClick = this._onDocClick.bind(this)
  }

  show(items, x, y) {
    this.hide()

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
      el.addEventListener('click', () => {
        this.hide()
        item.action()
      })
      menu.appendChild(el)
    }

    document.body.appendChild(menu)
    this._el = menu

    // Position — keep inside viewport
    const rect = menu.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (x + rect.width > vw) x = vw - rect.width - 4
    if (y + rect.height > vh) y = vh - rect.height - 4
    menu.style.left = `${x}px`
    menu.style.top = `${y}px`

    setTimeout(() => document.addEventListener('click', this._onDocClick), 0)
  }

  hide() {
    if (this._el) {
      this._el.remove()
      this._el = null
    }
    document.removeEventListener('click', this._onDocClick)
  }

  _onDocClick(e) {
    if (this._el && !this._el.contains(e.target)) {
      this.hide()
    }
  }
}
