import { Icons } from './icons.js'

/**
 * Dialog for managing Node.js versions via nvm/fnm/asdf.
 * Shows the version running in the active tab's shell, switches it by sending the manager's
 * command to that tab's terminal, installs/uninstalls versions (locally or on the SSH host).
 *
 * Architecture: DI via constructor, follows ProjectSearchDialog pattern.
 */
export class NodeVersionDialog {
  /**
   * @param {Object} deps
   * @param {import('./core/adapters/electron-api').ElectronApiAdapter} deps.api
   * @param {Function} deps.getContext — () => { cwd, ctx, isSsh, currentVersion, shellCtx }:
   *   cwd/ctx — корень и fs-контекст активной вкладки, shellCtx — контекст для node-version IPC
   * @param {Function} deps.onUseVersion — (manager, version) => { ok: boolean, reason?: string }:
   *   отправляет команду переключения в терминал активной вкладки
   * @param {Object} deps.confirmDialog
   * @param {Function} [deps.onClose]
   */
  constructor({ api, getContext, onUseVersion, confirmDialog, onClose }) {
    this._api = api
    this._getContext = getContext
    this._onUseVersion = onUseVersion
    this._confirmDialog = confirmDialog
    this._onClose = onClose

    this._overlay = null
    this._isVisible = false
    this._boundKeyDown = this._onKeyDown.bind(this)
    this._currentTab = 'installed'
    this._installedVersions = []
    this._remoteVersions = []
    this._manager = null
    this._currentVersion = null
    this._required = null
    this._isSsh = false

    this._buildDOM()
  }

  _buildDOM() {
    const overlay = document.createElement('div')
    overlay.className = 'node-version-dialog-overlay hidden'
    overlay.innerHTML = `
      <div class="node-version-dialog">
        <div class="node-version-header">
          <div class="node-version-title-row">
            <span class="node-version-title">${Icons.hexagon} Node.js Versions</span>
            <button class="node-version-close-btn" title="Закрыть">${Icons.close}</button>
          </div>
          <div class="node-version-info">
            <span class="node-version-current">Текущая: <span class="node-version-value">...</span></span>
            <span class="node-version-manager">Менеджер: <span class="node-version-value">...</span></span>
          </div>
          <div class="node-version-info node-version-required hidden">
            <span>Проект требует: <span class="node-version-value"></span></span>
          </div>
          <div class="node-version-install-block hidden">
            <p class="node-version-install-text">Менеджер версий не найден. Установите nvm для управления версиями Node.js.</p>
            <div class="node-version-install-actions">
              <button class="node-version-btn node-version-btn-primary" data-action="install-manager">Автоустановка nvm</button>
              <button class="node-version-btn" data-action="copy-command">Скопировать команду</button>
            </div>
          </div>
        </div>
        <div class="node-version-tabs">
          <button class="node-version-tab active" data-tab="installed">Установленные</button>
          <button class="node-version-tab" data-tab="remote">Доступные</button>
        </div>
        <div class="node-version-body">
          <div class="node-version-list"></div>
          <div class="node-version-empty hidden">Нет версий</div>
        </div>
        <div class="node-version-footer">
          <span class="node-version-status"></span>
        </div>
      </div>
    `
    document.body.appendChild(overlay)

    this._overlay = overlay
    this._currentVersionEl = overlay.querySelector('.node-version-current .node-version-value')
    this._managerEl = overlay.querySelector('.node-version-manager .node-version-value')
    this._requiredEl = overlay.querySelector('.node-version-required')
    this._installBlock = overlay.querySelector('.node-version-install-block')
    this._listEl = overlay.querySelector('.node-version-list')
    this._emptyEl = overlay.querySelector('.node-version-empty')
    this._statusEl = overlay.querySelector('.node-version-status')

    const closeBtn = overlay.querySelector('.node-version-close-btn')
    closeBtn.addEventListener('click', () => this.hide())

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.hide()
    })

    // Tabs
    overlay.querySelectorAll('.node-version-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this._switchTab(tab.dataset.tab)
      })
    })

    // Install manager actions
    overlay.querySelector('[data-action="install-manager"]')?.addEventListener('click', () => this._installManager())
    overlay.querySelector('[data-action="copy-command"]')?.addEventListener('click', () => this._copyInstallCommand())
  }

  async show() {
    if (this._isVisible) return
    this._isVisible = true
    this._overlay.classList.remove('hidden')
    document.addEventListener('keydown', this._boundKeyDown)

    // Reset remote cache so fresh data is fetched on every open
    this._remoteVersions = []
    this._currentTab = 'installed'
    this._overlay.querySelectorAll('.node-version-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === 'installed')
    })

    await this._loadData()
  }

  hide() {
    if (!this._isVisible) return
    this._isVisible = false
    this._overlay.classList.add('hidden')
    document.removeEventListener('keydown', this._boundKeyDown)
    this._onClose?.()
  }

  isVisible() {
    return this._isVisible
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      this.hide()
    }
  }

  async _loadData() {
    this._setStatus('Загрузка...')

    const { cwd, ctx, isSsh, currentVersion, shellCtx } = this._getContext()
    this._isSsh = !!isSsh

    const [managerResult, required] = await Promise.all([
      this._api.nodeVersionDetectManager(shellCtx).catch(() => ({ manager: null })),
      this._findRequiredVersion(cwd, ctx),
    ])

    this._manager = managerResult?.manager || null
    this._currentVersion = currentVersion || null
    this._required = required

    this._currentVersionEl.textContent = this._currentVersion ? `v${this._currentVersion}` : 'N/A'
    this._managerEl.textContent = this._manager || 'не найден'
    this._renderRequired()

    if (!this._manager) {
      // Автоустановка nvm — только для локальных вкладок
      this._installBlock.classList.toggle('hidden', this._isSsh)
      this._listEl.innerHTML = ''
      this._emptyEl.classList.remove('hidden')
      this._emptyEl.textContent = this._isSsh
        ? 'На сервере не найден nvm/fnm/asdf'
        : 'Установите менеджер версий для управления Node.js'
      this._setStatus('')
      return
    }

    this._installBlock.classList.add('hidden')
    await this._reloadInstalled()
    this._renderList()
    this._setStatus('')
  }

  async _reloadInstalled() {
    try {
      const installed = await this._api.nodeVersionListInstalled(this._getContext().shellCtx)
      this._installedVersions = installed?.versions || []
    } catch (e) {
      this._installedVersions = []
    }
  }

  /**
   * Версия, которую требует проект: .nvmrc / .node-version / .tool-versions в cwd или выше
   * (nvm, fnm и asdf ищут вверх по дереву). Читается через fs-провайдер — работает и по SSH.
   * @returns {Promise<{version: string, file: string}|null>}
   */
  async _findRequiredVersion(cwd, ctx) {
    if (!cwd) return null
    let dir = cwd
    for (let depth = 0; depth < 6; depth++) {
      for (const name of ['.nvmrc', '.node-version', '.tool-versions']) {
        const res = await this._api.fsReadFile(`${dir.replace(/\/$/, '')}/${name}`, ctx).catch(() => null)
        if (!res?.success) continue
        let version = res.content.trim().split('\n')[0].trim()
        if (name === '.tool-versions') {
          const m = res.content.match(/^nodejs\s+(\S+)/m)
          if (!m) continue
          version = m[1]
        }
        if (version) return { version: version.replace(/^v(?=\d)/, ''), file: `${dir === '/' ? '' : dir}/${name}` }
      }
      const idx = dir.lastIndexOf('/')
      if (idx <= 0) {
        if (dir === '/') break
        dir = '/'
      } else {
        dir = dir.slice(0, idx)
      }
    }
    return null
  }

  _renderRequired() {
    if (!this._requiredEl) return
    if (!this._required) {
      this._requiredEl.classList.add('hidden')
      return
    }
    this._requiredEl.classList.remove('hidden')
    const mismatch = this._currentVersion && !this._currentVersion.startsWith(this._required.version.replace(/^v/, ''))
      && !/^(lts|node|stable|latest)/.test(this._required.version)
    this._requiredEl.querySelector('.node-version-value').textContent =
      `${this._required.version} (${this._required.file})${mismatch ? ' — отличается от текущей' : ''}`
  }

  _switchTab(tab) {
    this._currentTab = tab
    this._overlay.querySelectorAll('.node-version-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab)
    })
    this._renderList()

    if (tab === 'remote' && this._remoteVersions.length === 0) {
      this._loadRemoteVersions()
    }
  }

  async _loadRemoteVersions() {
    this._setStatus('Загрузка доступных версий...')
    try {
      const remote = await this._api.nodeVersionListRemote(this._getContext().shellCtx)
      this._remoteVersions = remote?.versions || []
      this._renderList()
    } catch (e) {
      this._setStatus('Ошибка загрузки доступных версий')
    }
  }

  _renderList() {
    const versions = this._currentTab === 'installed'
      ? this._installedVersions
      : this._remoteVersions

    if (versions.length === 0) {
      this._listEl.innerHTML = ''
      this._emptyEl.classList.remove('hidden')
      this._emptyEl.textContent = this._currentTab === 'installed'
        ? 'Нет установленных версий'
        : 'Нажмите на вкладку для загрузки доступных версий'
      return
    }

    this._emptyEl.classList.add('hidden')
    this._listEl.innerHTML = ''

    for (const v of versions) {
      const isInstalled = this._installedVersions.some(iv => iv.version === v.version)
      const isCurrent = this._currentVersion === v.version
      const isLts = v.lts

      const row = document.createElement('div')
      row.className = 'node-version-row' + (isCurrent ? ' current' : '')

      const badge = isLts ? '<span class="node-version-badge lts">LTS</span>' : ''
      const currentBadge = isCurrent ? '<span class="node-version-badge current">Текущая</span>' : ''

      let actions = ''
      if (this._currentTab === 'installed') {
        actions = `
          <button class="node-version-row-btn" data-action="use" data-version="${v.version}" title="Выполнить в терминале вкладки">Использовать</button>
          ${this._manager === 'asdf' ? '' : `<button class="node-version-row-btn" data-action="pin" data-version="${v.version}" title="Записать версию в .nvmrc рабочей папки">В .nvmrc</button>`}
          ${isCurrent ? '' : `<button class="node-version-row-btn danger" data-action="uninstall" data-version="${v.version}">Удалить</button>`}
        `
      } else if (!isInstalled) {
        actions = `
          <button class="node-version-row-btn" data-action="install" data-version="${v.version}">Установить</button>
        `
      } else {
        actions = '<span class="node-version-installed-label">Установлена</span>'
      }

      row.innerHTML = `
        <div class="node-version-row-info">
          <span class="node-version-row-version">v${v.version}</span>
          ${badge}
          ${currentBadge}
        </div>
        <div class="node-version-row-actions">${actions}</div>
      `

      this._listEl.appendChild(row)
    }

    // Attach action handlers
    this._listEl.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.target.dataset.action
        const version = e.target.dataset.version
        this._handleAction(action, version)
      })
    })
  }

  async _handleAction(action, version) {
    const { cwd, ctx, shellCtx } = this._getContext()

    switch (action) {
      case 'use': {
        const result = this._onUseVersion(this._manager, version)
        if (result?.ok) {
          this.hide()
        } else {
          this._setStatus(result?.reason || 'Не удалось отправить команду в терминал')
        }
        break
      }
      case 'pin': {
        const file = `${cwd.replace(/\/$/, '')}/.nvmrc`
        this._setStatus(`Запись ${file}...`)
        const res = await this._api.fsWriteFile(file, version + '\n', ctx).catch(e => ({ success: false, error: e.message }))
        this._setStatus(res?.success ? `v${version} записана в ${file}` : `Ошибка записи: ${res?.error || 'неизвестная'}`)
        if (res?.success) this._findRequiredVersion(cwd, ctx).then(r => { this._required = r; this._renderRequired() })
        break
      }
      case 'install': {
        this._setStatus(`Установка v${version}...`)
        try {
          await this._api.nodeVersionInstall(version, shellCtx)
          this._setStatus(`v${version} установлена`)
          await this._reloadInstalled()
          if (this._currentTab === 'installed') {
            this._renderList()
          } else {
            // Switch to installed tab to show the new version
            this._switchTab('installed')
          }
        } catch (e) {
          this._setStatus(`Ошибка установки: ${e.message}`)
        }
        break
      }
      case 'uninstall': {
        if (version === this._currentVersion) {
          this._setStatus('Нельзя удалить версию, активную в терминале')
          return
        }
        const confirmed = await this._confirmDialog.open({
          title: 'Удалить версию Node.js?',
          message: `Удалить Node.js v${version}${this._isSsh ? ' на сервере' : ''}?`,
          confirmText: 'Удалить',
        })
        if (!confirmed) return
        this._setStatus(`Удаление v${version}...`)
        try {
          await this._api.nodeVersionUninstall(version, shellCtx)
          this._setStatus(`v${version} удалена`)
          this._installedVersions = this._installedVersions.filter(v => v.version !== version)
          this._renderList()
        } catch (e) {
          this._setStatus(`Ошибка удаления: ${e.message}`)
        }
        break
      }
    }
  }

  async _installManager() {
    this._setStatus('Установка nvm...')
    try {
      await this._api.nodeVersionInstallManager(this._getContext().shellCtx)
      this._setStatus('nvm установлен. Перезагрузка...')
      // Reload data after a short delay
      setTimeout(() => this._loadData(), 1000)
    } catch (e) {
      this._setStatus(`Ошибка установки: ${e.message}`)
    }
  }

  _copyInstallCommand() {
    const command = 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash'
    navigator.clipboard.writeText(command).then(() => {
      this._setStatus('Команда скопирована в буфер обмена')
      setTimeout(() => this._setStatus(''), 3000)
    }).catch(() => {
      this._setStatus('Не удалось скопировать')
    })
  }

  _setStatus(text) {
    this._statusEl.textContent = text || ''
  }

  destroy() {
    document.removeEventListener('keydown', this._boundKeyDown)
    if (this._overlay) {
      this._overlay.remove()
      this._overlay = null
    }
    this._api = null
    this._getContext = null
    this._onUseVersion = null
    this._confirmDialog = null
    this._onClose = null
  }
}
