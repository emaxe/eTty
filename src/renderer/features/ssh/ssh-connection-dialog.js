import { registerModal } from '../../components/base/modal/modal.js'
/**
 * Модальный диалог добавления/редактирования SSH-подключения.
 * Чистый UI-компонент (без IO): собирает данные формы и резолвит их вызывающей
 * стороне (SshPanel), которая уже сама вызывает api.sshSave(). Паттерн — как у
 * ConfirmDialog: promise-based open()/hide(), но с текстовыми полями формы.
 * Переиспользует существующие CSS-классы `.settings-dialog*` (см. settings-page.js).
 */
export class SshConnectionDialog {
  /**
   * @param {Object} deps
   * @param {import('../../core/adapters/electron-api.js').ElectronApiAdapter} deps.api
   */
  constructor({ api }) {
    this._api = api
    this._resolve = null
    this._overlay = null
    this._clearSecret = false
  }

  /**
   * @param {object|null} connection — существующее подключение (публичное, без secret) для
   *   редактирования, либо null для создания нового.
   * @returns {Promise<object|null>} собранные данные формы, либо null при отмене.
   */
  open(connection = null) {
    if (this._overlay) return Promise.resolve(null)
    this._clearSecret = false
    this._buildDOM(connection)
    return new Promise((resolve) => { this._resolve = resolve })
  }

  _buildDOM(connection) {
    const isEdit = !!connection
    const isWin = this._api?.platform === 'win32'

    const overlay = document.createElement('div')
    overlay.className = 'settings-dialog-overlay'

    const dialog = document.createElement('div')
    dialog.className = 'settings-dialog'

    const header = document.createElement('div')
    header.className = 'settings-dialog-header'
    header.textContent = isEdit ? 'Изменить SSH-подключение' : 'Новое SSH-подключение'
    dialog.appendChild(header)

    const body = document.createElement('div')
    body.className = 'settings-dialog-body'

    const labelInput = this._field(body, 'Название', 'text', connection?.label || '', 'Например: prod-web')
    const hostInput = this._field(body, 'Хост', 'text', connection?.host || '', 'Имя хоста или IP-адрес')
    const portInput = this._field(body, 'Порт', 'text', String(connection?.port || 22), '22')
    const userInput = this._field(body, 'Пользователь', 'text', connection?.user || '', 'root')

    const authRow = document.createElement('div')
    authRow.className = 'settings-dialog-field'
    const authLabel = document.createElement('label')
    authLabel.textContent = 'Авторизация'
    const authSelect = document.createElement('select')
    authSelect.className = 'settings-select'
    for (const { key, name } of [
      { key: 'agent', name: 'ssh-agent / ключи по умолчанию' },
      { key: 'key', name: 'Приватный ключ' },
      { key: 'password', name: 'Пароль' }
    ]) {
      const opt = document.createElement('option')
      opt.value = key
      opt.textContent = name
      authSelect.appendChild(opt)
    }
    authSelect.value = connection?.authType || 'agent'
    authRow.appendChild(authLabel)
    authRow.appendChild(authSelect)
    body.appendChild(authRow)

    const keyPathInput = this._field(body, 'Путь к приватному ключу', 'text', connection?.privateKeyPath || '', '~/.ssh/id_ed25519')

    const secretRow = document.createElement('div')
    secretRow.className = 'settings-dialog-field'
    const secretLabel = document.createElement('label')
    secretLabel.textContent = 'Пароль / passphrase'
    const secretInput = document.createElement('input')
    secretInput.type = 'password'
    secretInput.className = 'settings-input'
    secretInput.autocomplete = 'new-password'
    secretInput.placeholder = connection?.hasSecret ? '•••••••• (оставьте пустым, чтобы не менять)' : ''
    secretRow.appendChild(secretLabel)
    secretRow.appendChild(secretInput)

    let clearBtn = null
    if (connection?.hasSecret) {
      clearBtn = document.createElement('button')
      clearBtn.type = 'button'
      clearBtn.className = 'settings-dialog-btn-secondary'
      clearBtn.textContent = 'Очистить сохранённый пароль'
      clearBtn.style.marginTop = '4px'
      clearBtn.addEventListener('click', () => {
        this._clearSecret = true
        secretInput.value = ''
        secretInput.placeholder = 'Пароль будет удалён при сохранении'
        clearBtn.remove()
      })
      secretRow.appendChild(clearBtn)
    }
    if (isWin) {
      const hint = document.createElement('div')
      hint.className = 'settings-dialog-hint'
      hint.textContent = 'На Windows пароль подставляется автоматически при OpenSSH 8.4+; иначе его потребуется ввести в терминале.'
      secretRow.appendChild(hint)
    }
    body.appendChild(secretRow)

    const extraArgsInput = this._field(body, 'Доп. аргументы ssh', 'text', connection?.extraArgs || '', 'например: -J jump-host')

    const hooksRow = document.createElement('div')
    hooksRow.className = 'settings-dialog-row'
    const hooksLabel = document.createElement('label')
    hooksLabel.textContent = 'Отслеживать busy и cwd (эксперимент. хуки)'
    const hooksToggle = this._createToggle(connection?.injectShellIntegration !== false, () => {})
    hooksToggle.title = 'Временно инжектирует rc-хуки на удалённой стороне (OSC 7/133) для быстрых '
      + 'команд и подсветки занятого терминала — см. remote-shell-hooks.js'
    hooksRow.appendChild(hooksLabel)
    hooksRow.appendChild(hooksToggle)
    body.appendChild(hooksRow)

    // Режим запуска (обычная сессия / tmux) выбирается ПРИ ПОДКЛЮЧЕНИИ — переключатель SSH/tmux
    // в боковой панели, см. SshPanel — не здесь; форма хранит только сокет, который тот режим
    // будет использовать, когда его выберут.
    const socketInput = this._field(
      body, 'Сокет tmux', 'text',
      connection?.tmuxSocket ?? 'etty',
      'etty (пусто — сокет по умолчанию, tmux ls без -L)'
    )
    socketInput.title = 'Используется, когда вкладка этого подключения открывается в режиме tmux '
      + '(переключатель SSH/tmux в боковой панели) — отдельный сокет tmux-сервера (-L), не трогает '
      + 'сокет/сессии пользователя по умолчанию. Пусто — сокет по умолчанию (tmux ls без -L).'

    const errorEl = document.createElement('div')
    errorEl.className = 'settings-dialog-error'
    errorEl.hidden = true
    body.appendChild(errorEl)

    const keyPathRow = keyPathInput.closest('.settings-dialog-field')
    const updateFieldVisibility = () => {
      const authType = authSelect.value
      // .settings-dialog-field задаёт display:flex — native [hidden] его не перебивает,
      // поэтому скрываем через style.display, а не через атрибут hidden
      keyPathRow.style.display = authType === 'key' ? '' : 'none'
      secretRow.style.display = authType === 'agent' ? 'none' : ''
    }
    authSelect.addEventListener('change', updateFieldVisibility)
    updateFieldVisibility()

    const footer = document.createElement('div')
    footer.className = 'settings-dialog-footer'

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'settings-dialog-btn-secondary'
    cancelBtn.textContent = 'Отмена'
    cancelBtn.addEventListener('click', () => this._settle(null))

    const saveBtn = document.createElement('button')
    saveBtn.className = 'settings-dialog-btn-primary'
    saveBtn.textContent = 'Сохранить'
    saveBtn.addEventListener('click', () => {
      const host = hostInput.value.trim()
      const user = userInput.value.trim()
      const port = parseInt(portInput.value, 10) || 22

      if (!host) return this._showError(errorEl, 'Укажите хост')
      if (!user) return this._showError(errorEl, 'Укажите пользователя')
      if (port < 1 || port > 65535) return this._showError(errorEl, 'Порт должен быть от 1 до 65535')

      const tmuxSocket = socketInput.value.trim()
      // Тот же алфавит, что и SESSION_NAME_RE на main-стороне (remote-shell-hooks.js) — сокет
      // становится частью текста remote-команды, проверяем здесь для быстрой обратной связи;
      // main всё равно перепроверит перед подстановкой. Проверка безусловная (не только для
      // tmux-режима) — режим теперь выбирается позже, при подключении, а не в этой форме.
      if (tmuxSocket && !/^[A-Za-z0-9_-]{1,64}$/.test(tmuxSocket)) {
        return this._showError(errorEl, 'Имя сокета tmux — только буквы/цифры/`_`/`-`')
      }

      const secretValue = secretInput.value
      const secret = this._clearSecret ? null : (secretValue ? secretValue : undefined)

      this._settle({
        id: connection?.id,
        label: labelInput.value.trim(),
        host,
        port,
        user,
        authType: authSelect.value,
        privateKeyPath: keyPathInput.value.trim(),
        extraArgs: extraArgsInput.value.trim(),
        injectShellIntegration: hooksToggle.querySelector('input').checked,
        tmuxSocket,
        secret
      })
    })

    footer.appendChild(cancelBtn)
    footer.appendChild(saveBtn)

    dialog.appendChild(body)
    dialog.appendChild(footer)
    overlay.appendChild(dialog)

    document.body.appendChild(overlay)
    this._overlay = overlay
    this._releaseModal = registerModal(overlay, dialog, {
      onClose: () => this._settle(null),
      initialFocus: hostInput
    })
  }

  /** Toggle-переключатель — тот же DOM/CSS, что и `SettingsPage._createToggle()`. */
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

  _field(container, labelText, type, value, placeholder) {
    const row = document.createElement('div')
    row.className = 'settings-dialog-field'
    const label = document.createElement('label')
    label.textContent = labelText
    const input = document.createElement('input')
    input.type = type
    input.className = 'settings-input'
    input.value = value
    input.placeholder = placeholder || ''
    row.appendChild(label)
    row.appendChild(input)
    container.appendChild(row)
    return input
  }

  _showError(el, message) {
    el.textContent = message
    el.hidden = false
  }

  _settle(result) {
    if (!this._overlay) return
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
    this._api = null
  }
}
