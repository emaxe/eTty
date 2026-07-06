export const SUPPORTED_AGENTS = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'copilot', label: 'Copilot' },
  { id: 'agent', label: 'Agent (Cursor)' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'qwen', label: 'Qwen' },
  { id: 'agento', label: 'Agento' }
]

/**
 * Страница настроек (overlay). Категории: оформление, дерево файлов, терминал, ИИ-агенты.
 */
export class SettingsPage {
  constructor({ eventBus, onClose, api }) {
    this._bus = eventBus
    this._onClose = onClose
    this._api = api
    this._config = null
    this._themes = null
    this._overlay = null
    this._saveTimer = null
    this._agentsCategory = null
    this._quickRepliesCategory = null
    this._agentStatusById = new Map()
  }

  async init() {
    const { config, themes, warnings } = await this._api.settingsLoad()
    this._config = config
    this._themes = themes
    if (warnings && warnings.length > 0) {
      console.warn('Settings warnings:', ...warnings)
    }
    this._ensureAgentSettings()
    this._ensureQuickRepliesSettings()
    await this._loadAgentStatus()
    this._buildDOM()
  }

  show() {
    this._overlay.classList.remove('hidden')
  }

  hide() {
    this._overlay.classList.add('hidden')
    this._onClose?.()
  }

  isVisible() {
    return !this._overlay.classList.contains('hidden')
  }

  async _loadAgentStatus() {
    try {
      const result = await this._api.agentsRefresh(this._config?.agents?.custom)
      this._agentStatusById = new Map((result?.agents || []).map(agent => [agent.id, agent]))
    } catch {
      this._agentStatusById = new Map()
    }
  }

  _ensureAgentSettings() {
    if (!this._config.agents) this._config.agents = {}
    if (!this._config.agents.forceDisabled) this._config.agents.forceDisabled = {}
    if (typeof this._config.agents.proxy !== 'string') this._config.agents.proxy = ''
    if (typeof this._config.agents.proxyEnabled !== 'boolean') this._config.agents.proxyEnabled = false

    for (const agent of SUPPORTED_AGENTS) {
      if (typeof this._config.agents.forceDisabled[agent.id] !== 'boolean') {
        this._config.agents.forceDisabled[agent.id] = false
      }
    }
    if (!Array.isArray(this._config.agents.custom)) {
      this._config.agents.custom = []
    }
  }

  _buildDOM() {
    const overlay = document.createElement('div')
    overlay.id = 'settings-overlay'
    overlay.classList.add('hidden')

    const header = document.createElement('div')
    header.className = 'settings-header'

    const title = document.createElement('div')
    title.className = 'settings-title'
    title.textContent = 'Настройки'

    const closeBtn = document.createElement('button')
    closeBtn.className = 'settings-close-btn'
    closeBtn.title = 'Закрыть'
    closeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/></svg>'
    closeBtn.addEventListener('click', () => this.hide())

    header.appendChild(title)
    header.appendChild(closeBtn)

    const body = document.createElement('div')
    body.className = 'settings-body'

    body.appendChild(this._buildCategory('Дерево файлов', [
      {
        label: 'Сворачивать дочерние папки при закрытии родительской',
        control: this._createToggle(
          this._config.fileTree.collapseChildrenOnClose,
          (val) => {
            this._config.fileTree.collapseChildrenOnClose = val
            this._bus.emit('settings.changed', { key: 'fileTree.collapseChildrenOnClose', value: val })
            this._scheduleSave()
          }
        )
      },
      {
        label: 'Открытие файлов в редакторе',
        control: this._createSelect(
          [
            { key: 'double', name: 'Двойной клик' },
            { key: 'single', name: 'Одинарный клик' }
          ],
          this._config.fileTree.fileOpenMode || 'double',
          (val) => {
            this._config.fileTree.fileOpenMode = val
            this._bus.emit('settings.changed', { key: 'fileTree.fileOpenMode', value: val })
            this._scheduleSave()
          }
        )
      }
    ]))

    body.appendChild(this._buildCategory('Оформление', [
      {
        label: 'Тема',
        control: this._buildThemeRow()
      },
      {
        label: 'Индикатор фокуса',
        control: this._createSelect(
          [
            { key: 'none', name: 'Нет' },
            { key: 'glow', name: 'Свечение' },
            { key: 'border', name: 'Рамка' },
            { key: 'line', name: 'Линия сверху' }
          ],
          this._config.appearance?.focusIndicator || 'glow',
          (val) => {
            if (!this._config.appearance) this._config.appearance = {}
            this._config.appearance.focusIndicator = val
            this._bus.emit('settings.changed', { key: 'appearance.focusIndicator', value: val })
            this._scheduleSave()
          }
        )
      },
      {
        label: 'Размер статусбара',
        control: this._createSelect(
          [
            { key: 'compact', name: 'Компакт' },
            { key: 'standard', name: 'Стандарт' },
            { key: 'large', name: 'Крупный' }
          ],
          this._config.appearance?.statusBarSize || 'compact',
          (val) => {
            if (!this._config.appearance) this._config.appearance = {}
            this._config.appearance.statusBarSize = val
            this._bus.emit('settings.changed', { key: 'appearance.statusBarSize', value: val })
            this._scheduleSave()
          }
        )
      }
    ]))

    body.appendChild(this._buildCategory('Терминал', [
      {
        label: 'Стиль промпта (для новых вкладок)',
        control: this._createSelect(
          [
            { key: 'default', name: 'По умолчанию (из ~/.zshrc)' },
            { key: 'short', name: 'Короткий — dirname %' },
            { key: 'minimal', name: 'Минимальный — >' },
            { key: 'arrow', name: 'Стрелка — dirname ❯' }
          ],
          this._config.terminal?.promptStyle || 'default',
          (val) => {
            if (!this._config.terminal) this._config.terminal = {}
            this._config.terminal.promptStyle = val
            this._bus.emit('settings.changed', { key: 'terminal.promptStyle', value: val })
            this._scheduleSave()
          }
        )
      },
      {
        label: 'Новая вкладка рядом',
        control: this._createSelect(
          [
            { key: 'modifierAdjacent', name: 'С зажатым Cmd/Ctrl' },
            { key: 'modifierEnd', name: 'Без модификатора' }
          ],
          this._config.terminal?.newTabPlacement || 'modifierAdjacent',
          (val) => {
            if (!this._config.terminal) this._config.terminal = {}
            this._config.terminal.newTabPlacement = val
            this._bus.emit('settings.changed', { key: 'terminal.newTabPlacement', value: val })
            this._scheduleSave()
          }
        )
      },
      {
        label: 'Переключение вкладок с клавиатуры',
        control: this._createSelect(
          [
            { key: 'none', name: 'Выкл' },
            { key: 'cmd-option', name: 'Cmd + Option + ←/→' },
            { key: 'cmd-shift', name: 'Cmd + Shift + ←/→' }
          ],
          this._config.terminal?.tabSwitchHotkey || 'none',
          (val) => {
            if (!this._config.terminal) this._config.terminal = {}
            this._config.terminal.tabSwitchHotkey = val
            this._bus.emit('settings.changed', { key: 'terminal.tabSwitchHotkey', value: val })
            this._scheduleSave()
          }
        )
      }
    ]))

    this._agentsCategory = this._buildCategory('ИИ-агенты', this._buildAgentRows())
    body.appendChild(this._agentsCategory)

    this._customAgentsCategory = this._buildCustomAgentsCategory()
    body.appendChild(this._customAgentsCategory)

    this._quickRepliesCategory = this._buildQuickRepliesCategory()
    body.appendChild(this._quickRepliesCategory)

    overlay.appendChild(header)
    overlay.appendChild(body)
    document.body.appendChild(overlay)
    this._overlay = overlay
  }

  _buildAgentRows() {
    const proxyRow = {
      label: 'Прокси URL для ИИ-агентов',
      control: this._createTextInput(
        this._config.agents.proxy || '',
        'http://135.28.52.90:6200',
        (val) => {
          this._config.agents.proxy = val.trim()
            this._bus.emit('settings.changed', { key: 'agents.proxy', value: this._config.agents.proxy })
          this._scheduleSave()
        }
      )
    }

    const agentRows = SUPPORTED_AGENTS.map(({ id, label }) => ({
      label,
      control: this._buildAgentControl(id)
    }))

    return [proxyRow, ...agentRows]
  }

  _buildAgentControl(agentId) {
    const wrapper = document.createElement('div')
    wrapper.className = 'settings-agent-control'

    const status = this._agentStatusById.get(agentId)
    const detected = !!status?.detected

    const badge = document.createElement('span')
    badge.className = `settings-agent-badge ${detected ? 'detected' : 'missing'}`
    badge.textContent = detected ? 'Обнаружен' : 'Не обнаружен'

    const stateLabel = document.createElement('span')
    stateLabel.className = 'settings-agent-switch-label'
    stateLabel.textContent = this._config.agents.forceDisabled[agentId] ? 'Выкл' : 'Вкл'

    const toggle = this._createToggle(
      !this._config.agents.forceDisabled[agentId],
      (isEnabled) => {
        this._config.agents.forceDisabled[agentId] = !isEnabled
        stateLabel.textContent = isEnabled ? 'Вкл' : 'Выкл'
        this._bus.emit('settings.changed', { key: 'agents.forceDisabled', value: { ...this._config.agents.forceDisabled } })
        this._scheduleSave()
      }
    )
    toggle.title = 'Включить/выключить агента'

    const modeLabel = document.createElement('span')
    modeLabel.className = 'settings-agent-switch-label'
    modeLabel.textContent = 'Shift+Enter'

    const modeSelect = this._createSelect([
      { key: 'kitty', name: 'Kitty протокол' },
      { key: 'newline', name: 'Перенос строки' },
      { key: 'ctrl-j', name: 'Ctrl+J' }
    ], this._config.agents.keyboardModes?.[agentId] || ((agentId === 'qwen' || agentId === 'agento') ? 'ctrl-j' : 'kitty'), (val) => {
      if (!this._config.agents.keyboardModes) this._config.agents.keyboardModes = {}
      this._config.agents.keyboardModes[agentId] = val
      this._bus.emit('settings.changed', { key: 'agents.keyboardModes', value: { ...this._config.agents.keyboardModes } })
      this._scheduleSave()
    })
    modeSelect.title = 'Режим работы Shift+Enter для этого агента'

    wrapper.appendChild(badge)
    wrapper.appendChild(stateLabel)
    wrapper.appendChild(toggle)
    wrapper.appendChild(modeLabel)
    wrapper.appendChild(modeSelect)
    return wrapper
  }

  _rerenderAgentsCategory() {
    if (!this._agentsCategory) return
    const next = this._buildCategory('ИИ-агенты', this._buildAgentRows())
    this._agentsCategory.replaceWith(next)
    this._agentsCategory = next
  }

  _buildCustomAgentsCategory() {
    const category = document.createElement('div')
    category.className = 'settings-category'

    const title = document.createElement('div')
    title.className = 'settings-category-title'
    title.textContent = 'Кастомные ИИ-агенты'
    category.appendChild(title)

    const list = document.createElement('div')
    list.className = 'settings-custom-agents-list'

    const items = this._config.agents?.custom || []
    for (let i = 0; i < items.length; i++) {
      list.appendChild(this._buildCustomAgentRow(items[i], i, list))
    }

    // DnD
    list.addEventListener('dragover', (e) => {
      e.preventDefault()
      const dragging = list.querySelector('.settings-custom-agent-row.dragging')
      if (!dragging) return
      const after = this._getDragAfterElement(list, e.clientY, '.settings-custom-agent-row:not(.dragging)')
      if (after) list.insertBefore(dragging, after)
      else list.appendChild(dragging)
    })
    list.addEventListener('drop', (e) => {
      e.preventDefault()
      const draggedIndex = parseInt(e.dataTransfer.getData('text/plain'), 10)
      if (Number.isNaN(draggedIndex)) return
      const rows = [...list.querySelectorAll('.settings-custom-agent-row')]
      const newIndex = rows.findIndex(r => r.dataset.index === String(draggedIndex))
      if (newIndex !== -1 && newIndex !== draggedIndex) {
        const items = this._config.agents?.custom || []
        const [moved] = items.splice(draggedIndex, 1)
        items.splice(newIndex, 0, moved)
        this._saveCustomAgents()
      }
      for (const r of rows) r.classList.remove('dragging')
    })

    const addBtn = document.createElement('button')
    addBtn.className = 'settings-custom-agent-add-btn'
    addBtn.textContent = '+ Добавить агента'
    addBtn.addEventListener('click', () => this._openCustomAgentDialog(-1, list))
    category.appendChild(addBtn)
    category.appendChild(list)

    return category
  }

  _buildCustomAgentRow(item, index, list) {
    const row = document.createElement('div')
    row.className = 'settings-custom-agent-row'
    row.draggable = true
    row.dataset.index = String(index)

    const grip = document.createElement('div')
    grip.className = 'settings-custom-agent-grip'
    grip.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="4" r="1.5"/><circle cx="11" cy="4" r="1.5"/><circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/><circle cx="5" cy="12" r="1.5"/><circle cx="11" cy="12" r="1.5"/></svg>'

    const info = document.createElement('div')
    info.className = 'settings-custom-agent-info'

    const name = document.createElement('div')
    name.className = 'settings-custom-agent-name'
    name.textContent = item.label || '(без названия)'

    const cmd = document.createElement('div')
    cmd.className = 'settings-custom-agent-command'
    cmd.textContent = item.launchCommand || ''

    info.appendChild(name)
    info.appendChild(cmd)

    const toggle = this._createToggle(!!item.enabled, (val) => {
      const items = this._config.agents?.custom || []
      if (items[index]) {
        items[index].enabled = val
        this._saveCustomAgents()
      }
    })

    const modeLabel = document.createElement('span')
    modeLabel.className = 'settings-agent-switch-label'
    modeLabel.textContent = 'Shift+Enter'

    const modeSelect = this._createSelect([
      { key: 'kitty', name: 'Kitty протокол' },
      { key: 'newline', name: 'Перенос строки' },
      { key: 'ctrl-j', name: 'Ctrl+J' }
    ], this._config.agents.keyboardModes?.[item.id] || ((item.id === 'qwen' || item.id === 'agento') ? 'ctrl-j' : 'kitty'), (val) => {
      if (!this._config.agents.keyboardModes) this._config.agents.keyboardModes = {}
      this._config.agents.keyboardModes[item.id] = val
      this._bus.emit('settings.changed', { key: 'agents.keyboardModes', value: { ...this._config.agents.keyboardModes } })
      this._scheduleSave()
    })
    modeSelect.title = 'Режим работы Shift+Enter для этого агента'

    row.appendChild(grip)
    row.appendChild(info)
    row.appendChild(toggle)
    row.appendChild(modeLabel)
    row.appendChild(modeSelect)

    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(index))
      row.classList.add('dragging')
    })
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging')
    })
    row.addEventListener('click', (e) => {
      if (e.target.closest('label')) return
      this._openCustomAgentDialog(index, list)
    })

    return row
  }

  _openCustomAgentDialog(index, list) {
    const items = this._config.agents?.custom || []
    const item = index >= 0 ? items[index] : { id: crypto.randomUUID(), label: '', launchCommand: '', checkCommand: '', enabled: true }

    const overlay = document.createElement('div')
    overlay.className = 'settings-dialog-overlay'

    const dialog = document.createElement('div')
    dialog.className = 'settings-dialog'

    const header = document.createElement('div')
    header.className = 'settings-dialog-header'
    header.textContent = index >= 0 ? 'Редактировать агента' : 'Новый ИИ-агент'
    dialog.appendChild(header)

    const body = document.createElement('div')
    body.className = 'settings-dialog-body'

    const labelRow = document.createElement('div')
    labelRow.className = 'settings-dialog-row'
    const labelLabel = document.createElement('label')
    labelLabel.textContent = 'Название'
    const labelInput = document.createElement('input')
    labelInput.type = 'text'
    labelInput.className = 'settings-input'
    labelInput.value = item.label || ''
    labelInput.placeholder = 'Например: MyAgent'
    labelRow.appendChild(labelLabel)
    labelRow.appendChild(labelInput)
    body.appendChild(labelRow)

    const launchRow = document.createElement('div')
    launchRow.className = 'settings-dialog-row'
    const launchLabel = document.createElement('label')
    launchLabel.textContent = 'Команда запуска'
    const launchInput = document.createElement('input')
    launchInput.type = 'text'
    launchInput.className = 'settings-input'
    launchInput.value = item.launchCommand || ''
    launchInput.placeholder = 'Например: myagent'
    launchRow.appendChild(launchLabel)
    launchRow.appendChild(launchInput)
    body.appendChild(launchRow)

    const checkRow = document.createElement('div')
    checkRow.className = 'settings-dialog-row'
    const checkLabel = document.createElement('label')
    checkLabel.textContent = 'Команда отслеживания (опционально)'
    const checkInput = document.createElement('input')
    checkInput.type = 'text'
    checkInput.className = 'settings-input'
    checkInput.value = item.checkCommand || ''
    checkInput.placeholder = 'Например: myagent — оставьте пустым для авто-доступности'
    checkRow.appendChild(checkLabel)
    checkRow.appendChild(checkInput)
    body.appendChild(checkRow)

    const enabledRow = document.createElement('div')
    enabledRow.className = 'settings-dialog-row'
    const enabledLabel = document.createElement('label')
    enabledLabel.textContent = 'Включён'
    const enabledToggle = this._createToggle(!!item.enabled, () => {})
    enabledRow.appendChild(enabledLabel)
    enabledRow.appendChild(enabledToggle)
    body.appendChild(enabledRow)

    const modeRow = document.createElement('div')
    modeRow.className = 'settings-dialog-row'
    const modeLabel = document.createElement('label')
    modeLabel.textContent = 'Режим Shift+Enter'
    const modeSelect = this._createSelect([
      { key: 'kitty', name: 'Kitty протокол' },
      { key: 'newline', name: 'Перенос строки' },
      { key: 'ctrl-j', name: 'Ctrl+J' }
    ], this._config.agents.keyboardModes?.[item.id] || ((item.id === 'qwen' || item.id === 'agento') ? 'ctrl-j' : 'kitty'), () => {})
    modeRow.appendChild(modeLabel)
    modeRow.appendChild(modeSelect)
    body.appendChild(modeRow)

    const footer = document.createElement('div')
    footer.className = 'settings-dialog-footer'

    const deleteBtn = document.createElement('button')
    deleteBtn.className = 'settings-dialog-btn-delete'
    deleteBtn.textContent = 'Удалить'
    deleteBtn.style.visibility = index >= 0 ? '' : 'hidden'
    deleteBtn.addEventListener('click', () => {
      if (index >= 0) {
        items.splice(index, 1)
        this._saveCustomAgents()
      }
      overlay.remove()
    })

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'settings-dialog-btn-secondary'
    cancelBtn.textContent = 'Отмена'
    cancelBtn.addEventListener('click', () => overlay.remove())

    const saveBtn = document.createElement('button')
    saveBtn.className = 'settings-dialog-btn-primary'
    saveBtn.textContent = 'Сохранить'
    saveBtn.addEventListener('click', () => {
      const newItem = {
        id: item.id,
        label: labelInput.value.trim(),
        launchCommand: launchInput.value.trim(),
        checkCommand: checkInput.value.trim(),
        enabled: enabledToggle.querySelector('input').checked
      }
      if (index >= 0) {
        items[index] = newItem
      } else {
        items.push(newItem)
      }
      if (!this._config.agents.keyboardModes) this._config.agents.keyboardModes = {}
      this._config.agents.keyboardModes[item.id] = modeSelect.value
      this._saveCustomAgents()
      this._bus.emit('settings.changed', { key: 'agents.keyboardModes', value: { ...this._config.agents.keyboardModes } })
      this._scheduleSave()
      overlay.remove()
    })

    footer.appendChild(deleteBtn)
    footer.appendChild(cancelBtn)
    footer.appendChild(saveBtn)

    dialog.appendChild(body)
    dialog.appendChild(footer)
    overlay.appendChild(dialog)
    document.body.appendChild(overlay)

    setTimeout(() => labelInput.focus(), 0)
  }

  _saveCustomAgents() {
    const value = [...(this._config.agents?.custom || [])]
    this._bus.emit('settings.changed', { key: 'agents.custom', value })
    this._scheduleSave()
    this._rerenderCustomAgentsCategory()
  }

  _rerenderCustomAgentsCategory() {
    if (!this._customAgentsCategory) return
    const next = this._buildCustomAgentsCategory()
    this._customAgentsCategory.replaceWith(next)
    this._customAgentsCategory = next
  }

  _ensureQuickRepliesSettings() {
    if (!this._config.quickReplies) this._config.quickReplies = { items: [] }
    if (!Array.isArray(this._config.quickReplies.items)) this._config.quickReplies.items = []
  }

  _findAgentById(id) {
    const builtIn = SUPPORTED_AGENTS.find(a => a.id === id)
    if (builtIn) return builtIn
    const custom = (this._config?.agents?.custom || []).find(a => a.id === id)
    return custom ? { id: custom.id, label: custom.label } : null
  }

  _getAllAgentToggles() {
    const customAgents = (this._config?.agents?.custom || []).filter(a => a.enabled)
    const result = SUPPORTED_AGENTS.map(a => ({ id: a.id, label: a.label }))
    for (const ca of customAgents) {
      result.push({ id: ca.id, label: ca.label })
    }
    return result
  }

  _buildQuickRepliesCategory() {
    const category = document.createElement('div')
    category.className = 'settings-category'

    const title = document.createElement('div')
    title.className = 'settings-category-title'
    title.textContent = 'Быстрые ответы'
    category.appendChild(title)

    const list = document.createElement('div')
    list.className = 'settings-quick-replies-list'

    const items = this._config.quickReplies?.items || []
    for (let i = 0; i < items.length; i++) {
      list.appendChild(this._buildQuickReplyCompactRow(items[i], i, list))
    }

    // Drag & drop on the list
    list.addEventListener('dragover', (e) => {
      e.preventDefault()
      const dragging = list.querySelector('.settings-quick-reply-compact-row.dragging')
      if (!dragging) return

      // Remove previous drop-target
      for (const el of list.querySelectorAll('.settings-quick-reply-compact-row')) {
        el.classList.remove('drop-target')
      }

      const afterElement = this._getDragAfterElement(list, e.clientY)
      if (afterElement) {
        afterElement.classList.add('drop-target')
      } else if (list.lastElementChild) {
        list.lastElementChild.classList.add('drop-target')
      }
    })

    list.addEventListener('dragleave', (e) => {
      // If leaving the list entirely, clear targets
      if (!list.contains(e.relatedTarget)) {
        for (const el of list.querySelectorAll('.settings-quick-reply-compact-row')) {
          el.classList.remove('drop-target')
        }
      }
    })

    list.addEventListener('drop', (e) => {
      e.preventDefault()
      const draggedIndex = parseInt(e.dataTransfer.getData('text/plain'), 10)
      if (Number.isNaN(draggedIndex)) return

      // Find target position
      const rows = [...list.querySelectorAll('.settings-quick-reply-compact-row')]
      const targetRow = rows.find(r => r.classList.contains('drop-target'))
      let targetIndex = rows.length - 1
      if (targetRow) {
        targetIndex = parseInt(targetRow.dataset.index, 10)
        targetRow.classList.remove('drop-target')
      }

      if (draggedIndex === targetIndex) return

      this._ensureQuickRepliesSettings()
      const items = this._config.quickReplies.items
      const [moved] = items.splice(draggedIndex, 1)
      // After removing dragged item, elements after it shift down by 1.
      // If we dragged forward (draggedIndex < target), the target position
      // in the shortened array is one less than the original index.
      const newTargetIndex = parseInt(targetRow?.dataset.index || String(items.length), 10)
      const adjustedIndex = draggedIndex < newTargetIndex ? newTargetIndex - 1 : newTargetIndex
      items.splice(adjustedIndex, 0, moved)

      this._bus.emit('settings.changed', { key: 'quickReplies.items', value: this._config.quickReplies.items })
      this._scheduleSave()
      this._rerenderQuickRepliesCategory()
    })

    const addBtn = document.createElement('button')
    addBtn.className = 'settings-btn-add'
    addBtn.textContent = 'Добавить быстрый ответ'
    addBtn.addEventListener('click', () => {
      this._openQuickReplyDialog({ id: crypto.randomUUID(), label: '', command: '', enabled: true, agents: [] }, -1)
    })

    category.appendChild(list)
    category.appendChild(addBtn)
    return category
  }

  _getDragAfterElement(container, y, selector) {
    const sel = selector || '.settings-quick-reply-compact-row:not(.dragging)'
    const draggableElements = [...container.querySelectorAll(sel)]
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect()
      const offset = y - box.top - box.height / 2
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child }
      }
      return closest
    }, { offset: Number.NEGATIVE_INFINITY }).element
  }

  _buildQuickReplyCompactRow(item, index, listEl) {
    const row = document.createElement('div')
    row.className = 'settings-quick-reply-compact-row'
    row.dataset.index = String(index)
    row.draggable = true

    // Drag handle (grip icon)
    const dragHandle = document.createElement('div')
    dragHandle.className = 'settings-quick-reply-drag-handle'
    dragHandle.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="3" r="1.5"/><circle cx="11" cy="3" r="1.5"/><circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/><circle cx="5" cy="13" r="1.5"/><circle cx="11" cy="13" r="1.5"/></svg>'
    dragHandle.title = 'Перетащить'
    // mousedown preventDefault removed — it blocks HTML5 drag initiation

    const text = document.createElement('div')
    text.className = 'settings-quick-reply-text'
    const displayText = item.label || item.command
    text.textContent = displayText || '(пусто)'
    if (!displayText) text.classList.add('empty')
    if (!item.enabled) text.classList.add('disabled')

    const agents = document.createElement('div')
    agents.className = 'settings-quick-reply-agents-text'
    if (item.agents && item.agents.length > 0) {
      const agentLabels = item.agents.map(id => {
        const agent = this._findAgentById(id)
        return agent ? agent.label : id
      })
      agents.textContent = agentLabels.join(', ')
    } else {
      agents.textContent = 'нет агентов'
      agents.classList.add('empty')
    }

    // Edit icon button (pencil)
    const editBtn = document.createElement('button')
    editBtn.className = 'settings-quick-reply-edit-btn'
    editBtn.title = 'Редактировать'
    editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5L13.5 4.5L5 13L2.5 13.5L3 11L11.5 2.5Z"/><path d="M10 4L12 6"/></svg>'
    editBtn.addEventListener('click', () => this._openQuickReplyDialog(item, index))

    row.appendChild(dragHandle)
    row.appendChild(text)
    row.appendChild(agents)
    row.appendChild(editBtn)

    // Drag events
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(index))
      row.classList.add('dragging')
      // Hide drag ghost image to avoid rendering the whole row
      const emptyImage = document.createElement('canvas')
      e.dataTransfer.setDragImage(emptyImage, 0, 0)
    })

    row.addEventListener('dragend', () => {
      row.classList.remove('dragging')
      // Remove any drop-target classes
      if (listEl) {
        for (const el of listEl.querySelectorAll('.settings-quick-reply-compact-row')) {
          el.classList.remove('drop-target')
        }
      }
    })

    return row
  }

  _openQuickReplyDialog(item, index) {
    const overlay = document.createElement('div')
    overlay.className = 'settings-dialog-overlay'

    const dialog = document.createElement('div')
    dialog.className = 'settings-dialog'

    const header = document.createElement('div')
    header.className = 'settings-dialog-header'
    header.textContent = index >= 0 ? 'Редактировать быстрый ответ' : 'Новый быстрый ответ'

    const body = document.createElement('div')
    body.className = 'settings-dialog-body'

    // Label input
    const labelGroup = document.createElement('div')
    labelGroup.className = 'settings-dialog-field'
    const labelLabel = document.createElement('label')
    labelLabel.textContent = 'Метка (кнопка в статусбаре)'
    const labelInput = document.createElement('input')
    labelInput.type = 'text'
    labelInput.className = 'settings-input'
    labelInput.value = item.label || ''
    labelInput.placeholder = 'Например: Ок'
    labelGroup.appendChild(labelLabel)
    labelGroup.appendChild(labelInput)

    // Command input
    const commandGroup = document.createElement('div')
    commandGroup.className = 'settings-dialog-field'
    const commandLabel = document.createElement('label')
    commandLabel.textContent = 'Текст ответа (отправляется в терминал)'
    const commandInput = document.createElement('input')
    commandInput.type = 'text'
    commandInput.className = 'settings-input'
    commandInput.value = item.command || ''
    commandInput.placeholder = 'Например: Ok'
    commandGroup.appendChild(commandLabel)
    commandGroup.appendChild(commandInput)

    // Enabled toggle
    const enabledRow = document.createElement('div')
    enabledRow.className = 'settings-dialog-row'
    const enabledLabel = document.createElement('span')
    enabledLabel.textContent = 'Включено'
    const enabledToggle = this._createToggle(!!item.enabled, () => {})
    enabledRow.appendChild(enabledLabel)
    enabledRow.appendChild(enabledToggle)

    // Agents toggles
    const agentsBlock = document.createElement('div')
    agentsBlock.className = 'settings-dialog-field'
    const agentsTitle = document.createElement('div')
    agentsTitle.className = 'settings-dialog-label'
    agentsTitle.textContent = 'Агенты'
    agentsBlock.appendChild(agentsTitle)

    const agentsGrid = document.createElement('div')
    agentsGrid.className = 'settings-dialog-agents-grid'
    const agentToggles = []
    for (const agent of this._getAllAgentToggles()) {
      const isChecked = (item.agents || []).includes(agent.id)
      const agentRow = document.createElement('div')
      agentRow.className = 'settings-dialog-agent-row'
      const agentToggle = this._createToggle(isChecked, () => {})
      const agentLabel = document.createElement('span')
      agentLabel.textContent = agent.label
      agentRow.appendChild(agentToggle)
      agentRow.appendChild(agentLabel)
      agentsGrid.appendChild(agentRow)
      agentToggles.push({ id: agent.id, toggle: agentToggle })
    }
    agentsBlock.appendChild(agentsGrid)

    body.appendChild(labelGroup)
    body.appendChild(commandGroup)
    body.appendChild(enabledRow)
    body.appendChild(agentsBlock)

    const footer = document.createElement('div')
    footer.className = 'settings-dialog-footer'

    const deleteBtn = document.createElement('button')
    deleteBtn.className = 'settings-dialog-btn-delete'
    deleteBtn.textContent = 'Удалить'
    deleteBtn.addEventListener('click', () => {
      if (index >= 0) {
        const items = this._config.quickReplies?.items || []
        items.splice(index, 1)
        this._bus.emit('settings.changed', { key: 'quickReplies.items', value: items })
        this._scheduleSave()
        this._rerenderQuickRepliesCategory()
      }
      overlay.remove()
    })

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'settings-dialog-btn-secondary'
    cancelBtn.textContent = 'Отмена'
    cancelBtn.addEventListener('click', () => overlay.remove())

    const saveBtn = document.createElement('button')
    saveBtn.className = 'settings-dialog-btn-primary'
    saveBtn.textContent = 'Сохранить'
    saveBtn.addEventListener('click', () => {
      const labelValue = labelInput.value.trim()
      const commandValue = commandInput.value.trim()
      const enabled = enabledToggle.querySelector('input').checked
      const selectedAgents = agentToggles
        .filter(({ toggle }) => toggle.querySelector('input').checked)
        .map(({ id }) => id)

      const newItem = {
        id: item.id || crypto.randomUUID(),
        label: labelValue,
        command: commandValue,
        enabled,
        agents: selectedAgents
      }

      this._ensureQuickRepliesSettings()
      if (index >= 0) {
        this._config.quickReplies.items[index] = newItem
      } else {
        this._config.quickReplies.items.push(newItem)
      }

      this._bus.emit('settings.changed', { key: 'quickReplies.items', value: this._config.quickReplies.items })
      this._scheduleSave()
      this._rerenderQuickRepliesCategory()
      overlay.remove()
    })

    footer.appendChild(deleteBtn)
    footer.appendChild(cancelBtn)
    footer.appendChild(saveBtn)

    dialog.appendChild(header)
    dialog.appendChild(body)
    dialog.appendChild(footer)
    overlay.appendChild(dialog)
    document.body.appendChild(overlay)

    setTimeout(() => labelInput.focus(), 0)
  }

  _rerenderQuickRepliesCategory() {
    if (!this._quickRepliesCategory) return
    const next = this._buildQuickRepliesCategory()
    this._quickRepliesCategory.replaceWith(next)
    this._quickRepliesCategory = next
  }

  _buildCategory(title, rows) {
    const category = document.createElement('div')
    category.className = 'settings-category'

    const categoryTitle = document.createElement('div')
    categoryTitle.className = 'settings-category-title'
    categoryTitle.textContent = title
    category.appendChild(categoryTitle)

    for (const row of rows) {
      const rowEl = document.createElement('div')
      rowEl.className = 'settings-row'

      const label = document.createElement('div')
      label.className = 'settings-label'
      label.textContent = row.label

      const control = document.createElement('div')
      control.className = 'settings-control'
      control.appendChild(row.control)

      rowEl.appendChild(label)
      rowEl.appendChild(control)
      category.appendChild(rowEl)
    }

    return category
  }

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

  _createSelect(options, value, onChange) {
    const select = document.createElement('select')
    select.className = 'settings-select'

    for (const { key, name } of options) {
      const option = document.createElement('option')
      option.value = key
      option.textContent = name
      if (key === value) option.selected = true
      select.appendChild(option)
    }

    select.addEventListener('change', () => onChange(select.value))
    return select
  }

  _createTextInput(value, placeholder, onChange) {
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'settings-input'
    input.value = value || ''
    input.placeholder = placeholder || ''
    input.addEventListener('input', () => onChange(input.value))
    return input
  }

  _buildThemeRow() {
    const wrapper = document.createElement('div')
    wrapper.className = 'settings-theme-row'

    const swatch = document.createElement('div')
    swatch.className = 'settings-theme-swatch'
    const swatchLeft = document.createElement('div')
    swatchLeft.className = 'settings-theme-swatch-half'
    const swatchRight = document.createElement('div')
    swatchRight.className = 'settings-theme-swatch-half'
    swatch.appendChild(swatchLeft)
    swatch.appendChild(swatchRight)

    const updateSwatch = (themeName) => {
      const theme = this._themes[themeName]
      if (!theme) return
      swatchLeft.style.background = theme.ui.bg
      swatchRight.style.background = theme.ui.accent
    }
    updateSwatch(this._config.appearance.theme)

    const themeOptions = Object.entries(this._themes).map(([key, t]) => ({ key, name: t.name }))
    const select = this._createSelect(themeOptions, this._config.appearance.theme, (val) => {
      this._config.appearance.theme = val
      updateSwatch(val)
      this._bus.emit('settings.changed', { key: 'appearance.theme', value: val })
      this._scheduleSave()
    })

    wrapper.appendChild(swatch)
    wrapper.appendChild(select)
    return wrapper
  }

  destroy() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer)
      this._saveTimer = null
    }
    if (this._overlay) {
      this._overlay.remove()
      this._overlay = null
    }
    this._bus = null
    this._onClose = null
    this._api = null
    this._config = null
    this._themes = null
    this._agentsCategory = null
    this._quickRepliesCategory = null
    this._agentStatusById = null
  }

  _scheduleSave() {
    clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(() => {
      this._api.settingsSave(this._config)
    }, 300)
  }
}
