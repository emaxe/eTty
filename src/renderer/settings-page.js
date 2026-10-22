import { registerModal, hasOpenModal } from './components/base/modal/modal.js'
import { formatHotkey, HOTKEYS } from './core/hotkeys.js'
import { Icons } from './icons.js'
import { buildQuickReplyTree, normalizeQuickReplies } from './features/quick-replies/quick-replies-model.js'
import { APP_CONFIG } from './core/config/app-config.js'
import { RADIAL_MENU_CONFIG } from './core/config/radial-menu-config.js'
import { normalizeRadialSettings } from './features/radial-menu/radial-menu-model.js'
import { SWIPE_CONFIG } from './core/config/swipe-config.js'
import { normalizeSwipeSettings } from './features/terminal/terminal-swipe.js'

function pluralizeReplies(n) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'ответ'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'ответа'
  return 'ответов'
}

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
  constructor({ eventBus, onClose, api, confirmDialog }) {
    this._bus = eventBus
    this._onClose = onClose
    this._api = api
    this._confirmDialog = confirmDialog
    this._config = null
    this._themes = null
    this._overlay = null
    this._saveTimer = null
    this._agentsCategory = null
    this._quickRepliesCategory = null
    this._agentStatusById = new Map()
    this._collapsedGroupIds = new Set()
    this._dragState = null
    this._dropTarget = null
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
    document.addEventListener('keydown', this._onKeyDown)
    if (this._currentSection === 'hotkeys') this._renderHotkeys()
  }

  hide() {
    this._overlay.classList.add('hidden')
    document.removeEventListener('keydown', this._onKeyDown)
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

    const sec = {}

    sec.files = (this._buildCategory('Дерево файлов', [
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

    sec.appearance = (this._buildCategory('Оформление', [
      {
        label: 'Режим темы',
        control: this._createSelect(
          [
            { key: 'manual', name: 'Выбрать вручную' },
            { key: 'auto', name: 'Как в системе' }
          ],
          this._config.appearance?.themeMode || 'manual',
          (val) => this.setAppearance('themeMode', val)
        )
      },
      {
        label: 'Тема',
        stack: true,
        control: this._buildThemeGrid()
      },
      {
        label: 'Тёмная тема (режим «Как в системе»)',
        control: this._createSelect(
          this._themeOptions(),
          this._config.appearance?.themeDark || 'etty-dark',
          (val) => this.setAppearance('themeDark', val)
        )
      },
      {
        label: 'Светлая тема (режим «Как в системе»)',
        control: this._createSelect(
          this._themeOptions(),
          this._config.appearance?.themeLight || 'etty-light',
          (val) => this.setAppearance('themeLight', val)
        )
      },
      {
        label: 'Индикатор фокуса',
        control: this._createSelect(
          [
            { key: 'none', name: 'Нет' },
            { key: 'glow', name: 'Тонкая рамка' },
            { key: 'border', name: 'Рамка 2px' },
            { key: 'line', name: 'Линия сверху' }
          ],
          this._config.appearance?.focusIndicator || 'line',
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

    sec.terminal = (this._buildCategory('Терминал', [
      {
        label: 'Размер шрифта',
        control: this._createSelect(
          [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24].map(n => ({ key: String(n), name: `${n} px` })),
          String(this._config.terminal?.fontSize ?? 14),
          (val) => this._setTerminal('fontSize', Number(val))
        )
      },
      {
        label: 'Межстрочный интервал',
        control: this._createSelect(
          [1, 1.1, 1.2, 1.3, 1.4, 1.5].map(n => ({ key: String(n), name: n.toFixed(1) })),
          String(this._config.terminal?.lineHeight ?? 1),
          (val) => this._setTerminal('lineHeight', Number(val))
        )
      },
      {
        label: 'Шрифт терминала (пусто — системный моно-шрифт)',
        control: this._createTextInput(
          this._config.terminal?.fontFamily || '',
          'JetBrains Mono',
          (val) => this._setTerminal('fontFamily', val)
        )
      },
      ...(this._api.platform === 'win32' ? [{
        label: 'Оболочка (для новых вкладок)',
        control: this._createSelect(
          [
            { key: 'auto', name: 'Авто (PowerShell 7 → PowerShell 5.1 → cmd)' },
            { key: 'pwsh', name: 'PowerShell 7' },
            { key: 'powershell', name: 'Windows PowerShell 5.1' },
            { key: 'gitbash', name: 'Git Bash' },
            { key: 'cmd', name: 'cmd.exe (без интеграции)' }
          ],
          this._config.terminal?.shell || 'auto',
          (val) => {
            if (!this._config.terminal) this._config.terminal = {}
            this._config.terminal.shell = val
            this._bus.emit('settings.changed', { key: 'terminal.shell', value: val })
            this._scheduleSave()
          }
        )
      }] : []),
      {
        label: 'Стиль промпта (для новых вкладок)',
        control: this._createSelect(
          [
            { key: 'default', name: this._api.platform === 'win32' ? 'По умолчанию (из профиля оболочки)' : 'По умолчанию (из ~/.zshrc)' },
            { key: 'short', name: 'Короткий — dirname %' },
            { key: 'minimal', name: 'Минимальный — >' },
            { key: 'arrow', name: 'Стрелка — dirname ❯' } // taste-skill-ignore: реальный символ промпта
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
        label: 'Открывать ссылку в системном браузере',
        control: this._createSelect(
          [
            { key: 'click', name: 'Click' },
            { key: 'cmd-click', name: 'Cmd+click' }
          ],
          this._config.terminal?.linkOpenMode || 'cmd-click',
          (val) => {
            if (!this._config.terminal) this._config.terminal = {}
            this._config.terminal.linkOpenMode = val
            this._bus.emit('settings.changed', { key: 'terminal.linkOpenMode', value: val })
            this._scheduleSave()
          }
        )
      },
      {
        label: 'Радиальное меню быстрых команд',
        control: this._createToggle(
          normalizeRadialSettings(this._config.terminal?.radialMenu).enabled,
          (val) => this._saveRadialMenu({ enabled: val })
        )
      },
      {
        label: 'Жест вызова радиального меню',
        control: this._createSelect(
          RADIAL_MENU_CONFIG.GESTURE_OPTIONS,
          normalizeRadialSettings(this._config.terminal?.radialMenu).gesture,
          (val) => this._saveRadialMenu({ gesture: val })
        )
      },
      {
        label: 'Свайп двумя пальцами вверх/вниз',
        control: this._createSelect(
          SWIPE_CONFIG.VERTICAL_OPTIONS,
          normalizeSwipeSettings(this._config.terminal).vertical,
          (val) => this._saveTerminalSetting('swipeVertical', val)
        )
      },
      {
        label: 'Свайп двумя пальцами влево/вправо',
        control: this._createSelect(
          SWIPE_CONFIG.HORIZONTAL_OPTIONS,
          normalizeSwipeSettings(this._config.terminal).horizontal,
          (val) => this._saveTerminalSetting('swipeHorizontal', val)
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
      },
      {
        label: 'Режим Shift+Enter по умолчанию',
        control: this._createSelect(
          [
            { key: 'kitty', name: 'Протокол Kitty (\\x1b[13;2u)' },
            { key: 'newline', name: 'Перевод строки (\\n)' },
            { key: 'ctrl-j', name: 'Ctrl+J (\\x0A)' }
          ],
          this._config.terminal?.defaultKeyboardMode || 'kitty',
          (val) => {
            if (!this._config.terminal) this._config.terminal = {}
            this._config.terminal.defaultKeyboardMode = val
            this._bus.emit('settings.changed', { key: 'terminal.defaultKeyboardMode', value: val })
            this._scheduleSave()
          }
        )
      }
    ]))

    sec.ssh = (this._buildCategory('Панель SSH', [
      {
        label: 'Положение панели',
        control: this._createSelect(
          [
            { key: 'off', name: 'Выключена' },
            { key: 'left', name: 'Слева' },
            { key: 'right', name: 'Справа' }
          ],
          this._config.ssh?.panelPosition || 'off',
          (val) => {
            if (!this._config.ssh) this._config.ssh = {}
            this._config.ssh.panelPosition = val
            this._bus.emit('settings.changed', { key: 'ssh.panelPosition', value: val })
            this._scheduleSave()
          }
        )
      }
    ]))

    this._agentsCategory = this._buildCategory('ИИ-агенты', this._buildAgentRows())

    this._customAgentsCategory = this._buildCustomAgentsCategory()

    this._quickRepliesCategory = this._buildQuickRepliesCategory()

    this._hotkeysEl = document.createElement('div')
    this._hotkeysEl.className = 'settings-category'

    this._sections = [
      { id: 'appearance', title: 'Оформление', nodes: [sec.appearance] },
      { id: 'terminal', title: 'Терминал', nodes: [sec.terminal] },
      { id: 'files', title: 'Дерево файлов', nodes: [sec.files] },
      { id: 'ssh', title: 'Панель SSH', nodes: [sec.ssh] },
      { id: 'agents', title: 'ИИ-агенты', nodes: [this._agentsCategory, this._customAgentsCategory] },
      { id: 'quick-replies', title: 'Быстрые ответы', nodes: [this._quickRepliesCategory] },
      { id: 'hotkeys', title: 'Горячие клавиши', nodes: [this._hotkeysEl] }
    ]
    this._buildShell(overlay)
    document.body.appendChild(overlay)
    this._overlay = overlay
  }

  /**
   * Оболочка настроек: слева навигация по разделам и поиск, справа выбранный раздел.
   * Каждый раздел — отдельное представление с собственным заголовком (h1); при поиске
   * показываются все разделы, а строки без совпадения скрываются.
   */
  _buildShell(overlay) {
    const nav = document.createElement('nav')
    nav.className = 'settings-nav'
    nav.setAttribute('aria-label', 'Разделы настроек')

    const search = document.createElement('input')
    search.type = 'search'
    search.className = 'settings-search'
    search.placeholder = 'Поиск настроек'
    search.setAttribute('aria-label', 'Поиск настроек')
    search.addEventListener('input', () => this._applySearch(search.value))
    this._searchEl = search

    const list = document.createElement('div')
    list.className = 'settings-nav-list'
    list.setAttribute('role', 'tablist')
    list.setAttribute('aria-orientation', 'vertical')

    const main = document.createElement('div')
    main.className = 'settings-main'

    const header = document.createElement('div')
    header.className = 'settings-header'
    this._sectionTitleEl = document.createElement('h1')
    this._sectionTitleEl.className = 'settings-title'
    this._savedEl = document.createElement('span')
    this._savedEl.className = 'settings-saved'
    this._savedEl.textContent = 'Сохранено'
    this._savedEl.setAttribute('role', 'status')

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'settings-close-btn'
    closeBtn.title = 'Закрыть (Esc)'
    closeBtn.setAttribute('aria-label', 'Закрыть настройки')
    closeBtn.innerHTML = Icons.close
    closeBtn.addEventListener('click', () => this.hide())
    header.append(this._sectionTitleEl, this._savedEl, closeBtn)

    const body = document.createElement('div')
    body.className = 'settings-body'

    this._navItems = new Map()
    this._views = new Map()
    for (const section of this._sections) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'settings-nav-item'
      item.setAttribute('role', 'tab')
      item.textContent = section.title
      item.addEventListener('click', () => this._selectSection(section.id))
      this._navItems.set(section.id, item)
      list.appendChild(item)

      const view = document.createElement('section')
      view.className = 'settings-view'
      view.setAttribute('role', 'tabpanel')
      view.hidden = true
      for (const node of section.nodes) view.appendChild(node)
      this._views.set(section.id, view)
      body.appendChild(view)
    }

    this._noResultsEl = document.createElement('div')
    this._noResultsEl.className = 'settings-empty'
    this._noResultsEl.textContent = 'Ничего не найдено'
    this._noResultsEl.hidden = true
    body.appendChild(this._noResultsEl)

    nav.append(search, list)
    main.append(header, body)
    overlay.append(nav, main)

    this._onKeyDown = (e) => {
      if (e.key === 'Escape' && this.isVisible() && !hasOpenModal()) {
        e.preventDefault()
        if (this._searchEl.value) {
          this._searchEl.value = ''
          this._applySearch('')
        } else {
          this.hide()
        }
      }
    }
    this._selectSection('appearance')
  }

  _selectSection(id) {
    this._currentSection = id
    if (this._searchEl.value) {
      this._searchEl.value = ''
      this._applySearch('')
    }
    for (const [key, view] of this._views) view.hidden = key !== id
    for (const [key, item] of this._navItems) {
      const on = key === id
      item.classList.toggle('active', on)
      item.setAttribute('aria-selected', String(on))
    }
    this._sectionTitleEl.textContent = this._sections.find(x => x.id === id).title
    this._noResultsEl.hidden = true
    if (id === 'hotkeys') this._renderHotkeys()
  }

  /** Поиск по подписям строк настроек: пустой запрос возвращает обычное представление раздела. */
  _applySearch(query) {
    const q = query.trim().toLowerCase()
    this._overlay.classList.toggle('searching', !!q)
    const rows = this._overlay.querySelectorAll('.settings-row')
    if (!q) {
      for (const row of rows) row.hidden = false
      for (const cat of this._overlay.querySelectorAll('.settings-category')) cat.hidden = false
      this._selectSectionViews(this._currentSection)
      return
    }
    this._renderHotkeys()
    let found = 0
    for (const row of this._overlay.querySelectorAll('.settings-row')) {
      const match = row.textContent.toLowerCase().includes(q)
      row.hidden = !match
      if (match) found++
    }
    for (const cat of this._overlay.querySelectorAll('.settings-category')) {
      cat.hidden = !cat.querySelector('.settings-row:not([hidden])')
    }
    for (const view of this._views.values()) view.hidden = false
    this._sectionTitleEl.textContent = 'Результаты поиска'
    this._noResultsEl.hidden = found > 0
  }

  _selectSectionViews(id) {
    for (const [key, view] of this._views) view.hidden = key !== id
    this._sectionTitleEl.textContent = this._sections.find(x => x.id === id).title
    this._noResultsEl.hidden = true
  }

  /** Реестр команд приложения — источник списка горячих клавиш. */
  setCommandRegistry(registry, isMac) {
    this._commandRegistry = registry
    this._isMac = isMac
  }

  _renderHotkeys() {
    const el = this._hotkeysEl
    el.replaceChildren()
    const title = document.createElement('div')
    title.className = 'settings-category-title'
    title.textContent = 'Горячие клавиши'
    el.appendChild(title)

    const commands = (this._commandRegistry?.all() || []).filter(c => c.hotkey)
    if (commands.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'settings-hint'
      empty.textContent = 'Список горячих клавиш недоступен.'
      el.appendChild(empty)
      return
    }
    for (const command of commands) {
      const row = document.createElement('div')
      row.className = 'settings-row'
      const label = document.createElement('div')
      label.className = 'settings-label'
      label.textContent = command.title
      const key = document.createElement('kbd')
      key.className = 'settings-kbd'
      key.textContent = formatHotkey(command.hotkey, this._isMac)
      row.append(label, key)
      el.appendChild(row)
    }
    const hint = document.createElement('div')
    hint.className = 'settings-hint'
    hint.textContent = `Командная палитра — ${formatHotkey(HOTKEYS.commandPalette, this._isMac)}: найдёт любую команду по названию.`
    el.appendChild(hint)
  }

  /** Отметка «Сохранено»: появляется после записи и гаснет сама. */
  _flashSaved() {
    if (!this._savedEl) return
    this._savedEl.classList.add('visible')
    clearTimeout(this._savedTimer)
    this._savedTimer = setTimeout(() => this._savedEl?.classList.remove('visible'), 1800)
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

  /**
   * Показывает диалог и подключает его к общему стеку модальных окон (Esc, фокус-трап, возврат фокуса).
   * Диалоги закрываются через overlay.remove(): снятие со стека привязано к нему.
   */
  _mountDialog(overlay, dialog) {
    document.body.appendChild(overlay)
    const release = registerModal(overlay, dialog, { onClose: () => overlay.remove() })
    const remove = overlay.remove.bind(overlay)
    overlay.remove = () => {
      release()
      remove()
    }
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
    this._mountDialog(overlay, dialog)

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
    if (!this._config.quickReplies) this._config.quickReplies = { items: [], groups: [] }
    if (!Array.isArray(this._config.quickReplies.items)) this._config.quickReplies.items = []
    if (!Array.isArray(this._config.quickReplies.groups)) this._config.quickReplies.groups = []
    // Self-heal a manually-edited or drag-mangled config: drop orphan groupIds,
    // dedupe groups, re-collapse each group's items into a contiguous run
    const { items, groups } = normalizeQuickReplies(this._config.quickReplies)
    this._config.quickReplies.items = items
    this._config.quickReplies.groups = groups
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

    const { items, groups } = this._config.quickReplies || { items: [], groups: [] }
    const nodes = buildQuickReplyTree({ items, groups, includeEmptyGroups: true })
    for (const node of nodes) {
      if (node.kind === 'item') {
        list.appendChild(this._buildQuickReplyCompactRow(node.item, node.index, false, null))
        continue
      }
      list.appendChild(this._buildQuickReplyGroupRow(node))
      if (this._collapsedGroupIds.has(node.group.id)) continue
      for (const child of node.children) {
        list.appendChild(this._buildQuickReplyCompactRow(child.item, child.index, true, node.group.id))
      }
    }

    // Drag & drop on the list — see _applyQuickReplyDrop for the index/grouping math
    list.addEventListener('dragover', (e) => {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
      if (!this._dragState) return

      for (const el of list.querySelectorAll('.settings-qr-row')) {
        el.classList.remove('drop-target', 'drop-into')
      }

      const afterEl = this._getDragAfterElement(list, e.clientY, '.settings-qr-row:not(.dragging):not(.dragging-child)')
      const prevEl = afterEl ? afterEl.previousElementSibling : list.lastElementChild
      const itemsLength = this._config.quickReplies.items.length
      let beforeIndex = afterEl ? Number(afterEl.dataset.index) : itemsLength
      let targetGroupId = null

      if (this._dragState.kind === 'item') {
        if (prevEl?.dataset.kind === 'group' && !this._collapsedGroupIds.has(prevEl.dataset.groupId)) {
          targetGroupId = prevEl.dataset.groupId
        } else if (prevEl?.classList.contains('is-child')) {
          const listRect = list.getBoundingClientRect()
          if (e.clientX >= listRect.left + APP_CONFIG.QUICK_REPLY_TREE_INDENT_PX) {
            targetGroupId = prevEl.dataset.groupId
          }
        }
      } else {
        // Whole group being dragged — top-level only; pin to the nearest foreign block boundary
        beforeIndex = this._snapGroupDropIndex(beforeIndex, this._dragState.groupId)
      }

      this._dropTarget = { beforeIndex, targetGroupId }

      if (targetGroupId) {
        list.querySelector(`.settings-quick-reply-group-row[data-group-id="${targetGroupId}"]`)?.classList.add('drop-into')
        return
      }
      const indicatorRow = [...list.querySelectorAll('.settings-qr-row:not(.dragging):not(.dragging-child)')]
        .find(r => Number(r.dataset.index) === beforeIndex)
      if (indicatorRow) indicatorRow.classList.add('drop-target')
      else if (list.lastElementChild) list.lastElementChild.classList.add('drop-target')
    })

    list.addEventListener('dragleave', (e) => {
      // If leaving the list entirely, clear targets
      if (!list.contains(e.relatedTarget)) {
        for (const el of list.querySelectorAll('.settings-qr-row')) {
          el.classList.remove('drop-target', 'drop-into')
        }
      }
    })

    list.addEventListener('drop', (e) => {
      e.preventDefault()
      const dragState = this._dragState
      const dropTarget = this._dropTarget
      for (const el of list.querySelectorAll('.settings-qr-row')) {
        el.classList.remove('drop-target', 'drop-into')
      }
      if (!dragState || !dropTarget) return
      this._applyQuickReplyDrop(dragState, dropTarget)
    })

    const actions = document.createElement('div')
    actions.className = 'settings-quick-replies-actions'

    const addBtn = document.createElement('button')
    addBtn.className = 'settings-btn-add'
    addBtn.textContent = 'Добавить быстрый ответ'
    addBtn.addEventListener('click', () => {
      this._openQuickReplyDialog({ id: crypto.randomUUID(), label: '', command: '', enabled: true, agents: [] }, -1)
    })

    const addGroupBtn = document.createElement('button')
    addGroupBtn.className = 'settings-btn-add'
    addGroupBtn.textContent = 'Добавить группу'
    addGroupBtn.addEventListener('click', () => {
      this._openQuickReplyGroupDialog({ id: crypto.randomUUID(), label: '' }, true)
    })

    actions.appendChild(addBtn)
    actions.appendChild(addGroupBtn)

    category.appendChild(list)
    category.appendChild(actions)
    return category
  }

  _getDragAfterElement(container, y, selector) {
    const sel = selector || '.settings-qr-row:not(.dragging):not(.dragging-child)'
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

  /**
   * When a whole group is being dragged, it can only land at the top level.
   * If the raw drop index would land inside another group's contiguous block,
   * snap to whichever end of that block (start/end) the cursor is closer to.
   */
  _snapGroupDropIndex(rawIndex, draggedGroupId) {
    const { items, groups } = this._config.quickReplies
    const tree = buildQuickReplyTree({ items, groups })
    for (const node of tree) {
      if (node.kind !== 'group' || node.group.id === draggedGroupId || node.children.length === 0) continue
      const indices = node.children.map(c => c.index)
      const start = Math.min(...indices)
      const end = Math.max(...indices) + 1
      if (rawIndex > start && rawIndex < end) {
        return (rawIndex - start) <= (end - rawIndex) ? start : end
      }
    }
    return rawIndex
  }

  _clearQuickReplyDragVisuals(rowEl) {
    const list = rowEl.closest('.settings-quick-replies-list')
    if (list) {
      for (const el of list.querySelectorAll('.settings-qr-row')) {
        el.classList.remove('dragging', 'dragging-child', 'drop-target', 'drop-into')
      }
    }
    this._dragState = null
    this._dropTarget = null
  }

  /**
   * Applies a completed drag: removes the dragged item(s) (a single item, or
   * every item belonging to a dragged group), reassigns groupId for a single
   * moved item, splices the result back in at the drop position, then
   * normalizes to restore group contiguity. No-op (no emit/save) if the
   * resulting order is unchanged.
   */
  _applyQuickReplyDrop(drag, drop) {
    const { items, groups } = this._config.quickReplies
    const movedIndices = drag.kind === 'group'
      ? items.reduce((acc, it, i) => { if (it.groupId === drag.groupId) acc.push(i); return acc }, [])
      : [drag.index]
    if (movedIndices.length === 0) return

    const movedSet = new Set(movedIndices)
    const moved = movedIndices.map(i => items[i])
    const rest = items.filter((_, i) => !movedSet.has(i))

    let removedBefore = 0
    for (const i of movedIndices) if (i < drop.beforeIndex) removedBefore++
    const insertAt = drop.beforeIndex - removedBefore

    if (drag.kind === 'item') {
      if (drop.targetGroupId) moved[0].groupId = drop.targetGroupId
      else delete moved[0].groupId
    }

    const next = [...rest.slice(0, insertAt), ...moved, ...rest.slice(insertAt)]
    const { items: normalizedItems, groups: normalizedGroups } = normalizeQuickReplies({ items: next, groups })

    const noop = normalizedItems.length === items.length && normalizedItems.every((it, i) => it === items[i])
    if (noop) return

    // Dropping into a collapsed group would otherwise make the moved item vanish from view
    if (drop.targetGroupId) this._collapsedGroupIds.delete(drop.targetGroupId)

    this._config.quickReplies.items = normalizedItems
    this._config.quickReplies.groups = normalizedGroups
    this._emitQuickRepliesChanged()
  }

  _buildQuickReplyCompactRow(item, index, isChild, groupId) {
    const row = document.createElement('div')
    row.className = 'settings-qr-row settings-quick-reply-compact-row'
    if (isChild) row.classList.add('is-child')
    row.dataset.kind = 'item'
    row.dataset.index = String(index)
    if (groupId) row.dataset.groupId = groupId
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
      e.dataTransfer.setData('text/plain', item.id || String(index))
      this._dragState = { kind: 'item', index, groupId: item.groupId || null }
      row.classList.add('dragging')
      // Hide drag ghost image to avoid rendering the whole row
      const emptyImage = document.createElement('canvas')
      e.dataTransfer.setDragImage(emptyImage, 0, 0)
    })

    row.addEventListener('dragend', () => this._clearQuickReplyDragVisuals(row))

    return row
  }

  _buildQuickReplyGroupRow(node) {
    const { group, children } = node
    const row = document.createElement('div')
    row.className = 'settings-qr-row settings-quick-reply-group-row'
    row.dataset.kind = 'group'
    row.dataset.groupId = group.id
    row.dataset.index = String(children.length > 0 ? children[0].index : this._config.quickReplies.items.length)
    row.draggable = true

    const collapsed = this._collapsedGroupIds.has(group.id)
    const toggleBtn = document.createElement('button')
    toggleBtn.className = 'settings-qr-group-toggle'
    toggleBtn.title = collapsed ? 'Развернуть' : 'Свернуть'
    toggleBtn.innerHTML = collapsed ? Icons.chevronRight : Icons.chevronDown
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (this._collapsedGroupIds.has(group.id)) this._collapsedGroupIds.delete(group.id)
      else this._collapsedGroupIds.add(group.id)
      this._rerenderQuickRepliesCategory()
    })

    const dragHandle = document.createElement('div')
    dragHandle.className = 'settings-quick-reply-drag-handle'
    dragHandle.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="3" r="1.5"/><circle cx="11" cy="3" r="1.5"/><circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/><circle cx="5" cy="13" r="1.5"/><circle cx="11" cy="13" r="1.5"/></svg>'
    dragHandle.title = 'Перетащить'

    const text = document.createElement('div')
    text.className = 'settings-quick-reply-text'
    text.textContent = group.label || '(без названия)'
    if (!group.label) text.classList.add('empty')
    const badge = document.createElement('span')
    badge.className = 'settings-qr-group-badge'
    badge.textContent = 'группа'
    text.appendChild(badge)

    const countEl = document.createElement('div')
    countEl.className = 'settings-quick-reply-agents-text'
    if (children.length === 0) {
      countEl.textContent = 'пусто'
      countEl.classList.add('empty')
    } else {
      countEl.textContent = `${children.length} ${pluralizeReplies(children.length)}`
    }

    const editBtn = document.createElement('button')
    editBtn.className = 'settings-quick-reply-edit-btn'
    editBtn.title = 'Редактировать'
    editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5L13.5 4.5L5 13L2.5 13.5L3 11L11.5 2.5Z"/><path d="M10 4L12 6"/></svg>'
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      this._openQuickReplyGroupDialog(group, false)
    })

    row.appendChild(toggleBtn)
    row.appendChild(dragHandle)
    row.appendChild(text)
    row.appendChild(countEl)
    row.appendChild(editBtn)

    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', group.id)
      this._dragState = { kind: 'group', groupId: group.id }
      row.classList.add('dragging')
      const list = row.closest('.settings-quick-replies-list')
      if (list) {
        for (const child of list.querySelectorAll(`.settings-quick-reply-compact-row.is-child[data-group-id="${group.id}"]`)) {
          child.classList.add('dragging-child')
        }
      }
      const emptyImage = document.createElement('canvas')
      e.dataTransfer.setDragImage(emptyImage, 0, 0)
    })

    row.addEventListener('dragend', () => this._clearQuickReplyDragVisuals(row))

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
        this._config.quickReplies.items.splice(index, 1)
        this._emitQuickRepliesChanged()
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
      // Preserve group membership — this dialog has no group field of its own
      if (item.groupId) newItem.groupId = item.groupId

      this._ensureQuickRepliesSettings()
      if (index >= 0) {
        this._config.quickReplies.items[index] = newItem
      } else {
        this._config.quickReplies.items.push(newItem)
      }

      this._emitQuickRepliesChanged()
      overlay.remove()
    })

    footer.appendChild(deleteBtn)
    footer.appendChild(cancelBtn)
    footer.appendChild(saveBtn)

    dialog.appendChild(header)
    dialog.appendChild(body)
    dialog.appendChild(footer)
    overlay.appendChild(dialog)
    this._mountDialog(overlay, dialog)

    setTimeout(() => labelInput.focus(), 0)
  }

  _openQuickReplyGroupDialog(group, isNew) {
    const overlay = document.createElement('div')
    overlay.className = 'settings-dialog-overlay'

    const dialog = document.createElement('div')
    dialog.className = 'settings-dialog'

    const header = document.createElement('div')
    header.className = 'settings-dialog-header'
    header.textContent = isNew ? 'Новая группа' : 'Редактировать группу'

    const body = document.createElement('div')
    body.className = 'settings-dialog-body'

    const labelGroup = document.createElement('div')
    labelGroup.className = 'settings-dialog-field'
    const labelLabel = document.createElement('label')
    labelLabel.textContent = 'Название группы'
    const labelInput = document.createElement('input')
    labelInput.type = 'text'
    labelInput.className = 'settings-input'
    labelInput.value = group.label || ''
    labelInput.placeholder = 'Например: Команды'
    labelGroup.appendChild(labelLabel)
    labelGroup.appendChild(labelInput)
    body.appendChild(labelGroup)

    const footer = document.createElement('div')
    footer.className = 'settings-dialog-footer'

    const deleteBtn = document.createElement('button')
    deleteBtn.className = 'settings-dialog-btn-delete'
    deleteBtn.textContent = 'Удалить'
    if (isNew) deleteBtn.style.visibility = 'hidden'
    deleteBtn.addEventListener('click', async () => {
      const confirmed = await this._confirmDialog.open({
        title: `Удалить группу «${group.label || '(без названия)'}»?`,
        message: 'Быстрые ответы внутри группы останутся в общем списке.',
        confirmText: 'Удалить',
        cancelText: 'Отмена'
      })
      if (!confirmed) return
      this._ensureQuickRepliesSettings()
      this._config.quickReplies.groups = this._config.quickReplies.groups.filter(g => g.id !== group.id)
      for (const item of this._config.quickReplies.items) {
        if (item.groupId === group.id) delete item.groupId
      }
      this._collapsedGroupIds.delete(group.id)
      this._emitQuickRepliesChanged()
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
      if (!labelValue) return

      this._ensureQuickRepliesSettings()
      const groups = this._config.quickReplies.groups
      const existing = groups.find(g => g.id === group.id)
      if (existing) {
        existing.label = labelValue
      } else {
        groups.push({ id: group.id, label: labelValue })
      }

      this._emitQuickRepliesChanged()
      overlay.remove()
    })

    footer.appendChild(deleteBtn)
    footer.appendChild(cancelBtn)
    footer.appendChild(saveBtn)

    dialog.appendChild(header)
    dialog.appendChild(body)
    dialog.appendChild(footer)
    overlay.appendChild(dialog)
    this._mountDialog(overlay, dialog)

    setTimeout(() => labelInput.focus(), 0)
  }

  _emitQuickRepliesChanged() {
    const { items, groups } = this._config.quickReplies
    this._bus.emit('settings.changed', {
      key: 'quickReplies',
      value: { items: items.map(i => ({ ...i })), groups: groups.map(g => ({ ...g })) }
    })
    this._scheduleSave()
    this._rerenderQuickRepliesCategory()
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
      rowEl.className = row.stack ? 'settings-row settings-row--stack' : 'settings-row'

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

  _themeOptions() {
    return Object.entries(this._themes).map(([key, t]) => ({ key, name: t.name }))
  }

  /** Меняет настройку оформления (тема, режим темы…): сохраняет и уведомляет приложение. */
  setAppearance(key, value) {
    if (!this._config.appearance) this._config.appearance = {}
    this._config.appearance[key] = value
    this._bus.emit('settings.changed', { key: `appearance.${key}`, value })
    this._scheduleSave()
  }

  _setTerminal(key, value) {
    if (!this._config.terminal) this._config.terminal = {}
    this._config.terminal[key] = value
    this._bus.emit('settings.changed', { key: `terminal.${key}`, value })
    this._scheduleSave()
  }

  /**
   * Сетка карточек тем. Каждая карточка рисует мини-терминал в цветах темы:
   * приглашение, цветные ANSI-метки и курсор — выбор по результату, а не по названию.
   * Выбранная тема отмечена линией акцента, как любой выбранный элемент приложения.
   */
  _buildThemeGrid() {
    const grid = document.createElement('div')
    grid.className = 'theme-grid'
    grid.setAttribute('role', 'radiogroup')
    grid.setAttribute('aria-label', 'Тема оформления')

    const cards = new Map()
    const select = (id) => {
      for (const [key, card] of cards) {
        const on = key === id
        card.classList.toggle('selected', on)
        card.setAttribute('aria-checked', String(on))
      }
    }

    for (const [id, theme] of Object.entries(this._themes)) {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'theme-card'
      card.setAttribute('role', 'radio')
      card.title = theme.name

      const preview = document.createElement('div')
      preview.className = 'theme-card__preview'
      preview.style.background = theme.terminal.background
      preview.style.color = theme.terminal.foreground

      const prompt = document.createElement('div')
      prompt.className = 'theme-card__prompt'
      prompt.textContent = '$ ls'
      const marks = document.createElement('div')
      marks.className = 'theme-card__marks'
      for (const c of ['red', 'green', 'yellow', 'blue']) {
        const mark = document.createElement('span')
        mark.style.background = theme.terminal[c]
        marks.appendChild(mark)
      }
      const cursor = document.createElement('span')
      cursor.className = 'theme-card__cursor'
      cursor.style.background = theme.terminal.cursor
      preview.append(prompt, marks, cursor)

      const bar = document.createElement('div')
      bar.className = 'theme-card__bar'
      bar.style.background = theme.ui.surface
      bar.style.borderTop = `1px solid ${theme.ui.border}`

      const name = document.createElement('div')
      name.className = 'theme-card__name'
      name.textContent = theme.name

      card.append(preview, bar, name)
      card.addEventListener('click', () => {
        select(id)
        this.setAppearance('theme', id)
        // Явный выбор темы — это ручной режим
        if (this._config.appearance.themeMode === 'auto') this.setAppearance('themeMode', 'manual')
      })
      cards.set(id, card)
      grid.appendChild(card)
    }
    select(this._config.appearance.theme)
    return grid
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

    const themeOptions = this._themeOptions()
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
    document.removeEventListener('keydown', this._onKeyDown)
    clearTimeout(this._savedTimer)
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
    this._confirmDialog = null
    this._config = null
    this._themes = null
    this._agentsCategory = null
    this._quickRepliesCategory = null
    this._agentStatusById = null
    this._collapsedGroupIds = null
    this._dragState = null
    this._dropTarget = null
  }

  /** Сохраняет простую настройку раздела terminal и оповещает приложение. */
  _saveTerminalSetting(key, value) {
    if (!this._config.terminal) this._config.terminal = {}
    this._config.terminal[key] = value
    this._bus.emit('settings.changed', { key: `terminal.${key}`, value })
    this._scheduleSave()
  }

  /** Сохраняет часть настройки terminal.radialMenu ({ enabled } или { gesture }). */
  _saveRadialMenu(patch) {
    if (!this._config.terminal) this._config.terminal = {}
    const value = { ...normalizeRadialSettings(this._config.terminal.radialMenu), ...patch }
    this._config.terminal.radialMenu = value
    this._bus.emit('settings.changed', { key: 'terminal.radialMenu', value })
    this._scheduleSave()
  }

  _scheduleSave() {
    clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(async () => {
      await this._api.settingsSave(this._config)
      this._flashSaved()
    }, 300)
  }
}
