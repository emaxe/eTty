/**
 * Статус-бар. Показывает текущую директорию, версию Node.js и Git-статистику.
 * Polling каждые 5 секунд. Клик по Git-кнопке открывает полную Git-панель.
 */
export class StatusBar {
  constructor({ btnEl, cwdEl, nodeEl, onOpen, agentButtons = [], onLaunchAgent, agentCommandsPanelEl = null, onAgentCommand = null, proxyToggleEl = null, onToggleProxy = null }) {
    this._btnEl = btnEl
    this._cwdEl = cwdEl
    this._nodeEl = nodeEl
    this._onOpen = onOpen
    this._agentButtons = agentButtons
    this._onLaunchAgent = onLaunchAgent
    this._agentCommandsPanelEl = agentCommandsPanelEl
    this._onAgentCommand = onAgentCommand
    this._proxyToggleEl = proxyToggleEl
    this._onToggleProxy = onToggleProxy
    this._getRootPath = null
    this._intervalId = null
    this._homeDir = null
    this._agentsById = new Map()
    this._forceDisabled = {}
    this._activeTabBusy = false
    this._activeAgentId = null
    this._proxy = ''
    this._proxyEnabled = false

    this._btnEl.addEventListener('click', () => this._onOpen())

    for (const button of this._agentButtons) {
      button.addEventListener('click', () => {
        if (button.disabled) return
        const agentId = button.dataset.agentId
        if (agentId) this._onLaunchAgent?.(agentId)
      })
    }

    if (this._agentCommandsPanelEl) {
      for (const button of this._agentCommandsPanelEl.querySelectorAll('.agent-cmd-btn')) {
        button.addEventListener('click', (e) => {
          const cmd = button.dataset.cmd
          if (!cmd || !this._onAgentCommand) return
          this._onAgentCommand(cmd, false)
        })
      }
    }

    if (this._proxyToggleEl) {
      this._proxyToggleEl.addEventListener('click', () => {
        if (this._proxyToggleEl.classList.contains('hidden')) return
        this._proxyEnabled = !this._proxyEnabled
        this._onToggleProxy?.(this._proxyEnabled)
        this._updateProxyButton()
      })
    }

    // Версия Node — статическое значение из preload
    if (this._nodeEl) {
      const v = window.electronAPI.nodeVersion
      if (v) this._nodeEl.textContent = `⬡ v${v}`
    }

    // Получаем домашнюю директорию для сокращения путей
    window.electronAPI.getHomedir().then(h => { this._homeDir = h })

    this._updateAgentButtons()
  }

  start(getRootPath) {
    this._getRootPath = getRootPath
    this._poll()
    this._intervalId = setInterval(() => this._poll(), 5000)
  }

  stop() {
    if (this._intervalId !== null) {
      clearInterval(this._intervalId)
      this._intervalId = null
    }
  }

  updateNow() {
    this._poll()
  }

  setAgentsStatus(statusPayload) {
    const agents = statusPayload?.agents || []
    this._agentsById = new Map(agents.map(a => [a.id, a]))
    this._updateAgentButtons()
  }

  setForceDisabled(forceDisabled) {
    this._forceDisabled = forceDisabled || {}
    this._updateAgentButtons()
  }

  setTerminalState({ isBusy, activeAgentId }) {
    this._activeTabBusy = !!isBusy
    this._activeAgentId = activeAgentId || null
    this._updateAgentButtons()
    this._updateAgentCommandsPanel()
  }

  setProxyConfig({ proxy, enabled }) {
    this._proxy = (proxy || '').trim()
    this._proxyEnabled = !!enabled
    this._updateProxyButton()
  }

  _updateAgentButtons() {
    for (const button of this._agentButtons) {
      const agentId = button.dataset.agentId
      const agentStatus = this._agentsById.get(agentId)
      const disabledBySettings = !!this._forceDisabled?.[agentId]

      const isActive = this._activeTabBusy && this._activeAgentId === agentId
      const isOtherBusy = this._activeTabBusy && this._activeAgentId && this._activeAgentId !== agentId

      // Скрываем кнопки агентов: неактивные — когда терминал занят, все — когда агент не запущен
      button.style.display = disabledBySettings ? 'none' : (isOtherBusy ? 'none' : '')

      // Неактивные кнопки при занятой вкладке — disabled; активная — disabled + подсветка
      button.disabled = isActive || !(!disabledBySettings && !this._activeTabBusy)
      button.classList.toggle('status-agent-active', isActive)

      if (this._activeTabBusy) {
        button.title = isActive ? 'Терминал занят' : 'Терминал занят'
      } else {
        button.title = `Запустить ${agentStatus?.label || button.textContent}`
      }
    }
  }

  _updateAgentCommandsPanel() {
    if (!this._agentCommandsPanelEl) return
    const busy = this._activeTabBusy && this._activeAgentId
    this._agentCommandsPanelEl.classList.toggle('hidden', !busy)
    if (!busy) return

    const AGENT_COMMANDS = {
      claude: ['/clear', '/model', 'Ok', 'Продолжай', '/exit'],
      codex: ['/clear', '/model', 'Ok', 'Продолжай', '/exit'],
      copilot: ['/clear', '/model', 'Ok', 'Продолжай', '/exit'],
      agent: ['/clear', '/model', 'Ok', 'Продолжай', '/exit'],
      opencode: ['/new', '/model', 'Ok', 'Продолжай', '/exit']
    }
    const commands = AGENT_COMMANDS[this._activeAgentId] || []
    const buttons = this._agentCommandsPanelEl.querySelectorAll('.agent-cmd-btn')
    buttons.forEach((btn, i) => {
      const cmd = commands[i] || ''
      btn.dataset.cmd = cmd
      btn.textContent = cmd
      btn.title = cmd ? `Отправить ${cmd}` : ''
      btn.style.display = cmd ? '' : 'none'
    })
  }

  _updateProxyButton() {
    if (!this._proxyToggleEl) return
    const hasProxy = !!this._proxy
    this._proxyToggleEl.classList.toggle('hidden', !hasProxy)
    this._proxyToggleEl.classList.toggle('active', hasProxy && this._proxyEnabled)
    this._proxyToggleEl.title = hasProxy
      ? (this._proxyEnabled ? 'Прокси включен для запуска ИИ-агентов' : 'Прокси выключен для запуска ИИ-агентов')
      : 'Прокси не задан'
  }

  async _poll() {
    try {
      const rootPath = this._getRootPath ? this._getRootPath() : null

      // Обновить CWD — показываем родительскую папку
      if (this._cwdEl) {
        if (rootPath) {
          const home = this._homeDir || ''
          const idx = rootPath.lastIndexOf('/')
          const parentPath = idx > 0 ? rootPath.slice(0, idx) : rootPath
          const abbrev = home && parentPath.startsWith(home)
            ? '~' + parentPath.slice(home.length)
            : parentPath
          this._cwdEl.textContent = `⊡ ${abbrev || '/'}`
          this._cwdEl.classList.remove('hidden')
        } else {
          this._cwdEl.classList.add('hidden')
        }
      }

      if (!rootPath) {
        this._btnEl.classList.add('hidden')
        return
      }

      const result = await window.electronAPI.gitGetStatus(rootPath)

      if (result.notARepo) {
        this._btnEl.classList.add('hidden')
        return
      }

      const branch = (result.branch || 'HEAD').replace(/[<>&"]/g, c =>
        ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
      this._btnEl.innerHTML =
        `⎇ ${branch}&nbsp;&nbsp;<span class="stat-add">+${result.totalAdditions}</span> <span class="stat-del">-${result.totalDeletions}</span>`
      this._btnEl.classList.remove('hidden')
    } catch (e) {
      this._btnEl.classList.add('hidden')
    }
  }
}
