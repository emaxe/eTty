import { Modal } from '../../components/base/modal/modal.js'
import { Button } from '../../components/base/button/button.js'

const MIN_PASSPHRASE_LENGTH = 8

/**
 * Диалоги резервной копии настроек (`*.ettybackup`):
 *  - `openExport()` — опциональные SSH-подключения; парольная фраза требуется только вместе с ними
 *    (файл тогда шифруется, см. `main/backup/backup-format.js`);
 *  - `openPassphrase()` — ввод пароля для зашифрованного файла при импорте;
 *  - `openResult()` — итог импорта с предупреждениями и единственным действием «Перезапустить»
 *    (без перезапуска живой renderer перезаписал бы импортированный конфиг своей копией).
 */
export class BackupDialog {
  constructor() {
    this._modal = null
    this._resolve = null
  }

  /**
   * @param {{ proxyHasCredentials?: boolean }} [opts] — подсказка про незашифрованный прокси-URL
   *   с логином/паролем
   * @returns {Promise<{ includeConnections: boolean, includePrivateKeys: boolean, passphrase: string } | null>}
   */
  openExport({ proxyHasCredentials = false } = {}) {
    if (this._modal) return Promise.resolve(null)

    const modal = this._createModal({ title: 'Экспорт настроек', size: 'md' })
    const body = document.createElement('div')
    body.className = 'settings-dialog-body'

    const connectionsRow = this._createToggleRow('Включить SSH-подключения', false)
    body.appendChild(connectionsRow.row)

    const keysRow = this._createToggleRow('Включить приватные ключи в файл', false)
    keysRow.row.hidden = true
    body.appendChild(keysRow.row)

    const keysHint = this._createHint(
      'Без этого профили с authType «key» экспортируются без содержимого ключа — их нужно будет донастроить вручную.'
    )
    keysHint.hidden = true
    body.appendChild(keysHint)

    const passField = this._createPasswordField('Парольная фраза')
    passField.field.hidden = true
    body.appendChild(passField.field)

    const confirmField = this._createPasswordField('Повторите парольную фразу')
    confirmField.field.hidden = true
    body.appendChild(confirmField.field)

    const securityHint = this._createHint(
      'Файл будет зашифрован парольной фразой (PBKDF2 + AES-256-GCM).'
    )
    securityHint.hidden = true
    body.appendChild(securityHint)

    const proxyHint = this._createHint(
      'Прокси-URL ИИ-агентов содержит логин и пароль — без шифрования они попадут в файл открыто.'
    )
    proxyHint.hidden = !proxyHasCredentials
    body.appendChild(proxyHint)

    const errorEl = document.createElement('div')
    errorEl.className = 'settings-dialog-error'
    errorEl.hidden = true
    body.appendChild(errorEl)
    modal.body.appendChild(body)

    connectionsRow.input.addEventListener('change', () => {
      const on = connectionsRow.input.checked
      keysRow.row.hidden = !on
      keysHint.hidden = !on
      passField.field.hidden = !on
      confirmField.field.hidden = !on
      securityHint.hidden = !on
      proxyHint.hidden = on || !proxyHasCredentials
      errorEl.hidden = true
    })

    const cancelBtn = new Button({ variant: 'default', label: 'Отмена', onClick: () => this._settle(null) })
    const exportBtn = new Button({ variant: 'primary', label: 'Экспортировать', onClick: () => submit() })
    modal.footer.append(cancelBtn.element, exportBtn.element)

    const submit = () => {
      const includeConnections = connectionsRow.input.checked
      if (!includeConnections) {
        this._settle({ includeConnections: false, includePrivateKeys: false, passphrase: '' })
        return
      }
      if (passField.input.value.length < MIN_PASSPHRASE_LENGTH) {
        this._showError(errorEl, `Парольная фраза должна быть не короче ${MIN_PASSPHRASE_LENGTH} символов`)
        return
      }
      if (passField.input.value !== confirmField.input.value) {
        this._showError(errorEl, 'Парольные фразы не совпадают')
        return
      }
      this._settle({
        includeConnections: true,
        includePrivateKeys: keysRow.input.checked,
        passphrase: passField.input.value,
      })
    }

    return this._open(modal, connectionsRow.input)
  }

  /** @returns {Promise<string | null>} */
  openPassphrase(initialError = '') {
    if (this._modal) return Promise.resolve(null)

    const modal = this._createModal({ title: 'Импорт настроек', size: 'sm' })
    const body = document.createElement('div')
    body.className = 'settings-dialog-body'

    const passField = this._createPasswordField('Парольная фраза')
    body.appendChild(passField.field)

    const errorEl = document.createElement('div')
    errorEl.className = 'settings-dialog-error'
    errorEl.textContent = initialError
    errorEl.hidden = !initialError
    body.appendChild(errorEl)
    modal.body.appendChild(body)

    const cancelBtn = new Button({ variant: 'default', label: 'Отмена', onClick: () => this._settle(null) })
    const submitBtn = new Button({ variant: 'primary', label: 'Импортировать', onClick: () => submit() })
    modal.footer.append(cancelBtn.element, submitBtn.element)

    const submit = () => {
      const value = passField.input.value
      if (!value) {
        this._showError(errorEl, 'Введите парольную фразу')
        return
      }
      this._settle(value)
    }

    return this._open(modal, passField.input)
  }

  /**
   * @param {{ message: string, warnings?: string[] }} opts
   * @returns {Promise<void>}
   */
  openResult({ message, warnings = [] }) {
    if (this._modal) return Promise.resolve()

    const modal = this._createModal({
      title: 'Настройки импортированы',
      size: 'md',
      showClose: false,
      closeOnBackdrop: false,
      closeOnEscape: false,
    })

    const text = document.createElement('div')
    text.className = 'settings-backup-message'
    text.textContent = message
    modal.body.appendChild(text)

    if (warnings.length > 0) {
      const list = document.createElement('ul')
      list.className = 'settings-backup-warnings'
      for (const warning of warnings) {
        const item = document.createElement('li')
        item.textContent = warning
        list.appendChild(item)
      }
      modal.body.appendChild(list)
    }

    const restartBtn = new Button({
      variant: 'primary',
      label: 'Перезапустить',
      onClick: () => this._settle(true),
    })
    modal.footer.append(restartBtn.element)

    return this._open(modal)
  }

  destroy() {
    this._settle(null)
  }

  _createModal(options) {
    return new Modal({
      ...options,
      onClose: () => this._settle(null),
    })
  }

  _open(modal, initialFocus = null) {
    this._modal = modal
    // Enter в любом поле = основное действие диалога (как в остальных диалогах приложения)
    modal.dialog.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return
      const primary = modal.footer.querySelector('.btn--primary')
      if (!primary) return
      e.preventDefault()
      primary.click()
    })
    return new Promise((resolve) => {
      this._resolve = resolve
      modal.open({ initialFocus })
    })
  }

  /** Завершает текущий диалог: один resolve и одно закрытие, без рекурсии через onClose. */
  _settle(value) {
    const modal = this._modal
    if (!modal) return
    this._modal = null
    const resolve = this._resolve
    this._resolve = null
    modal.destroy()
    resolve?.(value)
  }

  _createToggleRow(labelText, value) {
    const row = document.createElement('div')
    row.className = 'settings-dialog-row'

    const label = document.createElement('span')
    label.textContent = labelText

    const toggle = document.createElement('label')
    toggle.className = 'settings-toggle'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = value
    const track = document.createElement('span')
    track.className = 'settings-toggle-track'
    toggle.append(input, track)

    row.append(label, toggle)
    return { row, input }
  }

  _createPasswordField(labelText) {
    const field = document.createElement('div')
    field.className = 'settings-dialog-field'

    const label = document.createElement('label')
    label.textContent = labelText

    const input = document.createElement('input')
    input.type = 'password'
    input.className = 'settings-input'
    input.autocomplete = 'off'

    field.append(label, input)
    return { field, input }
  }

  _createHint(text) {
    const hint = document.createElement('div')
    hint.className = 'settings-dialog-hint'
    hint.textContent = text
    return hint
  }

  _showError(el, text) {
    el.textContent = text
    el.hidden = false
  }
}
