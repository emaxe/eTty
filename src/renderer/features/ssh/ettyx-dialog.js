import { registerModal } from '../../components/base/modal/modal.js'
/**
 * Модальный диалог переноса профилей (`*.ettyx`, задача #31, REQ-22/23). Два режима:
 *   - `openExport()` — парольная фраза + опциональный чекбокс «включить приватные ключи»
 *     (снят по умолчанию — сам ключ не покидает диск без явного согласия, см. риск
 *     «экспорт приватных ключей» в `docs/plans/mob/plan.md`);
 *   - `openImport()` — только парольная фраза (файл уже выбран системным диалогом до вызова).
 * Тот же паттерн, что `SshConnectionDialog`: чистый UI, promise-based open()/`_settle`,
 * переиспользует `.settings-dialog*` CSS.
 */
export class EttyxDialog {
  constructor() {
    this._resolve = null
    this._overlay = null
  }

  /** @returns {Promise<{ passphrase: string, includePrivateKeys: boolean } | null>} */
  openExport() {
    return this._open({
      title: 'Экспорт подключений',
      confirmText: 'Экспортировать',
      showPrivateKeysCheckbox: true,
    })
  }

  /** @returns {Promise<{ passphrase: string } | null>} */
  openImport() {
    return this._open({
      title: 'Импорт подключений',
      confirmText: 'Импортировать',
      showPrivateKeysCheckbox: false,
    })
  }

  _open({ title, confirmText, showPrivateKeysCheckbox }) {
    if (this._overlay) return Promise.resolve(null)
    this._buildDOM({ title, confirmText, showPrivateKeysCheckbox })
    return new Promise((resolve) => { this._resolve = resolve })
  }

  _buildDOM({ title, confirmText, showPrivateKeysCheckbox }) {
    const overlay = document.createElement('div')
    overlay.className = 'settings-dialog-overlay'

    const dialog = document.createElement('div')
    dialog.className = 'settings-dialog'

    const header = document.createElement('div')
    header.className = 'settings-dialog-header'
    header.textContent = title
    dialog.appendChild(header)

    const body = document.createElement('div')
    body.className = 'settings-dialog-body'

    const passRow = document.createElement('div')
    passRow.className = 'settings-dialog-field'
    const passLabel = document.createElement('label')
    passLabel.textContent = 'Парольная фраза'
    const passInput = document.createElement('input')
    passInput.type = 'password'
    passInput.className = 'settings-input'
    passInput.placeholder = 'Не короче 8 символов'
    passRow.appendChild(passLabel)
    passRow.appendChild(passInput)
    body.appendChild(passRow)

    let keysCheckbox = null
    if (showPrivateKeysCheckbox) {
      const keysRow = document.createElement('div')
      keysRow.className = 'settings-dialog-field'
      const keysLabel = document.createElement('label')
      keysLabel.textContent = 'Включить приватные ключи в файл'
      const toggle = this._createToggle(false, () => {})
      keysCheckbox = toggle.querySelector('input')
      keysRow.appendChild(keysLabel)
      keysRow.appendChild(toggle)
      body.appendChild(keysRow)

      const hint = document.createElement('div')
      hint.className = 'settings-dialog-hint'
      hint.textContent = 'Без этого профили authType=«key» экспортируются без содержимого ключа — на телефоне их нужно будет донастроить вручную.'
      body.appendChild(hint)
    }

    const errorEl = document.createElement('div')
    errorEl.className = 'settings-dialog-error'
    errorEl.hidden = true
    body.appendChild(errorEl)

    const footer = document.createElement('div')
    footer.className = 'settings-dialog-footer'

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'settings-dialog-btn-secondary'
    cancelBtn.textContent = 'Отмена'
    cancelBtn.addEventListener('click', () => this._settle(null))

    const confirmBtn = document.createElement('button')
    confirmBtn.className = 'settings-dialog-btn-primary'
    confirmBtn.textContent = confirmText
    confirmBtn.addEventListener('click', () => {
      const passphrase = passInput.value
      if (passphrase.length < 8) {
        errorEl.textContent = 'Парольная фраза должна быть не короче 8 символов'
        errorEl.hidden = false
        return
      }
      this._settle({
        passphrase,
        ...(keysCheckbox ? { includePrivateKeys: keysCheckbox.checked } : {}),
      })
    })

    footer.appendChild(cancelBtn)
    footer.appendChild(confirmBtn)
    dialog.appendChild(body)
    dialog.appendChild(footer)
    overlay.appendChild(dialog)

    this._onKeyDown = (e) => {
      if (e.key === 'Enter') confirmBtn.click()
    }
    document.addEventListener('keydown', this._onKeyDown)

    document.body.appendChild(overlay)
    this._overlay = overlay
    this._releaseModal = registerModal(overlay, dialog, {
      onClose: () => this._settle(null),
      initialFocus: passInput
    })
  }

  /** Тот же DOM/CSS, что `SshConnectionDialog._createToggle()`/`SettingsPage._createToggle()`. */
  _createToggle(value, onChange) {
    const label = document.createElement('label')
    label.className = 'settings-toggle'

    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = value
    input.addEventListener('change', () => onChange(input.checked))

    const track = document.createElement('span')
    track.className = 'settings-toggle-track'

    label.appendChild(input)
    label.appendChild(track)
    return label
  }

  _settle(result) {
    if (!this._overlay) return
    document.removeEventListener('keydown', this._onKeyDown)
    this._releaseModal?.()
    this._releaseModal = null
    this._overlay.remove()
    this._overlay = null
    const resolve = this._resolve
    this._resolve = null
    resolve?.(result)
  }

  destroy() {
    if (this._resolve) this._settle(null)
  }
}
