/**
 * Modal — единый диалог приложения и общий «движок» для остальных модальных окон.
 *
 * Что даёт:
 *  - стек окон: Esc закрывает только верхнее, фокус не уходит под него;
 *  - фокус-трап (Tab/Shift+Tab циклично внутри окна) и возврат фокуса на прежний элемент;
 *  - закрытие по клику на фон (опционально);
 *  - один слой (--z-modal), один scrim (--scrim), одна тень (--shadow-float).
 *
 * Два способа использования:
 *
 * 1. Готовое окно (заголовок, тело, подвал):
 *      const modal = new Modal({ title: 'Подключение', size: 'md', onClose })
 *      modal.body.append(form)
 *      modal.footer.append(cancelBtn.element, saveBtn.element)
 *      modal.open()
 *
 * 2. Сложные окна со своей разметкой (поиск, менеджер версий) подключаются к тому же стеку:
 *      const release = registerModal(overlayEl, dialogEl, { onClose: () => this.hide() })
 *      ... release() при закрытии
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

/** @type {Array<{ overlay: HTMLElement, dialog: HTMLElement, onClose: Function|null, escape: boolean, backdrop: boolean, opener: Element|null }>} */
const stack = []

function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement)
}

function onKeyDown(e) {
  const top = stack[stack.length - 1]
  if (!top) return

  if (e.key === 'Escape' && top.escape) {
    e.preventDefault()
    e.stopPropagation()
    top.onClose?.('escape')
    return
  }

  if (e.key === 'Tab') {
    const items = focusables(top.dialog)
    if (items.length === 0) {
      e.preventDefault()
      top.dialog.focus()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (!top.dialog.contains(active)) {
      e.preventDefault()
      first.focus()
    } else if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }
}

/**
 * Подключает уже построенное окно к стеку модальных окон.
 *
 * @param {HTMLElement} overlay затемняющий фон
 * @param {HTMLElement} dialog само окно (внутри overlay)
 * @param {Object} [opts]
 * @param {(reason: 'escape'|'backdrop') => void} [opts.onClose] вызывается при Esc / клике по фону
 * @param {boolean} [opts.escape=true] закрывать по Esc (false — если окно обрабатывает Esc само)
 * @param {boolean} [opts.backdrop=true] закрывать по клику на фон
 * @param {HTMLElement|null} [opts.initialFocus] что сфокусировать при открытии
 * @returns {() => void} снять окно со стека и вернуть фокус
 */
export function registerModal(overlay, dialog, opts = {}) {
  const { onClose = null, escape = true, backdrop = true, initialFocus = null } = opts
  const entry = {
    overlay,
    dialog,
    onClose,
    escape,
    backdrop,
    opener: document.activeElement
  }
  const onBackdrop = (e) => {
    if (e.target === overlay && entry.backdrop) onClose?.('backdrop')
  }
  overlay.addEventListener('mousedown', onBackdrop)

  if (stack.length === 0) document.addEventListener('keydown', onKeyDown, true)
  stack.push(entry)

  if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1')
  const target = initialFocus || focusables(dialog)[0] || dialog
  // Фокус после того, как окно стало видимым
  requestAnimationFrame(() => target.focus())

  return () => {
    const i = stack.indexOf(entry)
    if (i === -1) return
    stack.splice(i, 1)
    overlay.removeEventListener('mousedown', onBackdrop)
    if (stack.length === 0) document.removeEventListener('keydown', onKeyDown, true)
    if (entry.opener && document.contains(entry.opener) && typeof entry.opener.focus === 'function') {
      entry.opener.focus()
    }
  }
}

/** Открыто ли хотя бы одно модальное окно (для глобальных хоткеев). */
export function hasOpenModal() {
  return stack.length > 0
}

export class Modal {
  /**
   * @param {Object} options
   * @param {string} [options.title='']
   * @param {'sm'|'md'|'lg'|'xl'} [options.size='md'] — 360 / 480 / 640 / 880 px
   * @param {boolean} [options.closeOnBackdrop=true]
   * @param {boolean} [options.closeOnEscape=true]
   * @param {boolean} [options.showClose=true] — крестик в заголовке
   * @param {string} [options.className=''] — дополнительный класс окна
   * @param {(reason: string) => void} [options.onClose] — после закрытия
   */
  constructor(options = {}) {
    const {
      title = '',
      size = 'md',
      closeOnBackdrop = true,
      closeOnEscape = true,
      showClose = true,
      className = '',
      onClose = null
    } = options

    this._onClose = onClose
    this._closeOnBackdrop = closeOnBackdrop
    this._closeOnEscape = closeOnEscape
    this._release = null
    this._isOpen = false

    this.element = document.createElement('div')
    this.element.className = 'modal-overlay hidden'

    this.dialog = document.createElement('div')
    this.dialog.className = `modal modal--${size}${className ? ' ' + className : ''}`
    this.dialog.setAttribute('role', 'dialog')
    this.dialog.setAttribute('aria-modal', 'true')

    this.header = document.createElement('div')
    this.header.className = 'modal__header'
    this._titleEl = document.createElement('h2')
    this._titleEl.className = 'modal__title'
    this._titleEl.id = `modal-title-${Math.random().toString(36).slice(2, 9)}`
    this._titleEl.textContent = title
    this.dialog.setAttribute('aria-labelledby', this._titleEl.id)
    this.header.appendChild(this._titleEl)

    if (showClose) {
      this._closeBtn = document.createElement('button')
      this._closeBtn.type = 'button'
      this._closeBtn.className = 'modal__close'
      this._closeBtn.title = 'Закрыть'
      this._closeBtn.setAttribute('aria-label', 'Закрыть')
      this._closeBtn.textContent = '×'
      this._closeBtn.addEventListener('click', () => this.close('button'))
      this.header.appendChild(this._closeBtn)
    }

    this.body = document.createElement('div')
    this.body.className = 'modal__body'

    this.footer = document.createElement('div')
    this.footer.className = 'modal__footer'

    this.dialog.append(this.header, this.body, this.footer)
    this.element.appendChild(this.dialog)
    document.body.appendChild(this.element)
  }

  get isOpen() {
    return this._isOpen
  }

  setTitle(text) {
    this._titleEl.textContent = text
  }

  /**
   * @param {Object} [opts]
   * @param {HTMLElement|null} [opts.initialFocus] элемент для начального фокуса (по умолчанию — первый фокусируемый)
   */
  open({ initialFocus = null } = {}) {
    if (this._isOpen) return
    this._isOpen = true
    this.footer.hidden = this.footer.childElementCount === 0
    this.element.classList.remove('hidden')
    this._release = registerModal(this.element, this.dialog, {
      escape: this._closeOnEscape,
      backdrop: this._closeOnBackdrop,
      initialFocus,
      onClose: (reason) => this.close(reason)
    })
  }

  close(reason = 'api') {
    if (!this._isOpen) return
    this._isOpen = false
    this.element.classList.add('hidden')
    this._release?.()
    this._release = null
    this._onClose?.(reason)
  }

  destroy() {
    if (this._isOpen) this.close('destroy')
    this.element?.remove()
    this.element = null
    this._onClose = null
  }
}
