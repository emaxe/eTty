/**
 * Base Button component.
 *
 * @example
 * const btn = new Button({
 *   variant: 'primary',
 *   size: 'md',
 *   label: 'Save',
 *   onClick: () => saveFile(),
 *   icon: '<svg>...</svg>'
 * })
 * document.body.appendChild(btn.element)
 */
export class Button {
  /**
   * @param {Object} options
   * @param {'default'|'primary'|'danger'|'ghost'} [options.variant='default']
   * @param {'sm'|'md'|'lg'} [options.size='md']
   * @param {string} [options.label='']
   * @param {string|null} [options.icon=null] — SVG string or null. Must be trusted/sanitized SVG.
   * @param {Function|null} [options.onClick=null]
   * @param {boolean} [options.disabled=false]
   * @param {string} [options.title='']
   */
  constructor(options = {}) {
    const {
      variant = 'default',
      size = 'md',
      label = '',
      icon = null,
      onClick = null,
      disabled = false,
      title = '',
    } = options

    this._onClick = onClick

    this.element = document.createElement('button')
    this.element.className = `btn btn--${variant} btn--${size}`
    this.element.type = 'button'
    if (title) this.element.title = title

    if (icon) {
      const iconWrap = document.createElement('span')
      iconWrap.className = 'btn__icon'
      iconWrap.innerHTML = icon
      this.element.appendChild(iconWrap)
    }

    if (label) {
      const text = document.createElement('span')
      text.className = 'btn__label'
      text.textContent = label
      this.element.appendChild(text)
      this._labelEl = text
    }

    this.setDisabled(disabled)

    if (onClick) {
      this._clickHandler = (e) => {
        if (!this.element.disabled) onClick(e)
      }
      this.element.addEventListener('click', this._clickHandler)
    }
  }

  setDisabled(value) {
    this.element.disabled = !!value
    this.element.classList.toggle('disabled', !!value)
  }

  setLoading(value) {
    this.element.classList.toggle('loading', !!value)
    this.setDisabled(!!value)
  }

  setLabel(text) {
    if (this._labelEl) this._labelEl.textContent = text
  }

  destroy() {
    if (this._clickHandler) {
      this.element.removeEventListener('click', this._clickHandler)
      this._clickHandler = null
    }
    this.element.remove()
    this.element = null
    this._onClick = null
  }
}
