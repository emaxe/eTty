/**
 * Управление вкладками терминала.
 * Каждая вкладка = {pid, term, fitAddon, container, element, rootPath, tabId, ...}
 * Сохраняет per-tab состояние дерева файлов (expandedDirs, scrollTop) при переключении.
 */
export class TabBar {
  constructor({ tabBarEl, terminalContainerEl, onSwitch, onAddTab, onCloseTab }) {
    this.tabBarEl = tabBarEl
    this.terminalContainerEl = terminalContainerEl
    this.onSwitch = onSwitch
    this.onAddTab = onAddTab
    this.onCloseTab = onCloseTab

    this.tabs = []
    this.activeIndex = -1

    this._addBtn = tabBarEl.querySelector('#tab-add')
    this._addBtn.addEventListener('click', () => this.onAddTab())
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
    el.innerHTML = `
      <span class="tab-folder">${folderName}</span>
      <span class="tab-title">${termTitle}</span>
      <button class="tab-close">✕</button>
    `
    el.addEventListener('click', (e) => {
      if (!e.target.classList.contains('tab-close')) {
        const i = this.tabs.findIndex(t => t.element === el)
        if (i >= 0) this.switchTo(i)
      }
    })
    el.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation()
      const i = this.tabs.findIndex(t => t.element === el)
      if (i >= 0) this.onCloseTab(i)
    })
    return el
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
