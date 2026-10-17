/**
 * Управление вкладками терминала.
 * Каждая вкладка = {pid, term, fitAddon, container, element, rootPath, tabId, ...}
 * Сохраняет per-tab состояние дерева файлов (expandedDirs, scrollTop) при переключении.
 * Поддерживает drag-and-drop переупорядочивание и disabled-режим (блокировка переключения).
 */
import { ContextMenu } from './components/base/context-menu/context-menu.js'
import { DraggableTabs } from './components/base/tabs/draggable-tabs.js'
import { APP_CONFIG } from './core/config/app-config.js'
import { Icons } from './icons.js'
import { buildSessionNameBase } from '../shared/ssh-session-name.js'

/**
 * Текст бейджа tmux-вкладки: `tmux` для сессии с базовым именем, `tmux N` для авто-нумерованных
 * (`<base>-N`), `tmux · <имя>` для сессий с пользовательским именем — иначе несколько
 * tmux-вкладок одного сервера неразличимы (у всех label подключения).
 * @param {{ connectionId?: string, sessionName?: string }|null} ssh
 */
function tmuxBadgeText(ssh) {
  const name = ssh?.sessionName
  if (!name || !ssh.connectionId) return 'tmux'
  const base = buildSessionNameBase(ssh.connectionId)
  if (name === base) return 'tmux'
  const suffix = name.startsWith(`${base}-`) ? name.slice(base.length + 1) : ''
  if (/^\d+$/.test(suffix)) return `tmux ${suffix}`
  return `tmux · ${name}`
}

export class TabBar {
  constructor({ tabBarEl, terminalContainerEl, eventBus, store, paths }) {
    this._paths = paths
    this.tabBarEl = tabBarEl
    this.terminalContainerEl = terminalContainerEl
    this._bus = eventBus
    this._store = store

    this.tabs = []
    this.activeIndex = -1
    this.disabled = false

    this._tabListEl = tabBarEl.querySelector('#tab-list')
    this._addBtn = tabBarEl.querySelector('#tab-add')
    this._cleanupController = new AbortController()
    this._addBtn.addEventListener('click', (e) => this._bus.emit('tab.add', { metaKey: e.metaKey, ctrlKey: e.ctrlKey }), { signal: this._cleanupController.signal })
    // ПКМ по «+» — выбор типа новой вкладки (локальная / SSH-подключение), обрабатывает index.js
    this._addBtn.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const rect = this._addBtn.getBoundingClientRect()
      this._bus.emit('tab.add.menu', { x: rect.left, y: rect.bottom })
    }, { signal: this._cleanupController.signal })

    this._contextMenu = new ContextMenu()

    this._draggable = new DraggableTabs(this._tabListEl, {
      onReorder: (fromIndex, toIndex) => this._handleReorder(fromIndex, toIndex),
      dragHandleSelector: '.tab-drag-handle'
    })
  }

  syncStore() {
    this._store.set('tabs.items', this.tabs.map(t => ({
      pid: t.pid,
      rootPath: t.rootPath,
      tabId: t.tabId,
      folderName: t.folderName,
      termTitle: t.termTitle,
      ssh: t.ssh ? { connectionId: t.ssh.connectionId, label: t.ssh.label, sessionName: t.ssh.sessionName, persistence: t.ssh.persistence } : null,
      sshFsAvailable: t._sshFsAvailable ?? null
    })))
    this._store.set('tabs.activeIndex', this.activeIndex)
  }

  addTab({ pid, term, fitAddon, rootPath, tabId, ssh, remoteCwd, shellKind = null }, insertIndex = -1) {
    const folderName = ssh ? ssh.label : (this._paths.local.basename(rootPath) || rootPath)
    const container = document.createElement('div')
    container.className = 'terminal-pane'
    this.terminalContainerEl.appendChild(container)
    term.open(container)

    // Известно уже здесь для восстановленных вкладок (persistence пережил tabs-state.json);
    // для новых — уточнится позже через setTabTmux() из connectSshTab, когда main подтвердит
    // resolved persistence (см. shared/ssh-persistence.js).
    const element = this._createTabEl(folderName, '', !!ssh, ssh?.persistence === 'tmux' ? tmuxBadgeText(ssh) : null)

    const tab = { pid, term, fitAddon, container, element, rootPath, folderName, termTitle: '', tabId, ssh: ssh || null,
      shellKind, // вид локальной оболочки из pty:create (диалект команд — core/shell-commands.js)
      remoteCwd: remoteCwd || null,
      treeExpandedDirs: new Set(),
      treeScrollTop: 0,
      _pendingData: [],
      _pendingDataSize: 0,
      _isActive: false,
    }

    if (insertIndex >= 0 && insertIndex < this.tabs.length) {
      const refEl = this.tabs[insertIndex].element
      this._tabListEl.insertBefore(element, refEl)
      this.tabs.splice(insertIndex, 0, tab)
    } else {
      this._tabListEl.appendChild(element)
      this.tabs.push(tab)
      insertIndex = this.tabs.length - 1
    }

    this._draggable.observeElement(element)
    this.syncStore()

    term.onTitleChange((title) => {
      tab.termTitle = title
      this._updateTabLabel(tab)
    })

    this.switchTo(insertIndex)
    return tab
  }

  removeTab(index) {
    const tab = this.tabs[index]
    tab.term.dispose()
    tab.container.remove()
    tab.element.remove()
    this.tabs.splice(index, 1)
    this.syncStore()

    if (this.tabs.length === 0) {
      window.close()
      return
    }

    const nextIndex = Math.min(index, this.tabs.length - 1)
    this.switchTo(nextIndex)
  }

  switchTo(index) {
    if (this.disabled) return
    // Защита от пустого/невалидного индекса — например, если все вкладки не удалось
    // восстановить (см. createTab() catch в index.js) и tabs остался пустым.
    if (!this.tabs[index]) return
    const prevTab = this.activeIndex >= 0 ? this.tabs[this.activeIndex] : null
    if (prevTab) {
      prevTab.container.classList.remove('active')
      prevTab.element.classList.remove('active')
      prevTab._isActive = false
    }

    this.activeIndex = index
    this.syncStore()

    const tab = this.tabs[index]
    tab.container.classList.add('active')
    tab.element.classList.add('active')
    tab._isActive = true

    // Flush buffered PTY data for the now-active tab
    if (tab._pendingData.length > 0) {
      const data = tab._pendingData.join('')
      tab._pendingData = []
      tab._pendingDataSize = 0
      tab.term.write(data)
    }

    tab.fitAddon.fit()
    tab.term.focus()

    this._bus.emit('tab.switch', { tab, prevTab })
  }

  getActive() {
    return this.tabs[this.activeIndex] ?? null
  }

  /** Переключает активную вкладку на соседнюю с зацикливанием. delta: -1 (влево) / +1 (вправо). */
  switchRelative(delta) {
    const n = this.tabs.length
    if (n <= 1) return
    this.switchTo((this.activeIndex + delta + n) % n)
  }

  updateRootPath(index, rootPath) {
    const tab = this.tabs[index]
    if (!tab || tab.ssh) return // SSH-вкладки хранят локальный rootPath, но не переименовываются по нему
    tab.rootPath = rootPath
    tab.folderName = this._paths.local.basename(rootPath) || rootPath
    this._updateTabLabel(tab)
  }

  /** @param {string|null} tmuxBadge — текст бейджа tmux-вкладки (см. tmuxBadgeText), null — не tmux */
  _createTabEl(folderName, termTitle, isSsh = false, tmuxBadge = null) {
    const el = document.createElement('div')
    el.className = isSsh ? 'tab tab-ssh' : 'tab'
    if (tmuxBadge) el.classList.add('tab-tmux')

    const handle = document.createElement('span')
    handle.className = 'tab-drag-handle'
    handle.innerHTML = '<svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor"><circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/><circle cx="2" cy="6" r="1.2"/><circle cx="6" cy="6" r="1.2"/><circle cx="2" cy="10" r="1.2"/><circle cx="6" cy="10" r="1.2"/></svg>'

    el.appendChild(handle)

    if (isSsh) {
      const icon = document.createElement('span')
      icon.className = 'tab-icon'
      icon.innerHTML = Icons.ssh
      el.appendChild(icon)
    }

    if (tmuxBadge) {
      const badge = document.createElement('span')
      badge.className = 'tab-badge'
      badge.textContent = tmuxBadge
      el.appendChild(badge)
    }

    const folder = document.createElement('span')
    folder.className = 'tab-folder'
    folder.textContent = folderName

    const title = document.createElement('span')
    title.className = 'tab-title'
    title.textContent = termTitle

    const closeBtn = document.createElement('button')
    closeBtn.className = 'tab-close'
    closeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/></svg>'

    el.appendChild(folder)
    el.appendChild(title)
    el.appendChild(closeBtn)

    el.addEventListener('click', (e) => {
      if (this.disabled) return
      if (!e.target.classList.contains('tab-close')) {
        const i = this.tabs.findIndex(t => t.element === el)
        if (i >= 0) this.switchTo(i)
      }
    })
    closeBtn.addEventListener('click', (e) => {
      if (this.disabled) return
      e.stopPropagation()
      const i = this.tabs.findIndex(t => t.element === el)
      if (i >= 0) this._bus.emit('tab.close.request', { tabs: [this.tabs[i]] })
    })

    // Context menu
    el.addEventListener('contextmenu', (e) => {
      if (this.disabled) return
      e.preventDefault()
      const i = this.tabs.findIndex(t => t.element === el)
      if (i >= 0) this._showTabContextMenu(i, e.clientX, e.clientY)
    })

    return el
  }

  // — Context menu —

  _showTabContextMenu(index, x, y) {
    const total = this.tabs.length
    this._contextMenu.show([
      { label: 'Закрыть все', action: () => this._closeAll() },
      { label: 'Закрыть все кроме этой', action: () => this._closeAllExcept(index), disabled: total <= 1 },
      { separator: true },
      { label: 'Закрыть все слева', action: () => this._closeRange(0, index), disabled: index === 0 },
      { label: 'Закрыть все справа', action: () => this._closeRange(index + 1, total), disabled: index === total - 1 }
    ], x, y)
  }

  _closeAll() {
    this._bus.emit('tab.close.request', { tabs: [...this.tabs] })
  }

  _closeAllExcept(keepIndex) {
    const keepTab = this.tabs[keepIndex]
    this._bus.emit('tab.close.request', { tabs: this.tabs.filter(t => t !== keepTab) })
  }

  _closeRange(from, to) {
    this._bus.emit('tab.close.request', { tabs: this.tabs.slice(from, to) })
  }

  _handleReorder(fromIndex, toIndex) {
    const tab = this.tabs[fromIndex]
    this.tabs.splice(fromIndex, 1)
    this.tabs.splice(toIndex, 0, tab)

    // Update activeIndex
    if (this.activeIndex === fromIndex) {
      this.activeIndex = toIndex
    } else if (fromIndex < this.activeIndex && toIndex >= this.activeIndex) {
      this.activeIndex--
    } else if (fromIndex > this.activeIndex && toIndex <= this.activeIndex) {
      this.activeIndex++
    }
    this.syncStore()
  }

  exportState() {
    return this.tabs
      .filter(t => t.rootPath)
      .map((t, i) => ({
        rootPath: t.rootPath,
        isActive: i === this.activeIndex,
        tabId: t.tabId,
        ssh: t.ssh ? { connectionId: t.ssh.connectionId, label: t.ssh.label, sessionName: t.ssh.sessionName, persistence: t.ssh.persistence } : undefined,
        // Последний известный удалённый cwd — при восстановлении пытаемся открыть именно его,
        // а не заново $HOME (см. index.js: restore + connectSshTab)
        remoteCwd: t.ssh ? (t.remoteCwd || undefined) : undefined,
        // Состояние ИИ-агента. Переживает рестарт только у tmux-вкладок (процесс живёт в
        // персистентной сессии); применяется при восстановлении лишь для persistence==='tmux'
        // (см. applySavedAgentState в index.js), затем сверяется с реальной командой панели.
        activeAgentId: t.activeAgentId || undefined,
        isBusy: t.isBusy || undefined
      }))
  }

  destroy() {
    for (const tab of this.tabs) {
      tab.term.dispose()
      tab.container.remove()
      tab.element.remove()
    }
    this.tabs = []
    this.activeIndex = -1

    this._draggable.destroy()
    this._contextMenu.destroy()
    this._cleanupController?.abort()
    this._cleanupController = null

    this.tabBarEl = null
    this.terminalContainerEl = null
    this._tabListEl = null
    this._addBtn = null
    this._bus = null
    this._store = null
  }

  _updateTabLabel(tab) {
    tab.element.querySelector('.tab-folder').textContent = tab.folderName
    tab.element.querySelector('.tab-title').textContent = tab.termTitle
    // SSH-вкладки держат folderName === ssh.label (не переименовываются по cd, см.
    // updateRootPath) — реальный текущий путь виден по hover через title.
    if (tab.ssh) {
      const sessionPart = tab.ssh.persistence === 'tmux' && tab.ssh.sessionName ? ` · tmux:${tab.ssh.sessionName}` : ''
      tab.element.title = `${tab.ssh.label}${sessionPart} — ${tab.rootPath || ''}`
    }
  }

  /**
   * Переключает индикацию tmux-вкладки (бейдж + класс) уже ПОСЛЕ создания элемента — нужно
   * для новых (не восстановленных) вкладок: `persistence` этого запуска подтверждается main
   * асинхронно (см. `resolveSshPersistence`), после того как элемент вкладки уже создан
   * (`addTab()` строит его синхронно ДО ответа `pty:create`).
   */
  setTabTmux(tab, isTmux) {
    if (!tab?.element) return
    tab.element.classList.toggle('tab-tmux', !!isTmux)
    let badge = tab.element.querySelector('.tab-badge')
    // Текст пересчитываем на каждом вызове, а не только при смене класса: имя сессии приходит/
    // меняется уже после создания элемента (переподключение, переименование из панели).
    if (isTmux && badge) {
      badge.textContent = tmuxBadgeText(tab.ssh)
    } else if (isTmux && !badge) {
      badge = document.createElement('span')
      badge.className = 'tab-badge'
      badge.textContent = tmuxBadgeText(tab.ssh)
      // После .tab-icon (если есть) и до .tab-folder — тот же порядок, что в _createTabEl().
      const icon = tab.element.querySelector('.tab-icon')
      const folder = tab.element.querySelector('.tab-folder')
      tab.element.insertBefore(badge, icon ? icon.nextSibling : folder)
    } else if (!isTmux && badge) {
      badge.remove()
    }
  }
}
