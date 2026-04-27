import { Icons } from './icons.js'

/**
 * Статус-бар. Показывает текущую директорию, версию Node.js и Git-статистику.
 * Polling каждые 5 секунд. Клик по Git-кнопке открывает полную Git-панель.
 */
export class StatusBar {
  constructor({ btnEl, cwdEl, nodeEl, onOpen, agentButtons = [], onLaunchAgent, onSelectAgent, agentCommandsPanelEl = null, onAgentCommand = null, proxyToggleEl = null, onToggleProxy = null, quickReplies = { items: [] } }) {
    this._btnEl = btnEl
    this._cwdEl = cwdEl
    this._nodeEl = nodeEl
    this._onOpen = onOpen
    this._agentButtons = agentButtons
    this._onLaunchAgent = onLaunchAgent
    this._onSelectAgent = onSelectAgent
    this._agentCommandsPanelEl = agentCommandsPanelEl
    this._onAgentCommand = onAgentCommand
    this._proxyToggleEl = proxyToggleEl
    this._onToggleProxy = onToggleProxy
    this._quickReplies = quickReplies
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
      let lastClickTime = 0

      button.addEventListener('click', () => {
        const now = Date.now()
        const isDoubleClick = now - lastClickTime < 500
        lastClickTime = now

        // Double-click: если терминал занят и нет активного агента — назначаем
        if (isDoubleClick && this._activeTabBusy && !this._activeAgentId) {
          const agentId = button.dataset.agentId
          if (agentId) this._onSelectAgent?.(agentId)
          return
        }

        // Single-click: запуск агента только если терминал свободен
        if (button.disabled || button.classList.contains('status-agent-busy')) return
        const agentId = button.dataset.agentId
        if (agentId) this._onLaunchAgent?.(agentId)
      })
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
      if (v) this._nodeEl.innerHTML = `${Icons.hexagon} v${v}`
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

  setQuickReplies(quickReplies) {
    this._quickReplies = quickReplies || { items: [] }
    this._updateAgentCommandsPanel()
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

      // Неактивные кнопки при занятой вкладке — busy class; активная — disabled + подсветка
      const isBusyState = this._activeTabBusy && !isActive
      button.disabled = disabledBySettings || isActive
      button.classList.toggle('status-agent-busy', isBusyState)
      button.classList.toggle('status-agent-active', isActive)

      if (this._activeTabBusy) {
        if (isActive) {
          button.title = 'Терминал занят'
        } else if (!this._activeAgentId) {
          button.title = `Терминал занят — двойной клик для выбора ${agentStatus?.label || button.textContent}`
        } else {
          button.title = 'Терминал занят'
        }
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

    this._agentCommandsPanelEl.innerHTML = ''
    const items = this._quickReplies?.items || []
    const filtered = items.filter(i => i.enabled && i.agents?.includes(this._activeAgentId))
    for (const item of filtered) {
      const btn = document.createElement('button')
      btn.className = 'agent-cmd-btn'
      btn.dataset.cmd = item.command
      btn.textContent = item.label
      btn.title = item.command ? `Отправить ${item.command}` : ''
      btn.addEventListener('click', () => {
        if (!this._onAgentCommand || !item.command) return
        this._onAgentCommand(item.command, false)
      })
      this._agentCommandsPanelEl.appendChild(btn)
    }
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
          this._cwdEl.innerHTML = `${Icons.folderOpen} ${abbrev || '/'}`
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
        `${Icons.gitBranch}${branch}<span class="stat-add">+${result.totalAdditions}</span><span class="stat-del">-${result.totalDeletions}</span>`
      this._btnEl.classList.remove('hidden')
    } catch (e) {
      this._btnEl.classList.add('hidden')
    }
  }
}
