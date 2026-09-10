/**
 * Боковая панель SSH-подключений: список настроенных подключений, добавление/
 * редактирование/удаление, drag-and-drop переупорядочивание. Клик по строке
 * открывает новую SSH-вкладку терминала (см. `bus.on('ssh.connect', ...)` в index.js).
 * Паттерн построения DOM — как у GitPanel: пустой overlay-контейнер строится в конструкторе.
 */
import { Icons } from '../../icons.js'
import { ContextMenu } from '../../components/base/context-menu/context-menu.js'
import { SshConnectionDialog } from './ssh-connection-dialog.js'

export class SshPanel {
  /**
   * @param {Object} deps
   * @param {HTMLElement} deps.panelEl
   * @param {HTMLElement} deps.resizeHandleEl
   * @param {import('../../core/event-bus.js').EventBus} deps.eventBus
   * @param {import('../../core/state-store.js').StateStore} deps.store
   * @param {import('../../core/adapters/electron-api.js').ElectronApiAdapter} deps.api
   * @param {import('../../confirm-dialog.js').ConfirmDialog} deps.confirmDialog
   */
  constructor({ panelEl, resizeHandleEl, eventBus, store, api, confirmDialog }) {
    this._panelEl = panelEl
    this._resizeHandleEl = resizeHandleEl
    this._bus = eventBus
    this._store = store
    this._api = api
    this._confirmDialog = confirmDialog

    this._connections = []
    this._cleanupController = new AbortController()
    this._menu = new ContextMenu()
    this._dialog = new SshConnectionDialog({ api })

    this._buildDOM()
    this._bindEvents()
  }

  _buildDOM() {
    this._panelEl.innerHTML = `
      <div class="ssh-panel-header">
        <span class="ssh-panel-title">SSH</span>
        <button class="ssh-panel-add-btn" type="button" title="Добавить подключение">${Icons.plus}</button>
      </div>
      <div class="ssh-panel-list"></div>
    `
    this._btnAdd = this._panelEl.querySelector('.ssh-panel-add-btn')
    this._listEl = this._panelEl.querySelector('.ssh-panel-list')
  }

  _bindEvents() {
    const signal = this._cleanupController.signal
    this._btnAdd.addEventListener('click', () => this._openDialog(null), { signal })
    this._listEl.addEventListener('dragover', (e) => {
      e.preventDefault()
      const dragging = this._listEl.querySelector('.ssh-row.dragging')
      if (!dragging) return
      const after = this._getDragAfterElement(e.clientY)
      if (after) this._listEl.insertBefore(dragging, after)
      else this._listEl.appendChild(dragging)
    }, { signal })
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
    }
  }

  _buildRow(conn) {
    const row = document.createElement('div')
    row.className = 'ssh-row'
    row.draggable = true
    row.dataset.id = conn.id

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
      this._bus.emit('ssh.connect', { connectionId: conn.id })
    })
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      this._showRowContextMenu(conn, e.clientX, e.clientY)
    })

    row.addEventListener('dragstart', () => {
      row.classList.add('dragging')
    })
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging')
      this._persistOrder()
    })

    return row
  }

  _showRowContextMenu(conn, x, y) {
    this._menu.show([
      { label: 'Подключиться', action: () => this._bus.emit('ssh.connect', { connectionId: conn.id }) },
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
    this._api.sshReorder(ids)
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
    this._bus.emit('ssh.resize')
  }

  hide() {
    if (!this.isVisible()) return
    this._panelEl.classList.add('hidden')
    this._resizeHandleEl.classList.add('hidden')
    this._bus.emit('ssh.resize')
  }

  toggle() {
    this.isVisible() ? this.hide() : this.show()
  }

  isVisible() {
    return !this._panelEl.classList.contains('hidden')
  }

  destroy() {
    this._cleanupController?.abort()
    this._cleanupController = null
    this._menu?.destroy()
    this._menu = null
    this._dialog?.destroy()
    this._dialog = null
    if (this._panelEl) this._panelEl.innerHTML = ''
    this._panelEl = null
    this._resizeHandleEl = null
    this._bus = null
    this._store = null
    this._api = null
    this._confirmDialog = null
  }
}
