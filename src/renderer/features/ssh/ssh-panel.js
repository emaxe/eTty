/**
 * Боковая панель SSH-подключений: список настроенных подключений, добавление/
 * редактирование/удаление, drag-and-drop переупорядочивание. Сегмент SSH/tmux в шапке
 * переключает режим клика по строке: SSH — обычная вкладка (persistence:'off'), как раньше;
 * tmux — строка раскрывается (▸/▾) в список tmux-сессий этого подключения (через служебный
 * ControlMaster на connectionId — см. main/ssh/ssh-connection-master.js), клик по сессии
 * подключает к ней, «+ Новая сессия» создаёт независимую новую. DnD-переупорядочивание
 * подключений работает в обоих режимах; в tmux строка переносится вместе со своим раскрытым
 * блоком сессий как одна группа (см. обработчик dragover).
 * Клик по строке в режиме SSH/по сессии — событие `ssh.connect` на шине (см. index.js).
 * Паттерн построения DOM — как у GitPanel: пустой overlay-контейнер строится в конструкторе.
 */
import { Icons } from '../../icons.js'
import { showToast } from '../../components/toast/toast.js'
import { ContextMenu } from '../../components/base/context-menu/context-menu.js'
import { SshConnectionDialog } from './ssh-connection-dialog.js'
import { EttyxDialog } from './ettyx-dialog.js'
import { SSH_SESSION_CONFIG } from '../../../shared/ssh-session-config.js'
import { buildSessionNameBase, pickFreeSessionName } from '../../../shared/ssh-session-name.js'

const SESSION_REASON_TEXT = {
  'auth-required': 'Подключитесь, чтобы увидеть сессии',
  'host-key': 'Сначала подключитесь из вкладки и подтвердите ключ хоста',
  'no-controlmaster': 'Список сессий недоступен на Windows',
  'socket-path-too-long': 'Служебный канал недоступен (слишком длинный путь к сокету)',
  'no-tmux': 'tmux не установлен на сервере',
  'connection-not-found': 'Подключение удалено',
  unreachable: 'Сервер недоступен',
  timeout: 'Истекло время ожидания',
  error: 'Не удалось получить список',
}

export class SshPanel {
  /**
   * @param {Object} deps
   * @param {HTMLElement} deps.panelEl
   * @param {HTMLElement} deps.resizeHandleEl
   * @param {import('../../core/event-bus.js').EventBus} deps.eventBus
   * @param {import('../../core/state-store.js').StateStore} deps.store
   * @param {import('../../core/adapters/electron-api.js').ElectronApiAdapter} deps.api
   * @param {import('../../confirm-dialog.js').ConfirmDialog} deps.confirmDialog
   * @param {'ssh'|'tmux'} [deps.initialMode]
   * @param {(mode: 'ssh'|'tmux') => void} [deps.onModeChange] — персистит выбор режима
   *   (config.ssh.panelMode) — сама панель настроек не знает, только сообщает наверх.
   * @param {() => void} [deps.onClose] — крестик в шапке; видимостью панели владеет вызывающий код.
   */
  constructor({ panelEl, resizeHandleEl, eventBus, store, api, confirmDialog, initialMode, onModeChange, onClose }) {
    this._panelEl = panelEl
    this._resizeHandleEl = resizeHandleEl
    this._bus = eventBus
    this._store = store
    this._api = api
    this._confirmDialog = confirmDialog
    this._onModeChange = onModeChange || (() => {})
    this._onClose = onClose || (() => {})

    this._connections = []
    this._mode = initialMode === 'tmux' ? 'tmux' : 'ssh'
    /** @type {Set<string>} — раскрытые подключения (режим tmux) */
    this._expanded = new Set()
    /** @type {Map<string, { status: 'loading'|'ready'|'error', reason: string|null, sessions: object[], fetchedAt: number|null }>} */
    this._sessionsState = new Map()
    /** @type {Map<string, { value: string, error: string|null }>} — черновик поля «+ Новая сессия» по подключению */
    this._newSessionDraft = new Map()
    this._loadingIds = new Set()
    /** @type {Set<string>} — подключения, чей список нужно перечитать сразу после текущего запроса в полёте */
    this._reloadQueued = new Set()
    /** @type {Map<string, number>} — таймеры отложенного обновления по событию ssh.session.activity */
    this._activityTimers = new Map()
    this._pollTimer = null
    this._renameTarget = null // { connectionId, name } — строка сессии в режиме инлайн-переименования

    this._cleanupController = new AbortController()
    this._menu = new ContextMenu()
    this._dialog = new SshConnectionDialog({ api })
    this._ettyxDialog = new EttyxDialog()

    this._buildDOM()
    this._bindEvents()
    // tmux-вкладка открылась/закрылась/оборвалась (index.js) — индикатор «подключена» не ждёт полла
    this._unsubscribeActivity = this._bus.on('ssh.session.activity', ({ connectionId }) => this._scheduleSessionsRefresh(connectionId))
  }

  _buildDOM() {
    this._panelEl.innerHTML = `
      <div class="ssh-panel-header">
        <span class="ssh-panel-title">SSH</span>
        <button class="ssh-panel-refresh-btn" type="button" title="Обновить список сессий" hidden>${Icons.refresh}</button>
        <button class="ssh-panel-import-btn" type="button" title="Импортировать подключения (.ettyx)">${Icons.upload}</button>
        <button class="ssh-panel-export-btn" type="button" title="Экспортировать подключения (.ettyx)">${Icons.download}</button>
        <button class="ssh-panel-add-btn" type="button" title="Добавить подключение">${Icons.plus}</button>
        <button class="ssh-panel-close-btn" type="button" title="Закрыть панель">${Icons.close}</button>
      </div>
      <div class="ssh-panel-mode" role="tablist">
        <button class="ssh-mode-btn" type="button" data-mode="ssh" role="tab">SSH</button>
        <button class="ssh-mode-btn" type="button" data-mode="tmux" role="tab">tmux</button>
      </div>
      <div class="ssh-panel-list"></div>
    `
    this._btnAdd = this._panelEl.querySelector('.ssh-panel-add-btn')
    this._btnRefresh = this._panelEl.querySelector('.ssh-panel-refresh-btn')
    this._btnImport = this._panelEl.querySelector('.ssh-panel-import-btn')
    this._btnExport = this._panelEl.querySelector('.ssh-panel-export-btn')
    this._btnClose = this._panelEl.querySelector('.ssh-panel-close-btn')
    this._listEl = this._panelEl.querySelector('.ssh-panel-list')
    this._modeButtons = [...this._panelEl.querySelectorAll('.ssh-mode-btn')]
    this._applyModeButtons()
  }

  _bindEvents() {
    const signal = this._cleanupController.signal
    this._btnAdd.addEventListener('click', () => this._openDialog(null), { signal })
    this._btnRefresh.addEventListener('click', () => this._refreshExpandedSessions({ force: true }), { signal })
    this._btnImport.addEventListener('click', () => this._importConnections(), { signal })
    this._btnExport.addEventListener('click', () => this._exportConnections(), { signal })
    for (const btn of this._modeButtons) {
      btn.addEventListener('click', () => this._setMode(btn.dataset.mode), { signal })
    }
    this._btnClose.addEventListener('click', () => this._onClose(), { signal })
    this._listEl.addEventListener('dragover', (e) => {
      const dragging = this._listEl.querySelector('.ssh-row.dragging')
      if (!dragging) return
      e.preventDefault()
      // В режиме tmux за строкой едет её раскрытый блок сессий — переносим группой.
      const block = dragging.nextElementSibling?.classList.contains('ssh-sessions') ? dragging.nextElementSibling : null
      const after = this._getDragAfterElement(e.clientY)
      if (after) {
        this._listEl.insertBefore(dragging, after)
        if (block) this._listEl.insertBefore(block, after)
      } else {
        this._listEl.appendChild(dragging)
        if (block) this._listEl.appendChild(block)
      }
    }, { signal })
  }

  _applyModeButtons() {
    for (const btn of this._modeButtons) {
      const active = btn.dataset.mode === this._mode
      btn.classList.toggle('active', active)
      btn.setAttribute('aria-selected', String(active))
    }
    this._btnRefresh.hidden = this._mode !== 'tmux'
  }

  _setMode(mode) {
    if (mode !== 'ssh' && mode !== 'tmux') return
    if (mode === this._mode) return
    this._mode = mode
    this._applyModeButtons()
    this._onModeChange(mode)
    if (mode === 'ssh') {
      this._stopPolling()
    } else {
      this._startPollingIfNeeded()
    }
    this._render()
  }

  _getDragAfterElement(y) {
    const rows = [...this._listEl.querySelectorAll('.ssh-row:not(.dragging)')]
    return rows.reduce((closest, el) => {
      const box = el.getBoundingClientRect()
      const offset = y - box.top - box.height / 2
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: el }
      }
      return closest
    }, { offset: Number.NEGATIVE_INFINITY }).element
  }

  /** Загружает список подключений с диска и перерисовывает панель. */
  async refresh() {
    this._connections = await this._api.sshList()
    this._store?.set('ssh.connections', this._connections)
    // Раскрытые подключения, которых больше нет в списке (удалены) — забываем.
    for (const id of [...this._expanded]) {
      if (!this._connections.some(c => c.id === id)) this._expanded.delete(id)
    }
    this._render()
  }

  _render() {
    this._listEl.innerHTML = ''
    if (this._connections.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'ssh-panel-empty'
      empty.textContent = 'Нет подключений. Нажмите «+», чтобы добавить.'
      this._listEl.appendChild(empty)
      return
    }
    for (const conn of this._connections) {
      this._listEl.appendChild(this._buildRow(conn))
      if (this._mode === 'tmux' && this._expanded.has(conn.id)) {
        this._listEl.appendChild(this._buildSessionsBlock(conn))
      }
    }
  }

  _buildRow(conn) {
    const row = document.createElement('div')
    row.className = 'ssh-row'
    row.draggable = true
    row.dataset.id = conn.id

    if (this._mode === 'tmux') {
      const twisty = document.createElement('span')
      twisty.className = 'ssh-row-twisty'
      const expanded = this._expanded.has(conn.id)
      twisty.innerHTML = expanded ? Icons.chevronDown : Icons.chevronRight
      row.classList.toggle('expanded', expanded)
      row.appendChild(twisty)
    }

    const icon = document.createElement('span')
    icon.className = 'ssh-row-icon'
    icon.innerHTML = Icons.ssh

    const info = document.createElement('div')
    info.className = 'ssh-row-info'
    const label = document.createElement('div')
    label.className = 'ssh-row-label'
    label.textContent = conn.label
    const target = document.createElement('div')
    target.className = 'ssh-row-target'
    target.textContent = `${conn.user}@${conn.host}:${conn.port}`
    info.appendChild(label)
    info.appendChild(target)

    row.appendChild(icon)
    row.appendChild(info)

    row.addEventListener('click', () => {
      if (this._mode === 'tmux') {
        this._toggleExpand(conn.id)
      } else {
        this._bus.emit('ssh.connect', { connectionId: conn.id, persistence: 'off' })
      }
    })
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      this._showRowContextMenu(conn, e.clientX, e.clientY)
    })

    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move'
      row.classList.add('dragging')
      const block = row.nextElementSibling
      if (block?.classList.contains('ssh-sessions')) block.classList.add('dragging')
    })
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging')
      this._listEl.querySelector('.ssh-sessions.dragging')?.classList.remove('dragging')
      this._persistOrder()
    })

    return row
  }

  _showRowContextMenu(conn, x, y) {
    this._menu.show([
      { label: 'Подключиться', action: () => this._bus.emit('ssh.connect', { connectionId: conn.id, persistence: this._mode === 'tmux' ? 'tmux' : 'off' }) },
      { separator: true },
      { label: 'Изменить', action: () => this._openDialog(conn) },
      { separator: true },
      { label: 'Удалить', action: () => this._deleteConnection(conn) },
    ], x, y)
  }

  async _openDialog(conn) {
    const result = await this._dialog.open(conn)
    if (!result) return
    const saved = await this._api.sshSave(result)
    if (!saved?.success) {
      console.error('[SshPanel] Failed to save connection', saved?.error)
      return
    }
    await this.refresh()
  }

  async _deleteConnection(conn) {
    const confirmed = await this._confirmDialog.open({
      title: 'Удалить подключение?',
      message: `Удалить SSH-подключение «${conn.label}»? Открытые вкладки этого подключения продолжат работать, но их нельзя будет переподключить.`,
      confirmText: 'Удалить',
      cancelText: 'Отмена',
    })
    if (!confirmed) return
    await this._api.sshDelete(conn.id)
    await this.refresh()
  }

  _persistOrder() {
    const ids = [...this._listEl.querySelectorAll('.ssh-row')].map(el => el.dataset.id)
    if (ids.length !== this._connections.length || ids.every((id, i) => id === this._connections[i].id)) return
    // Локальный список тоже переставляем — иначе смена режима SSH/tmux перерисует старый порядок.
    const byId = new Map(this._connections.map(c => [c.id, c]))
    this._connections = ids.map(id => byId.get(id))
    this._store?.set('ssh.connections', this._connections)
    this._api.sshReorder(ids)
  }

  // — Режим tmux: раскрытие подключения, список сессий —

  async _toggleExpand(connectionId) {
    if (this._expanded.has(connectionId)) {
      this._expanded.delete(connectionId)
      this._newSessionDraft.delete(connectionId)
      this._api.sshMasterRelease(connectionId)
      this._render()
      this._stopPollingIfIdle()
      return
    }
    this._expanded.add(connectionId)
    this._render()
    this._startPollingIfNeeded()
    const acquired = await this._api.sshMasterAcquire(connectionId)
    if (!this._expanded.has(connectionId)) return // свернули, пока ждали acquire
    if (!acquired?.success) {
      this._setSessionsState(connectionId, { status: 'error', reason: acquired?.reason || 'error', sessions: [] })
      return
    }
    await this._loadSessions(connectionId)
  }

  _setSessionsState(connectionId, patch) {
    const prev = this._sessionsState.get(connectionId) || { status: 'loading', reason: null, sessions: [], fetchedAt: null }
    this._sessionsState.set(connectionId, { ...prev, ...patch })
    this._rerenderSessionsBlock(connectionId)
  }

  _rerenderSessionsBlock(connectionId) {
    const old = this._listEl.querySelector(`.ssh-sessions[data-conn="${cssEscape(connectionId)}"]`)
    if (!old) return
    const conn = this._connections.find(c => c.id === connectionId)
    if (!conn) return
    // Перерисовка (автополлинг) не должна выбивать пользователя из поля имени новой сессии
    const hadFocus = document.activeElement?.classList.contains('ssh-session-new-input') && old.contains(document.activeElement)
    old.replaceWith(this._buildSessionsBlock(conn))
    if (hadFocus) this._focusNewSessionInput(connectionId)
  }

  /**
   * Внеочередное обновление списка сессий подключения по событию вкладки. Дебаунс: серия событий
   * (ptyCreate → fs-ready, обрыв → ретраи) даёт один запрос через SESSIONS_REFRESH_DELAY_MS после
   * последнего. Не раскрытое подключение/скрытая панель — ничего не делаем: при раскрытии список
   * и так загружается заново.
   */
  _scheduleSessionsRefresh(connectionId) {
    if (this._mode !== 'tmux' || !this._expanded.has(connectionId) || !this.isVisible()) return
    clearTimeout(this._activityTimers.get(connectionId))
    this._activityTimers.set(connectionId, setTimeout(() => {
      this._activityTimers.delete(connectionId)
      if (this._expanded.has(connectionId)) this._loadSessions(connectionId, { queue: true })
    }, SSH_SESSION_CONFIG.SESSIONS_REFRESH_DELAY_MS))
  }

  async _loadSessions(connectionId, { force = false, queue = false } = {}) {
    if (this._loadingIds.has(connectionId)) {
      // Запрос в полёте мог стартовать ДО события вкладки и вернуть устаревшее состояние —
      // без очереди внеочередное обновление тихо потерялось бы до следующего полла.
      if (queue) this._reloadQueued.add(connectionId)
      return
    }
    this._loadingIds.add(connectionId)
    const prev = this._sessionsState.get(connectionId)
    this._setSessionsState(connectionId, { status: 'loading', sessions: prev?.sessions || [] })
    try {
      const res = await this._api.sshSessionsList(connectionId, force)
      if (!this._expanded.has(connectionId)) return
      if (res?.success) {
        this._setSessionsState(connectionId, { status: 'ready', reason: null, sessions: res.sessions || [], fetchedAt: Date.now() })
      } else {
        this._setSessionsState(connectionId, { status: 'error', reason: res?.reason || 'error' })
      }
    } catch (e) {
      if (this._expanded.has(connectionId)) this._setSessionsState(connectionId, { status: 'error', reason: 'error' })
    } finally {
      this._loadingIds.delete(connectionId)
      if (this._reloadQueued.delete(connectionId) && this._expanded.has(connectionId)) {
        this._loadSessions(connectionId)
      }
    }
  }

  /** Кнопка «Обновить» / автополлинг — перечитывает список для всех раскрытых подключений. */
  _refreshExpandedSessions({ force = false } = {}) {
    for (const id of this._expanded) this._loadSessions(id, { force })
  }

  _buildSessionsBlock(conn) {
    const block = document.createElement('div')
    block.className = 'ssh-sessions'
    block.dataset.conn = conn.id

    const state = this._sessionsState.get(conn.id) || { status: 'loading', reason: null, sessions: [], fetchedAt: null }

    for (const session of state.sessions) {
      block.appendChild(this._buildSessionRow(conn, session))
    }

    if (state.status === 'loading' && state.sessions.length === 0) {
      const hint = document.createElement('div')
      hint.className = 'ssh-sessions-status'
      hint.textContent = 'Загрузка…'
      block.appendChild(hint)
    } else if (state.status === 'error') {
      const hint = document.createElement('div')
      hint.className = 'ssh-sessions-status error'
      hint.textContent = SESSION_REASON_TEXT[state.reason] || SESSION_REASON_TEXT.error
      block.appendChild(hint)
      if (!['auth-required', 'host-key', 'no-controlmaster', 'socket-path-too-long', 'no-tmux', 'connection-not-found'].includes(state.reason)) {
        const retry = document.createElement('button')
        retry.type = 'button'
        retry.className = 'ssh-sessions-retry'
        retry.textContent = 'Повторить'
        retry.addEventListener('click', (e) => { e.stopPropagation(); this._loadSessions(conn.id, { force: true }) })
        block.appendChild(retry)
      }
    } else if (state.status === 'ready' && state.sessions.length === 0) {
      const hint = document.createElement('div')
      hint.className = 'ssh-sessions-status'
      hint.textContent = 'Нет сессий на сервере'
      block.appendChild(hint)
    }

    // «+ Новая сессия» доступна всегда (не требует служебного канала — открывает вкладку,
    // которая сама поднимет tmux-сессию, см. план: решение B).
    if (this._newSessionDraft.has(conn.id)) {
      block.appendChild(this._buildNewSessionInput(conn))
    } else {
      const addBtn = document.createElement('div')
      addBtn.className = 'ssh-session-new'
      addBtn.textContent = '+ Новая сессия'
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this._newSessionDraft.set(conn.id, { value: '', error: null })
        this._rerenderSessionsBlock(conn.id)
        this._focusNewSessionInput(conn.id)
      })
      block.appendChild(addBtn)
    }

    return block
  }

  /**
   * Инлайн-поле имени новой сессии. Состояние (черновик) живёт в `_newSessionDraft`, а не в DOM:
   * блок сессий перерисовывается автополлингом/обновлением списка, и введённое пропало бы.
   */
  _buildNewSessionInput(conn) {
    const draft = this._newSessionDraft.get(conn.id)
    const wrap = document.createElement('div')
    wrap.className = 'ssh-session-new-wrap'

    const suggested = pickFreeSessionName(buildSessionNameBase(conn.id), this.getKnownSessionNames(conn.id))
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'settings-input ssh-session-new-input'
    input.placeholder = `Имя сессии (пусто — ${suggested})`
    input.value = draft.value
    input.spellcheck = false
    wrap.appendChild(input)

    if (draft.error) {
      const hint = document.createElement('div')
      hint.className = 'ssh-sessions-status error'
      hint.textContent = draft.error
      wrap.appendChild(hint)
    }

    const opts = { signal: this._cleanupController.signal }
    input.addEventListener('click', (e) => e.stopPropagation(), opts)
    input.addEventListener('input', () => {
      draft.value = input.value
      if (draft.error) {
        draft.error = null
        wrap.querySelector('.ssh-sessions-status')?.remove()
      }
    }, opts)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this._submitNewSession(conn)
      } else if (e.key === 'Escape') {
        this._cancelNewSession(conn.id)
      }
    }, opts)
    // Пустое поле + потеря фокуса = отмена. С введённым текстом черновик не теряем.
    // Отложено: при перерисовке блока старый input уходит из DOM и тоже теряет фокус —
    // это не отмена (см. isConnected).
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (input.isConnected && !draft.value.trim() && this._newSessionDraft.get(conn.id) === draft) {
          this._cancelNewSession(conn.id)
        }
      }, 0)
    }, opts)

    return wrap
  }

  _focusNewSessionInput(connectionId) {
    const input = this._listEl.querySelector(`.ssh-sessions[data-conn="${cssEscape(connectionId)}"] .ssh-session-new-input`)
    if (!input) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }

  _cancelNewSession(connectionId) {
    if (!this._newSessionDraft.delete(connectionId)) return
    this._rerenderSessionsBlock(connectionId)
  }

  /** Enter в поле имени: пусто — авто-имя (`-2`, `-3`, … считает index.js), иначе проверка и явное имя. */
  _submitNewSession(conn) {
    const draft = this._newSessionDraft.get(conn.id)
    if (!draft) return
    const name = draft.value.trim()
    const known = this.getKnownSessionNames(conn.id)

    if (name) {
      let error = null
      if (!SSH_SESSION_CONFIG.SESSION_NAME_RE.test(name)) {
        error = 'Только латиница, цифры, _ и - (до 64 символов)'
      } else if (known.includes(name)) {
        error = 'Сессия с таким именем уже есть'
      }
      if (error) {
        draft.error = error
        this._rerenderSessionsBlock(conn.id)
        this._focusNewSessionInput(conn.id)
        return
      }
    }

    this._newSessionDraft.delete(conn.id)
    this._rerenderSessionsBlock(conn.id)
    this._bus.emit('ssh.connect', {
      connectionId: conn.id,
      persistence: 'tmux',
      forceNew: true,
      knownSessionNames: known,
      ...(name ? { sessionName: name } : {}),
    })
  }

  /** Имена tmux-сессий, известные панели с сервера (пусто, если список не загружен). */
  getKnownSessionNames(connectionId) {
    return (this._sessionsState.get(connectionId)?.sessions || []).map(s => s.name)
  }

  _buildSessionRow(conn, session) {
    const row = document.createElement('div')
    row.className = 'ssh-session-row'
    row.dataset.name = session.name

    const dot = document.createElement('span')
    dot.className = 'ssh-session-dot' + (session.attached > 0 ? ' attached' : '')

    const info = document.createElement('div')
    info.className = 'ssh-session-info'
    const nameEl = document.createElement('div')
    nameEl.className = 'ssh-session-name'
    nameEl.textContent = session.name
    const metaEl = document.createElement('div')
    metaEl.className = 'ssh-session-meta'
    metaEl.textContent = formatSessionMeta(session)
    info.appendChild(nameEl)
    info.appendChild(metaEl)

    row.appendChild(dot)
    row.appendChild(info)

    row.addEventListener('click', (e) => {
      e.stopPropagation()
      this._bus.emit('ssh.connect', { connectionId: conn.id, persistence: 'tmux', sessionName: session.name })
    })
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this._showSessionContextMenu(conn, session, e.clientX, e.clientY)
    })

    return row
  }

  _showSessionContextMenu(conn, session, x, y) {
    this._menu.show([
      { label: 'Подключиться', action: () => this._bus.emit('ssh.connect', { connectionId: conn.id, persistence: 'tmux', sessionName: session.name }) },
      { separator: true },
      { label: 'Переименовать', action: () => this._renameSession(conn, session) },
      { separator: true },
      { label: 'Убить сессию', action: () => this._killSession(conn, session) },
    ], x, y)
  }

  async _renameSession(conn, session) {
    const row = this._listEl.querySelector(`.ssh-sessions[data-conn="${cssEscape(conn.id)}"] .ssh-session-row[data-name="${cssEscape(session.name)}"]`)
    const nameEl = row?.querySelector('.ssh-session-name')
    if (!nameEl) return

    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'settings-input ssh-session-rename-input'
    input.value = session.name
    nameEl.replaceWith(input)
    input.focus()
    input.select()

    const commit = async () => {
      const newName = input.value.trim()
      input.removeEventListener('blur', onBlur)
      if (!newName || newName === session.name || !SSH_SESSION_CONFIG.SESSION_NAME_RE.test(newName)) {
        this._rerenderSessionsBlock(conn.id)
        return
      }
      const result = await this._api.sshSessionRename(conn.id, session.name, newName)
      if (result?.success) {
        // Открытая вкладка со старым именем сессии должна узнать новое — иначе следующий
        // реконнект создаст пустую сессию под старым именем (см. index.js).
        this._bus.emit('ssh.session.renamed', { connectionId: conn.id, from: session.name, to: newName })
        await this._loadSessions(conn.id, { force: true })
      } else {
        this._rerenderSessionsBlock(conn.id)
      }
    }
    const onBlur = () => commit()
    input.addEventListener('blur', onBlur, { signal: this._cleanupController.signal })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur()
      if (e.key === 'Escape') { input.removeEventListener('blur', onBlur); this._rerenderSessionsBlock(conn.id) }
    }, { signal: this._cleanupController.signal })
  }

  async _killSession(conn, session) {
    const manual = !session.name.startsWith('etty-')
    const confirmed = await this._confirmDialog.open({
      title: 'Убить сессию?',
      message: manual
        ? `Сессия «${session.name}» похожа на созданную не через eTty вручную. Убить её на сервере «${conn.label}»? Все процессы внутри будут завершены.`
        : `Убить tmux-сессию «${session.name}» на сервере «${conn.label}»? Все процессы внутри будут завершены.`,
      confirmText: 'Убить',
      cancelText: 'Отмена',
    })
    if (!confirmed) return
    const result = await this._api.sshSessionKill(conn.id, session.name)
    if (result?.success) {
      await this._loadSessions(conn.id, { force: true })
    }
  }

  // — Перенос профилей (*.ettyx, задача #31, REQ-22/23) —

  _showToast(msg, type = 'error') {
    showToast(msg, type)
  }

  async _exportConnections() {
    if (this._connections.length === 0) {
      this._showToast('Нет подключений для экспорта')
      return
    }
    const form = await this._ettyxDialog.openExport()
    if (!form) return

    const result = await this._api.sshExportConnections({
      passphrase: form.passphrase,
      includePrivateKeys: form.includePrivateKeys,
    })
    if (result?.canceled) return
    if (!result?.success) {
      this._showToast(result?.error || 'Не удалось экспортировать подключения')
      return
    }
    this._showToast(`Экспортировано ${result.count} подключений`, 'success')
  }

  async _importConnections() {
    const picked = await this._api.sshImportPickFile()
    if (picked?.canceled) return

    const form = await this._ettyxDialog.openImport()
    if (!form) return

    const result = await this._api.sshImportConnections({
      path: picked.path,
      passphrase: form.passphrase,
    })
    if (!result?.success) {
      this._showToast(result?.error || 'Не удалось импортировать подключения')
      return
    }
    await this.refresh()
    const warnings = result.warnings || []
    if (warnings.length === 0) {
      this._showToast(`Импортировано ${result.imported} подключений`, 'success')
    } else {
      // Успех и предупреждения — один тост (не два подряд, второй перетёр бы первый, см.
      // _showToast/setTimeout): импорт всё равно прошёл, предупреждения — что доделать руками.
      this._showToast(`Импортировано ${result.imported} подключений.\n${warnings.join('\n')}`)
    }
  }

  // — Автообновление списка сессий, пока панель видима в режиме tmux —

  _startPollingIfNeeded() {
    if (this._pollTimer) return
    if (this._mode !== 'tmux' || !this.isVisible() || this._expanded.size === 0) return
    this._pollTimer = setInterval(() => this._refreshExpandedSessions(), SSH_SESSION_CONFIG.SESSIONS_POLL_MS)
  }

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
  }

  _stopPollingIfIdle() {
    if (this._expanded.size === 0) this._stopPolling()
  }

  _releaseAllMasters() {
    for (const id of this._expanded) this._api.sshMasterRelease(id)
    this._expanded.clear()
    this._newSessionDraft.clear()
  }

  /** Список сохранённых подключений (для меню «+» в таб-баре). */
  getConnections() {
    return [...this._connections]
  }

  /** Находит подключение по id (используется index.js для наследования cwd/подключения на новых вкладках). */
  getConnection(id) {
    return this._connections.find(c => c.id === id) || null
  }

  show() {
    if (this.isVisible()) return
    this._panelEl.classList.remove('hidden')
    this._resizeHandleEl.classList.remove('hidden')
    this.refresh()
    this._startPollingIfNeeded()
    this._bus.emit('ssh.resize')
  }

  hide() {
    if (!this.isVisible()) return
    this._panelEl.classList.add('hidden')
    this._resizeHandleEl.classList.add('hidden')
    this._stopPolling()
    this._bus.emit('ssh.resize')
  }

  toggle() {
    this.isVisible() ? this.hide() : this.show()
  }

  isVisible() {
    return !this._panelEl.classList.contains('hidden')
  }

  destroy() {
    this._unsubscribeActivity?.()
    this._unsubscribeActivity = null
    for (const timer of this._activityTimers.values()) clearTimeout(timer)
    this._activityTimers.clear()
    this._reloadQueued.clear()
    this._stopPolling()
    this._releaseAllMasters()
    this._cleanupController?.abort()
    this._cleanupController = null
    this._menu?.destroy()
    this._menu = null
    this._dialog?.destroy()
    this._dialog = null
    this._ettyxDialog?.destroy()
    this._ettyxDialog = null
    if (this._panelEl) this._panelEl.innerHTML = ''
    this._panelEl = null
    this._resizeHandleEl = null
    this._bus = null
    this._store = null
    this._api = null
    this._confirmDialog = null
  }
}

/** «N окон · команда · активна X назад» — краткая сводка строки сессии. */
function formatSessionMeta(session) {
  const parts = [`${session.windows} ${pluralWindows(session.windows)}`]
  if (session.currentCommand) parts.push(session.currentCommand)
  if (session.attached > 0) parts.push('подключена')
  else if (session.activityAt) parts.push(`активна ${formatRelativeTime(session.activityAt)}`)
  return parts.join(' · ')
}

function pluralWindows(n) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'окно'
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'окна'
  return 'окон'
}

function formatRelativeTime(ts) {
  const diffMs = Date.now() - ts
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} ч назад`
  const days = Math.floor(hours / 24)
  return `${days} дн назад`
}

/** Минимальный CSS.escape-фолбэк для селекторов по id/имени сессии (буквы/цифры/_/- — безопасны без него). */
function cssEscape(s) {
  return window.CSS?.escape ? window.CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&')
}
