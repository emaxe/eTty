/**
 * ConfirmDialog — переиспользуемый промис-модальный диалог подтверждения.
 * Следует паттерну overlay (см. NodeVersionDialog / ProjectSearchDialog):
 * `_buildDOM` / `show`-`hide` / `.hidden` / `isVisible` / `_onKeyDown` / `destroy`.
 *
 * Использование:
 *   const confirmed = await confirmDialog.open({
 *     title: 'Закрыть вкладку?',
 *     message: 'В этой вкладке выполняется активный процесс. Закрыть вкладку?',
 *   })
 *
 * Одновременно поддерживается только одно открытое окно: повторный вызов `open()`
 * пока диалог уже открыт возвращает `false` без наложения окон.
 */
export class ConfirmDialog {
  constructor() {
    this._overlay = null
    this._isVisible = false
    this._boundKeyDown = this._onKeyDown.bind(this)
    this._resolve = null

    this._buildDOM()
  }

  _buildDOM() {
    const overlay = document.createElement('div')
    overlay.className = 'confirm-dialog-overlay hidden'
    overlay.innerHTML = `
      <div class="confirm-dialog">
        <div class="confirm-dialog-header"></div>
        <div class="confirm-dialog-message"></div>
        <div class="confirm-dialog-actions">
          <button class="confirm-dialog-btn" data-action="cancel"></button>
          <button class="confirm-dialog-btn danger" data-action="confirm"></button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)

    this._overlay = overlay
    this._headerEl = overlay.querySelector('.confirm-dialog-header')
    this._messageEl = overlay.querySelector('.confirm-dialog-message')
    this._cancelBtn = overlay.querySelector('[data-action="cancel"]')
    this._confirmBtn = overlay.querySelector('[data-action="confirm"]')

    this._cancelBtn.addEventListener('click', () => this._settle(false))
    this._confirmBtn.addEventListener('click', () => this._settle(true))

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this._settle(false)
    })
  }

  /**
   * Открывает диалог и возвращает Promise<boolean> — true при подтверждении,
   * false при отмене (кнопка, Escape, клик по фону).
   * @param {Object} opts
   * @param {string} opts.title
   * @param {string} opts.message
   * @param {string} [opts.confirmText='Закрыть']
   * @param {string} [opts.cancelText='Отмена']
   * @returns {Promise<boolean>}
   */
  open({ title, message, confirmText = 'Закрыть', cancelText = 'Отмена' }) {
    if (this._isVisible) return Promise.resolve(false)

    this._headerEl.textContent = title
    this._messageEl.textContent = message
    this._cancelBtn.textContent = cancelText
    this._confirmBtn.textContent = confirmText

    this._isVisible = true
    this._overlay.classList.remove('hidden')
    document.addEventListener('keydown', this._boundKeyDown)

    // Безопасный дефолт фокуса — на кнопке отмены (деструктивное действие не по умолчанию)
    this._cancelBtn.focus()

    return new Promise((resolve) => {
      this._resolve = resolve
    })
  }

  isVisible() {
    return this._isVisible
  }

  _settle(result) {
    if (!this._isVisible) return
    this._isVisible = false
    this._overlay.classList.add('hidden')
    document.removeEventListener('keydown', this._boundKeyDown)
    const resolve = this._resolve
    this._resolve = null
    resolve?.(result)
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      this._settle(false)
    }
  }

  destroy() {
    document.removeEventListener('keydown', this._boundKeyDown)
    if (this._resolve) this._settle(false)
    if (this._overlay) {
      this._overlay.remove()
      this._overlay = null
    }
  }
}
