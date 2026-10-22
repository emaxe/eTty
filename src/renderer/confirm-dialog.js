import { Modal } from './components/base/modal/modal.js'
import { Button } from './components/base/button/button.js'

/**
 * ConfirmDialog — переиспользуемый промис-диалог подтверждения на базе Modal.
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
    this._resolve = null

    this._modal = new Modal({
      size: 'sm',
      showClose: false,
      className: 'confirm-dialog',
      onClose: () => this._settle(false)
    })

    this._messageEl = document.createElement('p')
    this._messageEl.className = 'confirm-dialog__message'
    this._modal.body.appendChild(this._messageEl)

    this._cancelBtn = new Button({ variant: 'default', label: 'Отмена', onClick: () => this._modal.close('cancel') })
    this._confirmBtn = new Button({ variant: 'danger', label: 'Закрыть', onClick: () => this._confirm() })
    this._modal.footer.append(this._cancelBtn.element, this._confirmBtn.element)
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
    if (this._modal.isOpen) return Promise.resolve(false)

    this._modal.setTitle(title)
    this._messageEl.textContent = message
    this._cancelBtn.setLabel(cancelText)
    this._confirmBtn.setLabel(confirmText)

    return new Promise((resolve) => {
      this._resolve = resolve
      // Безопасный дефолт фокуса — на кнопке отмены (деструктивное действие не по умолчанию)
      this._modal.open({ initialFocus: this._cancelBtn.element })
    })
  }

  isVisible() {
    return this._modal.isOpen
  }

  _confirm() {
    this._settle(true)
    this._modal.close('confirm')
  }

  _settle(result) {
    const resolve = this._resolve
    this._resolve = null
    resolve?.(result)
  }

  destroy() {
    this._modal.destroy()
    this._settle(false)
  }
}
