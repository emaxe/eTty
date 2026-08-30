import { Icons } from './icons.js'
import { APP_CONFIG } from './core/config/app-config.js'
import { ContextMenu } from './components/base/context-menu/context-menu.js'
import { buildQuickReplyTree } from './features/quick-replies/quick-replies-model.js'

/**
 * Статус-бар. Показывает текущую директорию, версию Node.js и Git-статистику.
 * Polling каждые 5 секунд. Клик по Git-кнопке открывает полную Git-панель.
 *
 * Кнопки ИИ-агентов (Claude, Codex, Copilot, Agent, OpenCode):
 * - Одинарный клик при свободном терминале — запускает агента
 * - Двойной клик при занятом терминале (busy) без активного агента — назначает агента активным
 *   и показывает его быстрые команды (quick replies). Это нужно когда агент запущен вручную
 *   или через другое приложение, и eTty не смогла авто-определить его через OSC 133.
 * - Когда агент активен, остальные кнопки скрываются
 * - Кнопки агентов в busy-состоянии имеют класс status-agent-busy (а не disabled),
 *   чтобы click-события доходили для double-click обработки.
 */
export class StatusBar {
  constructor({ btnEl, cwdEl, nodeEl, onOpen, onOpenNodeVersion, agentsContainerEl = null, agentButtons = [], onLaunchAgent, onSelectAgent, agentCommandsPanelEl = null, onAgentCommand = null, proxyToggleEl = null, onToggleProxy = null, quickReplies = { items: [], groups: [] }, api, store = null }) {
    this._btnEl = btnEl
    this._cwdEl = cwdEl
    this._nodeEl = nodeEl
    this._onOpen = onOpen
    this._onOpenNodeVersion = onOpenNodeVersion
    this._agentsContainerEl = agentsContainerEl
    this._agentConfigs = []
    this._agentButtons = agentButtons
    this._onLaunchAgent = onLaunchAgent
    this._onSelectAgent = onSelectAgent
    this._agentCommandsPanelEl = agentCommandsPanelEl
    this._onAgentCommand = onAgentCommand
    this._proxyToggleEl = proxyToggleEl
    this._onToggleProxy = onToggleProxy
    this._quickReplies = quickReplies
    this._api = api
    this._store = store
    this._getRootPath = null
    this._intervalId = null
    this._homeDir = null
    this._agentsById = new Map()
    this._forceDisabled = {}
    this._customAgentsById = new Map()
    this._activeTabBusy = false
    this._activeAgentId = null
    this._proxy = ''
    this._proxyEnabled = false
    this._customAgentsCategory = null
    this._contextMenu = new ContextMenu()
    this._openMenuGroupId = null
    this._cleanupController = new AbortController()
    const signal = this._cleanupController.signal

    this._btnEl.addEventListener('click', () => this._onOpen(), { signal })

    if (this._nodeEl) {
      this._nodeEl.addEventListener('click', () => this._onOpenNodeVersion?.(), { signal })
      // Initial placeholder — will be updated by polling
      this._nodeEl.innerHTML = `${Icons.hexagon} ...`
    }

    for (const button of this._agentButtons) {
      this._attachAgentButtonHandler(button, signal)
    }

    if (this._proxyToggleEl) {
      this._proxyToggleEl.addEventListener('click', () => {
        if (this._proxyToggleEl.classList.contains('hidden')) return
        this._proxyEnabled = !this._proxyEnabled
        this._onToggleProxy?.(this._proxyEnabled)
        this._updateProxyButton()
      }, { signal })
    }

    // Получаем домашнюю директорию для сокращения путей
    this._api.getHomedir().then(h => { this._homeDir = h })

    this._updateAgentButtons()

    if (this._store) {
      this._unsubStore = this._store.subscribe((state, path) => {
        if (path === null || path === 'git.branch' || path === 'git.totalAdditions' || path === 'git.totalDeletions' || path === 'git.isRepo' || path === 'git.rootPath') {
          this._updateGitButton(state)
        }
      })
      this._updateGitButton(this._store.get())
    }
  }

  start(getRootPath) {
    this._getRootPath = getRootPath
    this._polling = false
    this._poll()
    this._intervalId = setInterval(() => this._poll(), APP_CONFIG.STATUS_POLL_INTERVAL_MS)

    this._onVisibilityChange = () => {
      if (document.hidden) {
        if (this._intervalId !== null) {
          clearInterval(this._intervalId)
          this._intervalId = null
        }
      } else if (this._intervalId === null) {
        this._poll()
        this._intervalId = setInterval(() => this._poll(), APP_CONFIG.STATUS_POLL_INTERVAL_MS)
      }
    }
    document.addEventListener('visibilitychange', this._onVisibilityChange)
  }

  stop() {
    if (this._intervalId !== null) {
      clearInterval(this._intervalId)
      this._intervalId = null
    }
    if (this._onVisibilityChange) {
      document.removeEventListener('visibilitychange', this._onVisibilityChange)
      this._onVisibilityChange = null
    }
  }

  updateNow() {
    this._poll()
  }

  setAgentConfigs(agents) {
    this._agentConfigs = Array.isArray(agents) ? agents : []
    this._regenerateAgentButtons()
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
    this._quickReplies = quickReplies || { items: [], groups: [] }
    this._updateAgentCommandsPanel()
  }

  setNodeVersion(version, manager) {
    if (!this._nodeEl) return
    if (version) {
      this._nodeEl.innerHTML = `${Icons.hexagon} v${version}`
      this._nodeEl.classList.remove('hidden')
    } else {
      this._nodeEl.innerHTML = `${Icons.hexagon} N/A`
      this._nodeEl.classList.remove('hidden')
    }
  }

  _updateAgentButtons() {
    for (const button of this._agentButtons) {
      const agentId = button.dataset.agentId
      const agentStatus = this._agentsById.get(agentId)
      const disabledBySettings = !!this._forceDisabled?.[agentId]

      const isActive = this._activeTabBusy && this._activeAgentId === agentId
      const isOtherBusy = this._activeTabBusy && this._activeAgentId && this._activeAgentId !== agentId
      const notDetected = agentStatus && !agentStatus.detected

      // Скрываем кнопки агентов: disabled / not detected / other busy
      button.style.display = disabledBySettings || notDetected ? 'none' : (isOtherBusy ? 'none' : '')

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
    // Buttons about to be wiped by innerHTML='' below — close any menu anchored to them first
    this._contextMenu?.hide()
    this._openMenuGroupId = null

    const busy = this._activeTabBusy && this._activeAgentId
    this._agentCommandsPanelEl.classList.toggle('hidden', !busy)
    if (!busy) return

    this._agentCommandsPanelEl.innerHTML = ''
    const nodes = buildQuickReplyTree({
      items: this._quickReplies?.items || [],
      groups: this._quickReplies?.groups || [],
      filter: (i) => i.enabled && i.agents?.includes(this._activeAgentId)
    })
    for (const node of nodes) {
      this._agentCommandsPanelEl.appendChild(
        node.kind === 'group' ? this._createGroupButton(node) : this._createQuickReplyButton(node.item)
      )
    }
  }

  _createQuickReplyButton(item) {
    const btn = document.createElement('button')
    btn.className = 'agent-cmd-btn'
    btn.dataset.cmd = item.command
    btn.textContent = item.label || item.command
    btn.title = item.command ? `Отправить ${item.command}` : ''
    btn.addEventListener('click', () => {
      if (!this._onAgentCommand || !item.command) return
      this._onAgentCommand(item.command, false)
    })
    return btn
  }

  _createGroupButton(node) {
    const btn = document.createElement('button')
    btn.className = 'agent-cmd-btn agent-cmd-group-btn'
    btn.dataset.groupId = node.group.id
    const label = document.createElement('span')
    label.className = 'agent-cmd-group-label'
    label.textContent = node.group.label || 'Группа'
    btn.appendChild(label)
    btn.insertAdjacentHTML('beforeend', Icons.chevronDown)
    btn.title = `Быстрые ответы: ${node.group.label || 'Группа'}`

    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (this._openMenuGroupId === node.group.id) {
        this._contextMenu.hide()
        return
      }
      const rect = btn.getBoundingClientRect()
      this._openMenuGroupId = node.group.id
      this._contextMenu.show(
        node.children.map(({ item }) => ({
          label: item.label || item.command,
          disabled: !item.command,
          action: () => this._onAgentCommand?.(item.command, false)
        })),
        Math.round(rect.left),
        Math.round(rect.top - 4),
        { placement: 'above', onClose: () => { this._openMenuGroupId = null } }
      )
    })
    return btn
  }

  _attachAgentButtonHandler(button, signal) {
    let lastClickTime = 0
    button.addEventListener('click', () => {
      const now = Date.now()
      const isDoubleClick = now - lastClickTime < APP_CONFIG.DOUBLE_CLICK_THRESHOLD_MS
      lastClickTime = now
      const agentId = button.dataset.agentId
      if (!agentId) return

      // Double-click: если терминал занят и нет активного агента — назначаем
      if (isDoubleClick && this._activeTabBusy && !this._activeAgentId) {
        this._onSelectAgent?.(agentId)
        return
      }

      // Single-click: запуск агента только если терминал свободен
      if (button.disabled || button.classList.contains('status-agent-busy')) return
      this._onLaunchAgent?.(agentId)
    }, { signal })
  }

  _regenerateAgentButtons() {
    const container = this._agentsContainerEl
    if (!container) return
    // Remove existing agent buttons, but keep agent-commands-panel
    const existing = container.querySelectorAll('.status-agent-btn')
    for (const btn of existing) btn.remove()

    const panel = container.querySelector('#agent-commands-panel')

    for (const agent of this._agentConfigs) {
      const btn = document.createElement('button')
      btn.className = 'status-bar-btn status-agent-btn'
      btn.dataset.agentId = agent.id
      btn.title = `Запустить ${agent.label}`
      btn.textContent = agent.label
      this._attachAgentButtonHandler(btn, this._cleanupController.signal)
      container.insertBefore(btn, panel)
    }

    // Update internal button list
    this._agentButtons = Array.from(container.querySelectorAll('.status-agent-btn'))
    this._updateAgentButtons()
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

  destroy() {
    this.stop()
    if (this._unsubStore) {
      this._unsubStore()
      this._unsubStore = null
    }
    this._store = null
    this._contextMenu?.destroy()
    this._contextMenu = null
    this._cleanupController?.abort()
    this._cleanupController = null
    this._btnEl = null
    this._cwdEl = null
    this._nodeEl = null
    this._agentButtons = []
    this._agentCommandsPanelEl = null
    this._proxyToggleEl = null
    this._onOpen = null
    this._onLaunchAgent = null
    this._onSelectAgent = null
    this._onToggleProxy = null
    this._quickReplies = null
    this._getRootPath = null
    this._homeDir = null
    this._agentsById = null
    this._forceDisabled = null
  }

  _updateGitButton(state) {
    if (!this._btnEl) return
    const git = state?.git
    if (!git || !git.isRepo || !git.rootPath) {
      this._btnEl.classList.add('hidden')
      return
    }

    const branch = (git.branch || 'HEAD').replace(/[<>&"]/g, c =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
    const adds = git.totalAdditions || 0
    const dels = git.totalDeletions || 0
    this._btnEl.innerHTML =
      `${Icons.gitBranch}${branch}<span class="stat-add">+${adds}</span><span class="stat-del">-${dels}</span>`
    this._btnEl.classList.remove('hidden')
  }

  async _poll() {
    if (this._polling) return
    this._polling = true
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

      // Update Node version for current folder
      if (this._nodeEl && rootPath) {
        try {
          const nv = await this._api.nodeVersionGetCurrent(rootPath)
          if (nv) {
            this.setNodeVersion(nv.version, nv.manager)
          } else {
            this.setNodeVersion(null, null)
          }
        } catch (e) {
          this.setNodeVersion(null, null)
        }
      }
    } finally {
      this._polling = false
    }
  }
}
