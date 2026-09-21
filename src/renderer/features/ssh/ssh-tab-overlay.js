/**
 * Оверлей поверх terminal-pane одной SSH-вкладки: спиннер подключения,
 * состояние «отключено» (после восстановления сессии, lazy connect),
 * ошибка подключения (с кодом выхода) и «подключение удалено». Скрывается
 * на первый байт данных от PTY — тогда прекрасно виден prompt пароля/yes-no от ssh.
 */
export class SshTabOverlay {
  /** @param {HTMLElement} containerEl — `.terminal-pane` конкретной вкладки (position: relative) */
  constructor(containerEl) {
    this._containerEl = containerEl
    this._el = document.createElement('div')
    this._el.className = 'ssh-tab-overlay hidden'
    this._containerEl.appendChild(this._el)
  }

  showConnecting(label) {
    this._render(`
      <div class="ssh-tab-overlay-spinner"></div>
      <div class="ssh-tab-overlay-message">Подключение к ${this._escape(label)}…</div>
    `)
  }

  showDisconnected(label, onConnect) {
    this._render(`
      <div class="ssh-tab-overlay-message">${this._escape(label)} — не подключено</div>
      <button class="ssh-tab-overlay-btn" type="button">Подключиться</button>
    `)
    this._el.querySelector('.ssh-tab-overlay-btn')?.addEventListener('click', onConnect)
  }

  showError(label, exitCode, onReconnect) {
    const codeText = exitCode != null ? ` (код ${exitCode})` : ''
    this._render(`
      <div class="ssh-tab-overlay-message">Соединение с ${this._escape(label)} разорвано${codeText}</div>
      <button class="ssh-tab-overlay-btn" type="button">Переподключиться</button>
    `, 'error')
    this._el.querySelector('.ssh-tab-overlay-btn')?.addEventListener('click', onReconnect)
  }

  /** Персистентная (tmux) сессия перехвачена другим клиентом (`new-session -A -D`, Этап 3). */
  showDetached(label, onReattach) {
    this._render(`
      <div class="ssh-tab-overlay-message">Сессия «${this._escape(label)}» перехвачена другим клиентом</div>
      <button class="ssh-tab-overlay-btn" type="button">Переподключиться</button>
    `, 'error')
    this._el.querySelector('.ssh-tab-overlay-btn')?.addEventListener('click', onReattach)
  }

  showMissing(onClose) {
    this._render(`
      <div class="ssh-tab-overlay-message">Подключение удалено</div>
      <button class="ssh-tab-overlay-btn" type="button">Закрыть вкладку</button>
    `, 'error')
    this._el.querySelector('.ssh-tab-overlay-btn')?.addEventListener('click', onClose)
  }

  hide() {
    this._el.classList.add('hidden')
  }

  _render(html, extraClass) {
    this._el.className = `ssh-tab-overlay ${extraClass || ''}`.trim()
    this._el.innerHTML = html
  }

  _escape(text) {
    const div = document.createElement('div')
    div.textContent = text || ''
    return div.innerHTML
  }

  destroy() {
    this._el?.remove()
    this._el = null
    this._containerEl = null
  }
}
