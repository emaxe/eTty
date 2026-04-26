const SUPPORTED_AGENTS = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'copilot', label: 'Copilot' },
  { id: 'agent', label: 'Agent (Cursor)' },
  { id: 'opencode', label: 'OpenCode' }
]

/**
 * Страница настроек (overlay). Категории: оформление, дерево файлов, терминал, ИИ-агенты.
 */
export class SettingsPage {
  constructor({ onSettingsChanged, onClose }) {
    this._onSettingsChanged = onSettingsChanged
    this._onClose = onClose
    this._config = null
    this._themes = null
    this._overlay = null
    this._saveTimer = null
    this._agentsCategory = null
    this._quickRepliesCategory = null
    this._agentStatusById = new Map()
  }

  async init() {
    const { config, themes, warnings } = await window.electronAPI.settingsLoad()
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
      const result = await window.electronAPI.agentsGetStatus()
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
            this._onSettingsChanged('fileTree.collapseChildrenOnClose', val)
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
            this._onSettingsChanged('fileTree.fileOpenMode', val)
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
            this._onSettingsChanged('appearance.focusIndicator', val)
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
            this._onSettingsChanged('terminal.promptStyle', val)
            this._scheduleSave()
          }
        )
      }
    ]))

    this._agentsCategory = this._buildCategory('ИИ-агенты', this._buildAgentRows())
    body.appendChild(this._agentsCategory)

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
          this._onSettingsChanged('agents.proxy', this._config.agents.proxy)
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
        this._onSettingsChanged('agents.forceDisabled', { ...this._config.agents.forceDisabled })
        this._scheduleSave()
      }
    )
    toggle.title = 'Включить/выключить агента'

    wrapper.appendChild(badge)
    wrapper.appendChild(stateLabel)
    wrapper.appendChild(toggle)
    return wrapper
  }

  _rerenderAgentsCategory() {
    if (!this._agentsCategory) return
    const next = this._buildCategory('ИИ-агенты', this._buildAgentRows())
    this._agentsCategory.replaceWith(next)
    this._agentsCategory = next
  }

  _ensureQuickRepliesSettings() {
    if (!this._config.quickReplies) this._config.quickReplies = { items: [] }
    if (!Array.isArray(this._config.quickReplies.items)) this._config.quickReplies.items = []
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
      list.appendChild(this._buildQuickReplyCompactRow(items[i], i))
    }

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

  _buildQuickReplyCompactRow(item, index) {
    const row = document.createElement('div')
    row.className = 'settings-quick-reply-compact-row'

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
        const agent = SUPPORTED_AGENTS.find(a => a.id === id)
        return agent ? agent.label : id
      })
      agents.textContent = agentLabels.join(', ')
    } else {
      agents.textContent = 'нет агентов'
      agents.classList.add('empty')
    }

    const editBtn = document.createElement('button')
    editBtn.className = 'settings-quick-reply-edit-btn'
    editBtn.textContent = 'Редактировать'
    editBtn.addEventListener('click', () => this._openQuickReplyDialog(item, index))

    row.appendChild(text)
    row.appendChild(agents)
    row.appendChild(editBtn)
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

    // Text input (label = command)
    const labelGroup = document.createElement('div')
    labelGroup.className = 'settings-dialog-field'
    const labelLabel = document.createElement('label')
    labelLabel.textContent = 'Текст и команда'
    const labelInput = document.createElement('input')
    labelInput.type = 'text'
    labelInput.className = 'settings-input'
    labelInput.value = item.label || item.command || ''
    labelInput.placeholder = 'Например: Ok'
    labelGroup.appendChild(labelLabel)
    labelGroup.appendChild(labelInput)

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
    for (const agent of SUPPORTED_AGENTS) {
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
        this._onSettingsChanged('quickReplies.items', items)
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
      const value = labelInput.value.trim()
      const enabled = enabledToggle.querySelector('input').checked
      const selectedAgents = agentToggles
        .filter(({ toggle }) => toggle.querySelector('input').checked)
        .map(({ id }) => id)

      const newItem = {
        id: item.id || crypto.randomUUID(),
        label: value,
        command: value,
        enabled,
        agents: selectedAgents
      }

      this._ensureQuickRepliesSettings()
      if (index >= 0) {
        this._config.quickReplies.items[index] = newItem
      } else {
        this._config.quickReplies.items.push(newItem)
      }

      this._onSettingsChanged('quickReplies.items', this._config.quickReplies.items)
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
      this._onSettingsChanged('appearance.theme', val)
      this._scheduleSave()
    })

    wrapper.appendChild(swatch)
    wrapper.appendChild(select)
    return wrapper
  }

  _scheduleSave() {
    clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(() => {
      window.electronAPI.settingsSave(this._config)
    }, 300)
  }
}
