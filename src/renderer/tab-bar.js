/**
 * Управление вкладками терминала.
 * Каждая вкладка = {pid, term, fitAddon, container, element, rootPath, tabId, ...}
 * Сохраняет per-tab состояние дерева файлов (expandedDirs, scrollTop) при переключении.
 * Поддерживает drag-and-drop переупорядочивание и disabled-режим (блокировка переключения).
 */
import { ContextMenu } from './components/base/context-menu/context-menu.js'
import { DraggableTabs } from './components/base/tabs/draggable-tabs.js'
import { APP_CONFIG } from './core/config/app-config.js'

export class TabBar {
  constructor({ tabBarEl, terminalContainerEl, eventBus }) {
    this.tabBarEl = tabBarEl
    this.terminalContainerEl = terminalContainerEl
    this._bus = eventBus

    this.tabs = []
    this.activeIndex = -1
    this.disabled = false

    this._addBtn = tabBarEl.querySelector('#tab-add')
    this._addBtn.addEventListener('click', () => this._bus.emit('tab.add'))

    this._contextMenu = new ContextMenu()

    this._draggable = new DraggableTabs(this.tabBarEl, {
      onReorder: (fromIndex, toIndex) => this._handleReorder(fromIndex, toIndex),
      dragHandleSelector: '.tab-drag-handle',
      excludedSelector: '#tab-add'
    })
  }

  addTab({ pid, term, fitAddon, rootPath, tabId }) {
    const folderName = rootPath.split('/').filter(Boolean).pop() || '/'
    const container = document.createElement('div')
    container.className = 'terminal-pane'
    this.terminalContainerEl.appendChild(container)
    term.open(container)

    const element = this._createTabEl(folderName, '')
    this.tabBarEl.insertBefore(element, this._addBtn)
    this._draggable.observeElement(element)

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

    this._bus.emit('tab.switch', { tab, prevTab })
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
      if (i >= 0) this._bus.emit('tab.close', { index: i, tab: this.tabs[i] })
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
    for (let i = this.tabs.length - 1; i >= 0; i--) {
      this._bus.emit('tab.close', { index: i, tab: this.tabs[i] })
    }
  }

  _closeAllExcept(keepIndex) {
    const keepTab = this.tabs[keepIndex]
    for (let i = this.tabs.length - 1; i >= 0; i--) {
      if (this.tabs[i] === keepTab) continue
      this._bus.emit('tab.close', { index: i, tab: this.tabs[i] })
    }
  }

  _closeRange(from, to) {
    for (let i = to - 1; i >= from; i--) {
      this._bus.emit('tab.close', { index: i, tab: this.tabs[i] })
    }
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
