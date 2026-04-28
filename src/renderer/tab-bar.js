/**
 * Управление вкладками терминала.
 * Каждая вкладка = {pid, term, fitAddon, container, element, rootPath, tabId, ...}
 * Сохраняет per-tab состояние дерева файлов (expandedDirs, scrollTop) при переключении.
 * Поддерживает drag-and-drop переупорядочивание и disabled-режим (блокировка переключения).
 */
import { ContextMenu } from './components/base/context-menu/context-menu.js'
import { APP_CONFIG } from './core/config/app-config.js'

export class TabBar {
  constructor({ tabBarEl, terminalContainerEl, onSwitch, onAddTab, onCloseTab }) {
    this.tabBarEl = tabBarEl
    this.terminalContainerEl = terminalContainerEl
    this.onSwitch = onSwitch
    this.onAddTab = onAddTab
    this.onCloseTab = onCloseTab

    this.tabs = []
    this.activeIndex = -1
    this.disabled = false

    this._addBtn = tabBarEl.querySelector('#tab-add')
    this._addBtn.addEventListener('click', () => this.onAddTab())

    this._contextMenu = new ContextMenu()

    // Drag-and-drop state
    this._dragState = null
    this._dropIndicator = null
    this._onDragMove = this._onDragMove.bind(this)
    this._onDragEnd = this._onDragEnd.bind(this)
  }

  addTab({ pid, term, fitAddon, rootPath, tabId }) {
    const folderName = rootPath.split('/').filter(Boolean).pop() || '/'
    const container = document.createElement('div')
    container.className = 'terminal-pane'
    this.terminalContainerEl.appendChild(container)
    term.open(container)

    const element = this._createTabEl(folderName, '')
    this.tabBarEl.insertBefore(element, this._addBtn)

    const tab = { pid, term, fitAddon, container, element, rootPath, folderName, termTitle: '', tabId,
      treeExpandedDirs: new Set(),
      treeScrollTop: 0
    }
    this.tabs.push(tab)

    term.onTitleChange((title) => {
      tab.termTitle = title
      this._updateTabLabel(tab)
    })

    this.switchTo(this.tabs.length - 1)
    return tab
  }

  removeTab(index) {
    const tab = this.tabs[index]
    tab.term.dispose()
    tab.container.remove()
    tab.element.remove()
    this.tabs.splice(index, 1)

    if (this.tabs.length === 0) {
      window.close()
      return
    }

    const nextIndex = Math.min(index, this.tabs.length - 1)
    this.switchTo(nextIndex)
  }

  switchTo(index) {
    if (this.disabled) return
    const prevTab = this.activeIndex >= 0 ? this.tabs[this.activeIndex] : null
    if (prevTab) {
      prevTab.container.classList.remove('active')
      prevTab.element.classList.remove('active')
    }

    this.activeIndex = index
    const tab = this.tabs[index]
    tab.container.classList.add('active')
    tab.element.classList.add('active')

    tab.fitAddon.fit()
    tab.term.focus()

    this.onSwitch(tab, prevTab)
  }

  getActive() {
    return this.tabs[this.activeIndex] ?? null
  }

  updateRootPath(index, rootPath) {
    const tab = this.tabs[index]
    if (!tab) return
    tab.rootPath = rootPath
    tab.folderName = rootPath.split('/').filter(Boolean).pop() || '/'
    this._updateTabLabel(tab)
  }

  _createTabEl(folderName, termTitle) {
    const el = document.createElement('div')
    el.className = 'tab'

    const handle = document.createElement('span')
    handle.className = 'tab-drag-handle'
    handle.innerHTML = '<svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor"><circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/><circle cx="2" cy="6" r="1.2"/><circle cx="6" cy="6" r="1.2"/><circle cx="2" cy="10" r="1.2"/><circle cx="6" cy="10" r="1.2"/></svg>'

    const folder = document.createElement('span')
    folder.className = 'tab-folder'
    folder.textContent = folderName

    const title = document.createElement('span')
    title.className = 'tab-title'
    title.textContent = termTitle

    const closeBtn = document.createElement('button')
    closeBtn.className = 'tab-close'
    closeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/></svg>'

    el.appendChild(handle)
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
      if (i >= 0) this.onCloseTab(i)
    })

    // Context menu
    el.addEventListener('contextmenu', (e) => {
      if (this.disabled) return
      e.preventDefault()
      const i = this.tabs.findIndex(t => t.element === el)
      if (i >= 0) this._showTabContextMenu(i, e.clientX, e.clientY)
    })

    // Drag-and-drop
    el.addEventListener('mousedown', (e) => {
      if (this.disabled) return
      if (e.button !== 0) return
      if (e.target.closest('.tab-close')) return
      const isOnHandle = !!e.target.closest('.tab-drag-handle')
      if (!isOnHandle) return
      const i = this.tabs.findIndex(t => t.element === el)
      if (i >= 0) this._initDrag(i, e)
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
    for (let i = this.tabs.length - 1; i >= 0; i--) {
      this.onCloseTab(i)
    }
  }

  _closeAllExcept(keepIndex) {
    const keepTab = this.tabs[keepIndex]
    for (let i = this.tabs.length - 1; i >= 0; i--) {
      if (this.tabs[i] === keepTab) continue
      this.onCloseTab(i)
    }
  }

  _closeRange(from, to) {
    for (let i = to - 1; i >= from; i--) {
      this.onCloseTab(i)
    }
  }

  // — Drag-and-drop —

  _initDrag(tabIndex, e) {
    e.stopPropagation()
    e.preventDefault()

    this._dragState = {
      tabIndex,
      startX: e.clientX,
      startY: e.clientY,
      isDragging: false,
      tabEl: this.tabs[tabIndex].element,
      dropTargetIndex: null
    }

    document.addEventListener('mousemove', this._onDragMove)
    document.addEventListener('mouseup', this._onDragEnd)
  }

  _onDragMove(e) {
    const ds = this._dragState
    if (!ds) return

    const dx = e.clientX - ds.startX
    const dy = e.clientY - ds.startY

    if (!ds.isDragging) {
      if (Math.abs(dx) < APP_CONFIG.DRAG_START_THRESHOLD_PX && Math.abs(dy) < APP_CONFIG.DRAG_START_THRESHOLD_PX) return
      ds.isDragging = true
      ds.tabEl.classList.add('dragging')
      document.body.style.cursor = 'grabbing'
      this._createDropIndicator()
    }

    const targetIndex = this._getDropIndex(e.clientX)
    if (targetIndex !== ds.dropTargetIndex) {
      ds.dropTargetIndex = targetIndex
      this._positionDropIndicator(targetIndex)
    }
  }

  _onDragEnd() {
    document.removeEventListener('mousemove', this._onDragMove)
    document.removeEventListener('mouseup', this._onDragEnd)

    const ds = this._dragState
    if (!ds) return

    if (ds.isDragging && ds.dropTargetIndex != null) {
      this._reorderTab(ds.tabIndex, ds.dropTargetIndex)
    }

    ds.tabEl.classList.remove('dragging')
    document.body.style.cursor = ''
    this._removeDropIndicator()
    this._dragState = null
  }

  _getDropIndex(clientX) {
    for (let i = 0; i < this.tabs.length; i++) {
      const rect = this.tabs[i].element.getBoundingClientRect()
      const midX = rect.left + rect.width / 2
      if (clientX < midX) return i
    }
    return this.tabs.length
  }

  _reorderTab(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex + 1 === toIndex) return

    const tab = this.tabs[fromIndex]
    this.tabs.splice(fromIndex, 1)
    const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex
    this.tabs.splice(insertAt, 0, tab)

    // Move DOM
    if (insertAt >= this.tabs.length - 1) {
      this.tabBarEl.insertBefore(tab.element, this._addBtn)
    } else {
      this.tabBarEl.insertBefore(tab.element, this.tabs[insertAt + 1].element)
    }

    // Update activeIndex
    this.activeIndex = this.tabs.findIndex(t => t.element.classList.contains('active'))
  }

  _createDropIndicator() {
    this._dropIndicator = document.createElement('div')
    this._dropIndicator.className = 'tab-drop-indicator'
    this.tabBarEl.appendChild(this._dropIndicator)
  }

  _positionDropIndicator(targetIndex) {
    if (!this._dropIndicator) return
    const barRect = this.tabBarEl.getBoundingClientRect()
    let left
    if (targetIndex < this.tabs.length) {
      const rect = this.tabs[targetIndex].element.getBoundingClientRect()
      left = rect.left - barRect.left - 1
    } else {
      const lastRect = this.tabs[this.tabs.length - 1].element.getBoundingClientRect()
      left = lastRect.right - barRect.left - 1
    }
    this._dropIndicator.style.left = left + 'px'
  }

  _removeDropIndicator() {
    if (this._dropIndicator) {
      this._dropIndicator.remove()
      this._dropIndicator = null
    }
  }

  exportState() {
    return this.tabs
      .filter(t => t.rootPath)
      .map((t, i) => ({
        rootPath: t.rootPath,
        isActive: i === this.activeIndex,
        tabId: t.tabId
      }))
  }

  _updateTabLabel(tab) {
    tab.element.querySelector('.tab-folder').textContent = tab.folderName
    tab.element.querySelector('.tab-title').textContent = tab.termTitle
  }
}
