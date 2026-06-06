import { Icons } from './icons.js'

/**
 * Dialog for managing Node.js versions via nvm/fnm/asdf.
 * Shows current version, allows switching, installing, and uninstalling versions.
 *
 * Architecture: DI via constructor, follows ProjectSearchDialog pattern.
 */
export class NodeVersionDialog {
  /**
   * @param {Object} deps
   * @param {import('./core/adapters/electron-api').ElectronApiAdapter} deps.api
   * @param {Function} deps.getActiveCwd — returns current tab root path
   * @param {Function} [deps.onClose]
   * @param {Function} [deps.onVersionChanged] — called when version is switched
   */
  constructor({ api, getActiveCwd, onClose, onVersionChanged }) {
    this._api = api
    this._getActiveCwd = getActiveCwd
    this._onClose = onClose
    this._onVersionChanged = onVersionChanged

    this._overlay = null
    this._isVisible = false
    this._boundKeyDown = this._onKeyDown.bind(this)
    this._currentTab = 'installed'
    this._installedVersions = []
    this._remoteVersions = []
    this._manager = null
    this._currentVersion = null

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

    const cwd = this._getActiveCwd()

    // Detect manager and get current version in parallel
    const [managerResult, currentResult] = await Promise.all([
      this._api.nodeVersionDetectManager().catch(() => ({ manager: null })),
      this._api.nodeVersionGetCurrent(cwd).catch(() => null),
    ])

    this._manager = managerResult?.manager || null
    this._currentVersion = currentResult?.version || null

    this._currentVersionEl.textContent = this._currentVersion || 'N/A'
    this._managerEl.textContent = this._manager || 'не найден'

    if (!this._manager) {
      this._installBlock.classList.remove('hidden')
      this._listEl.innerHTML = ''
      this._emptyEl.classList.remove('hidden')
      this._emptyEl.textContent = 'Установите менеджер версий для управления Node.js'
      this._setStatus('')
      return
    }

    this._installBlock.classList.add('hidden')

    // Load installed versions
    try {
      const installed = await this._api.nodeVersionListInstalled()
      this._installedVersions = installed?.versions || []
    } catch (e) {
      this._installedVersions = []
    }

    this._renderList()
    this._setStatus('')
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
      const remote = await this._api.nodeVersionListRemote()
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
          <button class="node-version-row-btn" data-action="use" data-version="${v.version}">Использовать</button>
          <button class="node-version-row-btn danger" data-action="uninstall" data-version="${v.version}">Удалить</button>
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
    const cwd = this._getActiveCwd()

    switch (action) {
      case 'use': {
        this._setStatus(`Переключение на v${version}...`)
        try {
          await this._api.nodeVersionUse(version, cwd)
          this._currentVersion = version
          this._currentVersionEl.textContent = version
          this._setStatus(`Используется v${version}`)
          this._onVersionChanged?.(version)
          // Refresh installed list to update current markers
          const installed = await this._api.nodeVersionListInstalled()
          this._installedVersions = installed?.versions || []
          this._renderList()
        } catch (e) {
          this._setStatus(`Ошибка: ${e.message}`)
        }
        break
      }
      case 'install': {
        this._setStatus(`Установка v${version}...`)
        try {
          await this._api.nodeVersionInstall(version)
          this._setStatus(`v${version} установлена`)
          // Refresh installed list
          const installed = await this._api.nodeVersionListInstalled()
          this._installedVersions = installed?.versions || []
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
        if (!confirm(`Удалить Node.js v${version}?`)) return
        this._setStatus(`Удаление v${version}...`)
        try {
          await this._api.nodeVersionUninstall(version)
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
      await this._api.nodeVersionInstallManager()
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
    this._getActiveCwd = null
    this._onClose = null
    this._onVersionChanged = null
  }
}
