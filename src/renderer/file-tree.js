import { ContextMenu } from './components/base/context-menu/context-menu.js'
import { Icons } from './icons.js'

/**
 * Дерево файлов в sidebar. Lazy-load поддиректорий, контекстные меню,
 * fs.watch для автообновления, copy/paste, показ/скрытие dotfiles.
 * Состояние (expanded dirs, scroll) сохраняется per-tab при переключении.
 *
 * Фичи:
 * - Multi-select: Ctrl/Cmd+Click = toggle, Shift+Click = range, Ctrl+A = all
 * - Drag & Drop: HTML5 DnD для перетаскивания файлов/папок
 * - Undo: Ctrl+Z для отката move-операций
 */
export class FileTree {
  constructor(container, { eventBus } = {}) {
    this._container = container
    this._bus = eventBus
    this._cwd = null
    this._modKeys = { shift: false, meta: false, ctrl: false }
    this._contextMenu = new ContextMenu()
    this._dirTimers = new Map()
    this._hoverOverlay = this._createHoverOverlay()
    const sidebar = document.getElementById('sidebar')
    if (sidebar) sidebar.appendChild(this._hoverOverlay)

    // Multi-select state
    this._selectedPaths = new Set()
    this._lastSelectedAnchor = null

    // Undo stack for move operations
    this._moveHistory = []

    // Auto-expand timer during drag
    this._autoExpandTimer = null
    this._isDragging = false

    // Auto-scroll during drag
    this._autoScrollTimer = null
    this._autoScrollDirection = 0

    this._container.addEventListener('scroll', () => {
      if (this._hoverOverlay.style.display !== 'none' && this._hoverOverlay._currentRow) {
        this._positionHoverOverlay(this._hoverOverlay._currentRow)
      }
    })

    this._setupModKeyListeners()
    this._setupKeyboardShortcuts()
  }

  _createHoverOverlay() {
    const overlay = document.createElement('div')
    overlay.className = 'tree-hover-overlay'
    overlay.style.display = 'none'

    const btns = document.createElement('div')
    btns.className = 'tree-hover-buttons'

    const cdBtn = document.createElement('button')
    cdBtn.className = 'tree-hover-cd'
    cdBtn.title = 'cd в директорию'
    cdBtn.innerHTML = Icons.arrowRight
    btns.appendChild(cdBtn)

    const copyBtn = document.createElement('button')
    copyBtn.className = 'tree-hover-copy'
    copyBtn.title = 'Копировать путь'
    copyBtn.innerHTML = Icons.copy
    btns.appendChild(copyBtn)

    overlay.appendChild(btns)

    let _copyRevertTimer = null
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation()
      e.preventDefault()
      const path = overlay.dataset.currentPath
      const rel = overlay.dataset.currentRel
      const pathToUse = e.shiftKey ? path : rel
      if (e.metaKey || e.ctrlKey) {
        this._bus.emit('terminal.focus')
        this._bus.emit('filetree.inject', pathToUse)
      } else {
        await navigator.clipboard.writeText(pathToUse)
        this._bus.emit('terminal.focus')
        // Flash OK icon to indicate success
        copyBtn.innerHTML = Icons.ok
        copyBtn.classList.add('success')
        clearTimeout(_copyRevertTimer)
        _copyRevertTimer = setTimeout(() => {
          copyBtn.innerHTML = Icons.copy
          copyBtn.classList.remove('success')
        }, 1500)
      }
    })

    cdBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      e.preventDefault()
      const path = overlay.dataset.currentPath
      const escaped = path.replace(/'/g, "'\\''")
      this._bus.emit('filetree.shellCmd', `cd '${escaped}'\r`)
      this._bus.emit('terminal.focus')
    })

    overlay.addEventListener('mouseenter', () => {
      // Keep overlay visible when mouse enters it
    })
    overlay.addEventListener('mouseleave', () => {
      this._hideHoverOverlay()
    })

    return overlay
  }

  _positionHoverOverlay(row) {
    const sidebar = document.getElementById('sidebar')
    if (!sidebar) return
    const sidebarRect = sidebar.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    const containerRect = this._container.getBoundingClientRect()

    // Hide if row scrolled out of container vertically
    if (rowRect.top < containerRect.top || rowRect.bottom > containerRect.bottom) {
      this._hideHoverOverlay()
      return
    }

    this._hoverOverlay.style.top = (rowRect.top - sidebarRect.top) + 'px'
  }

  _showHoverOverlay(row, entry, rel) {
    this._hoverOverlay._currentRow = row
    this._hoverOverlay.dataset.currentPath = entry.path
    this._hoverOverlay.dataset.currentRel = rel
    this._hoverOverlay.dataset.isDir = entry.isDirectory ? '1' : '0'

    const cdBtn = this._hoverOverlay.querySelector('.tree-hover-cd')
    cdBtn.style.display = entry.isDirectory ? 'flex' : 'none'
    cdBtn.disabled = this._isBusy

    this._positionHoverOverlay(row)
    this._hoverOverlay.style.display = 'flex'
    row.classList.add('hovered')
  }

  _hideHoverOverlay() {
    const row = this._hoverOverlay._currentRow
    this._hoverOverlay.style.display = 'none'
    this._hoverOverlay._currentRow = null
    row?.classList.remove('hovered')
  }

  _setupModKeyListeners() {
    document.addEventListener('keydown', (e) => {
      this._modKeys.shift = e.shiftKey
      this._modKeys.meta = e.metaKey
      this._modKeys.ctrl = e.ctrlKey
      this._updateHoverButtonsState()
    })
    document.addEventListener('keyup', (e) => {
      this._modKeys.shift = e.shiftKey
      this._modKeys.meta = e.metaKey
      this._modKeys.ctrl = e.ctrlKey
      this._updateHoverButtonsState()
    })
    window.addEventListener('blur', () => {
      this._modKeys.shift = false
      this._modKeys.meta = false
      this._modKeys.ctrl = false
      this._updateHoverButtonsState()
    })
  }

  _setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const sidebar = document.getElementById('sidebar')
      if (!sidebar || !sidebar.contains(e.target)) return

      if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        e.stopPropagation()
        this._selectAllVisible()
      }
      if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        this._undoLastMove()
      }
    })
  }

  getCwd() {
    return this._cwd
  }

  setIsBusy(busy) {
    this._isBusy = busy
    this._updateCdButtonsState()
  }

  _updateCdButtonsState() {
    const cdBtn = this._hoverOverlay?.querySelector('.tree-hover-cd')
    if (cdBtn) cdBtn.disabled = this._isBusy
  }

  _updateHoverButtonsState() {
    // Обновляет состояние кнопок при наведении на основе модификаторов клавиш
    // Вызывается при keydown/keyup для обновления UI
  }

  setShowHidden(val) {
    this._showHidden = val
    this._refreshList(this._rootContainer, this._cwd, 1)
  }

  setCollapseChildrenOnClose(val) {
    this._collapseChildrenOnClose = val
  }

  setFileOpenMode(mode) {
    this._fileOpenMode = mode === 'single' ? 'single' : 'double'
  }

  getExpandedDirs() {
    const result = new Set()
    const openItems = this._container.querySelectorAll('li[data-path] .tree-children.open')
    for (const childrenEl of openItems) {
      const li = childrenEl.closest('li[data-path]')
      if (li) result.add(li.dataset.path)
    }
    return result
  }

  getScrollTop() {
    return this._container.scrollTop
  }

  setScrollTop(val) {
    this._container.scrollTop = val
  }

  collapseAll() {
    const openItems = this._container.querySelectorAll('.tree-children.open')
    for (const childrenEl of openItems) {
      childrenEl.classList.remove('open')
      const li = childrenEl.closest('li[data-path]')
      const arrow = li?.querySelector(':scope > .tree-node-row > .tree-arrow')
      if (arrow) arrow.classList.remove('expanded')
      if (li?.dataset.path) window.electronAPI.fsUnwatchDir(li.dataset.path)
    }
  }

  async restoreExpandedDirs(expandedDirs) {
    const sorted = [...expandedDirs].sort((a, b) => a.split('/').length - b.split('/').length)
    for (const dirPath of sorted) {
      const li = this._container.querySelector(`li[data-path="${CSS.escape(dirPath)}"]`)
      if (!li) continue
      const childrenEl = li.querySelector(':scope > .tree-children')
      if (!childrenEl || childrenEl.classList.contains('open')) continue
      const arrow = li.querySelector(':scope > .tree-node-row > .tree-arrow')
      const depth = parseInt(li.dataset.depth, 10)
      if (!childrenEl.dataset.loaded) {
        const entries = await this._loadDir(dirPath)
        if (entries) {
          childrenEl.appendChild(this._buildList(entries, dirPath, depth + 1))
          childrenEl.dataset.loaded = '1'
        }
      } else {
        window.electronAPI.fsWatchDir(dirPath)
      }
      childrenEl.classList.add('open')
      if (arrow) arrow.classList.add('expanded')
    }
  }

  _collapseRecursive(childrenEl) {
    const openItems = childrenEl.querySelectorAll('.tree-children.open')
    for (const ch of openItems) {
      ch.classList.remove('open')
      const li = ch.closest('li[data-path]')
      const arrow = li?.querySelector(':scope > .tree-node-row > .tree-arrow')
      if (arrow) arrow.classList.remove('expanded')
      if (li?.dataset.path) window.electronAPI.fsUnwatchDir(li.dataset.path)
    }
  }

  async setRoot(newPath) {
    console.log('[FileTree] setRoot called:', newPath, 'current:', this._cwd)
    if (this._cwd === newPath) return

    // Очищаем все watchers для старой директории
    this.unwatchAll()

    // Clear selection and undo on root change
    this._clearSelection()
    this._moveHistory = []

    this._cwd = newPath

    const labelEl = this._rootNodeRow?.querySelector('.tree-root-label')
    if (labelEl) {
      const parts = newPath.replace(/\/$/, '').split('/')
      labelEl.textContent = parts[parts.length - 1] || newPath
    }

    await this._refreshList(this._rootContainer, newPath, 1)
  }

  /**
   * Удаляет все watchers рекурсивно (корневая и все раскрытые папки)
   */
  unwatchAll() {
    // Отключаем watcher корневой директории
    if (this._cwd) {
      window.electronAPI.fsUnwatchDir(this._cwd)
    }

    // Отключаем watchers для всех раскрытых папок
    const openItems = this._container.querySelectorAll('li[data-path] .tree-children.open')
    for (const childrenEl of openItems) {
      const li = childrenEl.closest('li[data-path]')
      if (li?.dataset.path) {
        window.electronAPI.fsUnwatchDir(li.dataset.path)
      }
    }
  }

  async init(startPath = null) {
    const cwd = startPath ?? (await window.electronAPI.getCwd()).cwd
    console.log('[FileTree] init called with cwd:', cwd)
    this._cwd = cwd
    this._container.innerHTML = ''

    const { row, children } = this._renderRootNode(cwd)
    this._rootNodeRow = row
    this._container.appendChild(row)

    this._rootContainer = children
    this._container.appendChild(children)
    await this._refreshList(this._rootContainer, cwd, 1)

    // Создаем watcher для корневой директории
    console.log('[FileTree] Creating root watcher in init for:', cwd)
    window.electronAPI.fsWatchDir(cwd)

    window.electronAPI.onFsDirChanged((data) => this._handleDirChanged(data))

    this._container.addEventListener('contextmenu', (e) => {
      const rootUl = this._rootContainer.querySelector(':scope > ul')
      if (e.target === this._container || e.target === this._rootContainer || e.target === rootUl) {
        e.preventDefault()
        this._showMenuEmpty(e.clientX, e.clientY, this._cwd, this._rootContainer, 1)
      }
    })

    // Container-level drop target for root (covers root row and empty space)
    this._container.addEventListener('dragover', (e) => {
      if (!this._isDragging) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      this._handleAutoScroll(e.clientY)

      const row = e.target.closest('.tree-node-row, .tree-root-node-row')
      if (row?.classList.contains('tree-root-node-row')) {
        row.classList.add('drag-over')
      } else if (!row && this._rootNodeRow) {
        this._rootNodeRow.classList.add('drag-over')
      } else {
        this._rootNodeRow?.classList.remove('drag-over')
      }
    })

    this._container.addEventListener('dragleave', (e) => {
      if (!this._container.contains(e.relatedTarget)) {
        this._stopAutoScroll()
        this._rootNodeRow?.classList.remove('drag-over')
        this._clearDragOver()
      }
    })

    this._container.addEventListener('drop', async (e) => {
      if (!this._isDragging) return
      this._stopAutoScroll()
      this._rootNodeRow?.classList.remove('drag-over')

      const row = e.target.closest('.tree-node-row, .tree-root-node-row')
      // Normal folders have their own _setupDropTarget handler (stopPropagation)
      if (row?.classList.contains('tree-node-row')) return

      e.preventDefault()

      let paths
      try {
        paths = JSON.parse(e.dataTransfer.getData('application/x-etty-paths') || '[]')
      } catch {
        paths = []
      }
      if (paths.length === 0) return

      const dirPath = this._cwd
      const isInvalid = paths.some(p => p === dirPath || dirPath.startsWith(p + '/'))
      if (isInvalid) return

      this._setMoving(true)
      try {
        const result = await window.electronAPI.fsMove(paths, dirPath)
        if (result && result.results) {
          this._pushMoveHistory(result.results)
          // Force refresh the root immediately (watcher may lag or be pruned)
          await this._refreshList(this._rootContainer, dirPath, 1)
        }
      } finally {
        this._setMoving(false)
      }
    })
  }

  _renderRootNode(dirPath) {
    const parts = dirPath.replace(/\/$/, '').split('/')
    const name = parts[parts.length - 1] || dirPath

    const row = document.createElement('div')
    row.className = 'tree-root-node-row'
    row.dataset.path = dirPath

    const arrow = document.createElement('span')
    arrow.className = 'tree-arrow expanded'
    arrow.innerHTML = Icons.chevronRight

    const label = document.createElement('span')
    label.className = 'tree-root-label'
    label.textContent = name

    row.appendChild(arrow)
    row.appendChild(label)

    const children = document.createElement('div')
    children.className = 'tree-root-children open'

    row.addEventListener('click', (e) => {
      e.stopPropagation()
      // Ctrl/Cmd+Click on root = toggle select (treat as single for now)
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault()
        this._toggleSelect(dirPath, row)
        return
      }
      const isOpen = children.classList.toggle('open')
      arrow.classList.toggle('expanded', isOpen)
    })

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this._showMenuRoot(e.clientX, e.clientY)
    })

    return { row, children }
  }

  async _loadDir(dirPath, isRoot = false) {
    const result = await window.electronAPI.fsReadDir(dirPath)
    if (!result || result.error) return null

    let entries = this._showHidden ? result : result.filter(e => !e.name.startsWith('.'))

    // Создаем watcher для всех открытых директорий
    window.electronAPI.fsWatchDir(dirPath)

    return entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  _buildList(entries, parentPath, depth) {
    const ul = document.createElement('ul')
    ul.style.listStyle = 'none'
    ul.style.padding = '0'
    ul.style.margin = '0'
    for (const entry of entries) {
      ul.appendChild(this._buildNode(entry, depth))
    }
    return ul
  }

  _buildNode(entry, depth) {
    const li = document.createElement('li')
    li.className = 'tree-node'
    li.dataset.path = entry.path
    li.dataset.isDir = entry.isDirectory ? '1' : '0'
    li.dataset.depth = depth

    const row = document.createElement('div')
    row.className = 'tree-node-row'
    row.style.paddingLeft = `${depth * 16 + 8}px`
    row.dataset.path = entry.path
    row.draggable = true

    const arrow = document.createElement('span')
    arrow.className = 'tree-arrow'
    arrow.innerHTML = entry.isDirectory ? Icons.chevronRight : ''
    row.appendChild(arrow)

    const icon = document.createElement('span')
    icon.className = 'tree-icon'
    icon.innerHTML = entry.isDirectory ? Icons.folder : Icons.file
    row.appendChild(icon)

    const name = document.createElement('span')
    name.className = 'tree-name'
    name.style.marginRight = '10px'
    name.textContent = entry.name
    row.appendChild(name)

    const rel = entry.path.startsWith(this._cwd + '/')
      ? entry.path.slice(this._cwd.length + 1)
      : entry.path

    row.addEventListener('mouseenter', () => {
      if (!this._isDragging) {
        this._showHoverOverlay(row, entry, rel)
      }
    })
    row.addEventListener('mouseleave', (e) => {
      if (this._hoverOverlay.contains(e.relatedTarget)) return
      this._hideHoverOverlay()
    })

    li.appendChild(row)

    let childrenEl = null

    if (entry.isDirectory) {
      childrenEl = document.createElement('div')
      childrenEl.className = 'tree-children'
      li.appendChild(childrenEl)

      row.addEventListener('click', async (e) => {
        e.stopPropagation()
        // Modifier clicks handle selection, not expansion
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault()
          this._toggleSelect(entry.path, row)
          return
        }
        if (e.shiftKey) {
          e.preventDefault()
          if (this._lastSelectedAnchor) {
            this._selectRange(this._lastSelectedAnchor, entry.path)
          } else {
            this._selectSingle(entry.path, row)
          }
          return
        }

        const isOpen = childrenEl.classList.contains('open')
        if (isOpen) {
          childrenEl.classList.remove('open')
          arrow.classList.remove('expanded')
          window.electronAPI.fsUnwatchDir(entry.path)
          if (this._collapseChildrenOnClose) {
            this._collapseRecursive(childrenEl)
          }
        } else {
          if (!childrenEl.dataset.loaded) {
            const entries = await this._loadDir(entry.path) // also calls fsWatchDir
            if (entries) {
              childrenEl.appendChild(this._buildList(entries, entry.path, depth + 1))
            }
            childrenEl.dataset.loaded = '1'
          } else {
            window.electronAPI.fsWatchDir(entry.path)
          }
          childrenEl.classList.add('open')
          arrow.classList.add('expanded')
        }
      })
    }

    // Drag source (all rows)
    row.addEventListener('dragstart', (e) => {
      e.stopPropagation()
      // Auto-select if current row not in selection
      if (!this._selectedPaths.has(entry.path)) {
        this._clearSelection()
        this._selectedPaths.add(entry.path)
        this._lastSelectedAnchor = entry.path
        this._updateSelectionUI()
      }

      const paths = [...this._selectedPaths]
      e.dataTransfer.setData('application/x-etty-paths', JSON.stringify(paths))
      e.dataTransfer.effectAllowed = 'move'

      // Custom drag image for multi-select
      if (paths.length > 1) {
        this._setDragImage(e, row, paths.length)
      }

      this._isDragging = true
      this._updateDragState(true)
    })

    row.addEventListener('dragend', () => {
      this._isDragging = false
      this._updateDragState(false)
      this._clearDragOver()
      this._stopAutoScroll()
    })

    // Drop target (directories only)
    if (entry.isDirectory) {
      this._setupDropTarget(row, entry.path, childrenEl, arrow)
    }

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this._selectSingle(entry.path, row)
      if (entry.isDirectory) {
        this._showMenuDir(e.clientX, e.clientY, entry, childrenEl, arrow, depth + 1, row)
      } else {
        this._showMenuFile(e.clientX, e.clientY, entry, row)
      }
    })

    if (!entry.isDirectory) {
      const openInEditor = () => {
        if (this._bus) {
          this._bus.emit('filetree.openFile', entry.path)
        } else if (!this._isBusy) {
          const escaped = entry.path.replace(/'/g, "'\\''")
          this._bus.emit('filetree.shellCmd', `open '${escaped}'\n`)
        }
      }
      if (this._fileOpenMode === 'single') {
        row.addEventListener('click', (e) => {
          if (e.detail === 2) return
          // Modifier clicks
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            this._toggleSelect(entry.path, row)
            return
          }
          if (e.shiftKey) {
            e.preventDefault()
            if (this._lastSelectedAnchor) {
              this._selectRange(this._lastSelectedAnchor, entry.path)
            } else {
              this._selectSingle(entry.path, row)
            }
            return
          }
          if (e.altKey) {
            e.preventDefault()
            this._bus.emit('filetree.runInNewTab', entry.path)
            return
          }
          openInEditor()
        })
      } else {
        row.addEventListener('dblclick', () => openInEditor())
        row.addEventListener('click', (e) => {
          if (e.detail === 2) return
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            this._toggleSelect(entry.path, row)
            return
          }
          if (e.shiftKey) {
            e.preventDefault()
            if (this._lastSelectedAnchor) {
              this._selectRange(this._lastSelectedAnchor, entry.path)
            } else {
              this._selectSingle(entry.path, row)
            }
            return
          }
          if (e.altKey) {
            e.preventDefault()
            this._bus.emit('filetree.runInNewTab', entry.path)
          }
        })
      }
    }

    return li
  }

  // ── Multi-select helpers ─────────────────────────────────────────

  _clearSelection() {
    const prev = this._container.querySelectorAll('.tree-node-row.selected, .tree-root-node-row.selected')
    for (const el of prev) el.classList.remove('selected')
    this._selectedPaths.clear()
    this._lastSelectedAnchor = null
  }

  _selectSingle(path, row) {
    this._clearSelection()
    this._selectedPaths.add(path)
    this._lastSelectedAnchor = path
    row.classList.add('selected')
  }

  _toggleSelect(path, row) {
    if (this._selectedPaths.has(path)) {
      this._selectedPaths.delete(path)
      row.classList.remove('selected')
      if (this._lastSelectedAnchor === path) {
        // Pick another anchor if available
        this._lastSelectedAnchor = this._selectedPaths.size > 0 ? [...this._selectedPaths][this._selectedPaths.size - 1] : null
      }
    } else {
      this._selectedPaths.add(path)
      this._lastSelectedAnchor = path
      row.classList.add('selected')
    }
  }

  _selectRange(fromPath, toPath) {
    const allRows = [...this._container.querySelectorAll('.tree-node-row[data-path], .tree-root-node-row[data-path]')]
    const fromIndex = allRows.findIndex(r => r.dataset.path === fromPath)
    const toIndex = allRows.findIndex(r => r.dataset.path === toPath)
    if (fromIndex === -1 || toIndex === -1) return

    const start = Math.min(fromIndex, toIndex)
    const end = Math.max(fromIndex, toIndex)

    this._selectedPaths.clear()
    for (let i = start; i <= end; i++) {
      const path = allRows[i].dataset.path
      if (path) {
        this._selectedPaths.add(path)
        allRows[i].classList.add('selected')
      }
    }
  }

  _selectAllVisible() {
    const allRows = this._container.querySelectorAll('.tree-node-row[data-path]')
    this._selectedPaths.clear()
    for (const row of allRows) {
      const path = row.dataset.path
      if (path) {
        this._selectedPaths.add(path)
        row.classList.add('selected')
      }
    }
    this._lastSelectedAnchor = null
  }

  _updateSelectionUI() {
    const allRows = this._container.querySelectorAll('.tree-node-row[data-path], .tree-root-node-row[data-path]')
    for (const row of allRows) {
      const path = row.dataset.path
      if (this._selectedPaths.has(path)) {
        row.classList.add('selected')
      } else {
        row.classList.remove('selected')
      }
    }
  }

  // ── Drag & Drop helpers ────────────────────────────────────────────

  _setupDropTarget(row, dirPath, childrenEl = null, arrow = null) {
    row.addEventListener('dragover', (e) => {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      row.classList.add('drag-over')
      this._rootNodeRow?.classList.remove('drag-over')
      this._handleAutoScroll(e.clientY)

      // Auto-expand collapsed folders on hover (only if target changed)
      if (childrenEl && !childrenEl.classList.contains('open')) {
        if (this._autoExpandTarget !== dirPath) {
          this._cancelAutoExpand()
          this._autoExpandTarget = dirPath
          this._autoExpandTimer = setTimeout(async () => {
            this._autoExpandTarget = null
            if (!childrenEl || childrenEl.classList.contains('open')) return
            childrenEl.classList.add('open')
            if (arrow) arrow.classList.add('expanded')
            if (!childrenEl.dataset.loaded) {
              const entries = await this._loadDir(dirPath)
              if (entries) {
                const depth = parseInt(childrenEl.closest('li')?.dataset.depth || '0', 10)
                childrenEl.appendChild(this._buildList(entries, dirPath, depth + 1))
                childrenEl.dataset.loaded = '1'
              }
            } else {
              window.electronAPI.fsWatchDir(dirPath)
            }
          }, 700)
        }
      }
    })

    row.addEventListener('dragleave', (e) => {
      // Check if we're still within the same folder item (row or its children)
      const folderItem = row.closest('li[data-path]') || row.closest('.tree-root-node-row')
      const isStillInside = folderItem
        ? folderItem.contains(e.relatedTarget)
        : row.contains(e.relatedTarget)
      if (!isStillInside) {
        row.classList.remove('drag-over', 'drag-over-invalid')
        this._cancelAutoExpand()
        this._autoExpandTarget = null
        this._stopAutoScroll()
      }
    })

    row.addEventListener('drop', async (e) => {
      e.preventDefault()
      e.stopPropagation()
      this._clearDragOver()
      this._stopAutoScroll()

      let paths
      try {
        paths = JSON.parse(e.dataTransfer.getData('application/x-etty-paths') || '[]')
      } catch {
        paths = []
      }
      if (paths.length === 0) return

      // Validate: prevent dropping onto self or into own children
      const isInvalid = paths.some(p => p === dirPath || dirPath.startsWith(p + '/'))
      if (isInvalid) return

      this._setMoving(true)
      try {
        const result = await window.electronAPI.fsMove(paths, dirPath)
        if (result && result.results) {
          this._pushMoveHistory(result.results)
        }
      } finally {
        this._setMoving(false)
      }
    })
  }

  _setMoving(isMoving) {
    this._container.classList.toggle('is-moving', isMoving)
  }

  _clearDragOver() {
    this._container.querySelectorAll('.drag-over, .drag-over-invalid').forEach(el => {
      el.classList.remove('drag-over', 'drag-over-invalid')
    })
    this._cancelAutoExpand()
    this._autoExpandTarget = null
    this._stopAutoScroll()
  }

  _cancelAutoExpand() {
    if (this._autoExpandTimer) {
      clearTimeout(this._autoExpandTimer)
      this._autoExpandTimer = null
    }
  }

  _setDragImage(e, sourceRow, count) {
    const ghost = document.createElement('div')
    ghost.style.position = 'absolute'
    ghost.style.top = '-9999px'
    ghost.style.left = '-9999px'
    ghost.style.padding = '4px 10px'
    ghost.style.background = 'var(--bg)'
    ghost.style.border = '1px solid var(--border)'
    ghost.style.borderRadius = '4px'
    ghost.style.display = 'flex'
    ghost.style.alignItems = 'center'
    ghost.style.gap = '6px'
    ghost.style.fontSize = '13px'
    ghost.style.color = 'var(--text)'
    ghost.style.opacity = '0.92'
    ghost.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)'
    ghost.style.pointerEvents = 'none'
    ghost.style.whiteSpace = 'nowrap'

    const icon = sourceRow.querySelector('.tree-icon')?.cloneNode(true)
    const name = sourceRow.querySelector('.tree-name')?.cloneNode(true)
    if (icon) ghost.appendChild(icon)
    if (name) ghost.appendChild(name)

    const badge = document.createElement('span')
    badge.textContent = `+${count - 1}`
    badge.style.background = 'var(--accent)'
    badge.style.color = 'var(--bg)'
    badge.style.borderRadius = '10px'
    badge.style.padding = '1px 7px'
    badge.style.fontSize = '11px'
    badge.style.fontWeight = 'bold'
    badge.style.lineHeight = '1'
    ghost.appendChild(badge)

    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 0, 16)

    requestAnimationFrame(() => {
      requestAnimationFrame(() => ghost.remove())
    })
  }

  _updateDragState(isDragging) {
    const rows = this._container.querySelectorAll('.tree-node-row.selected')
    for (const row of rows) {
      row.classList.toggle('dragging', isDragging)
    }
    if (isDragging) {
      this._hideHoverOverlay()
    }
  }

  _handleAutoScroll(clientY) {
    const rect = this._container.getBoundingClientRect()
    const edgeSize = 24
    const y = clientY - rect.top
    const maxScroll = this._container.scrollHeight - this._container.clientHeight

    if (y < edgeSize && this._container.scrollTop > 0) {
      this._startAutoScroll(-1)
    } else if (y > rect.height - edgeSize && this._container.scrollTop < maxScroll) {
      this._startAutoScroll(1)
    } else {
      this._stopAutoScroll()
    }
  }

  _startAutoScroll(direction) {
    if (this._autoScrollDirection === direction) return
    this._stopAutoScroll()
    this._autoScrollDirection = direction
    const speed = 6
    this._autoScrollTimer = setInterval(() => {
      this._container.scrollTop += direction * speed
    }, 16)
  }

  _stopAutoScroll() {
    if (this._autoScrollTimer) {
      clearInterval(this._autoScrollTimer)
      this._autoScrollTimer = null
    }
    this._autoScrollDirection = 0
  }

  // ── Undo helpers ─────────────────────────────────────────────────

  _pushMoveHistory(results) {
    const successfulMoves = results.filter(r => r.success && r.newPath)
    if (successfulMoves.length === 0) return
    this._moveHistory.push(successfulMoves)
    // Cap history at 20 entries
    if (this._moveHistory.length > 20) {
      this._moveHistory.shift()
    }
  }

  async _undoLastMove() {
    if (this._moveHistory.length === 0) return
    const moves = this._moveHistory.pop()
    for (const move of moves) {
      try {
        await window.electronAPI.fsRename(move.newPath, move.path)
      } catch (e) {
        console.error('[FileTree] Undo failed for', move.newPath, '->', move.path, e)
      }
    }
  }

  // ── Context menus ────────────────────────────────────────────────

  _parentDir(filePath) {
    return filePath.replace(/\/[^/]+$/, '')
  }

  _showMenuFile(x, y, entry, row) {
    const parentDir = this._parentDir(entry.path)
    const parentContainer = this._findContainerForDir(parentDir)
    const rel = entry.path.startsWith(this._cwd + '/')
      ? entry.path.slice(this._cwd.length + 1)
      : entry.path
    this._contextMenu.show([
      { label: 'Новый файл', action: () => this._createInline('file', parentDir, parentContainer, 0) },
      { label: 'Новая папка', action: () => this._createInline('dir', parentDir, parentContainer, 0) },
      { separator: true },
      { label: 'Переименовать', action: () => this._renameInline(entry, row) },
      { label: 'Удалить', action: () => this._deleteEntry(entry, row) },
      { separator: true },
      { label: 'Открыть в терминале', disabled: this._isBusy, action: () => {
          const escaped = entry.path.replace(/'/g, "'\\''")
          this._bus.emit('filetree.shellCmd', `open '${escaped}'\n`)
          this._bus.emit('terminal.focus')
        }
      },
      { separator: true },
      { label: 'Копировать', action: () => { this._clipboard = { path: entry.path } } },
      { label: 'Копировать путь', action: () => { navigator.clipboard.writeText(entry.path); this._bus.emit('terminal.focus') } },
      { label: 'Копировать относительный путь', action: () => { navigator.clipboard.writeText(rel); this._bus.emit('terminal.focus') } }
    ], x, y)
  }

  _showMenuDir(x, y, entry, childrenEl, arrow, childDepth, row) {
    const rel = entry.path.startsWith(this._cwd + '/')
      ? entry.path.slice(this._cwd.length + 1)
      : entry.path
    this._contextMenu.show([
      { label: 'cd в директорию', disabled: this._isBusy, action: () => {
          const escaped = entry.path.replace(/'/g, "'\\''")
          this._bus.emit('filetree.shellCmd', `cd '${escaped}'\r`)
          this._bus.emit('terminal.focus')
        }
      },
      { separator: true },
      { label: 'Новый файл', action: () => this._createInlineInDir('file', entry.path, childrenEl, arrow, childDepth) },
      { label: 'Новая папка', action: () => this._createInlineInDir('dir', entry.path, childrenEl, arrow, childDepth) },
      { separator: true },
      { label: 'Переименовать', action: () => this._renameInline(entry, row) },
      { label: 'Удалить', action: () => this._deleteEntry(entry, row) },
      { separator: true },
      { label: 'Копировать', action: () => { this._clipboard = { path: entry.path } } },
      { label: 'Вставить', action: () => this._paste(entry.path, childrenEl, childDepth) },
      { label: 'Копировать путь', action: () => { navigator.clipboard.writeText(entry.path); this._bus.emit('terminal.focus') } },
      { label: 'Копировать относительный путь', action: () => { navigator.clipboard.writeText(rel); this._bus.emit('terminal.focus') } }
    ], x, y)
  }

  _showMenuRoot(x, y) {
    this._contextMenu.show([
      { label: 'cd в директорию', disabled: this._isBusy, action: () => {
          const escaped = this._cwd.replace(/'/g, "'\\''")
          this._bus.emit('filetree.shellCmd', `cd '${escaped}'\r`)
          this._bus.emit('terminal.focus')
        }
      },
      { separator: true },
      { label: 'Новый файл', action: () => this._createInline('file', this._cwd, this._rootContainer, 1) },
      { label: 'Новая папка', action: () => this._createInline('dir', this._cwd, this._rootContainer, 1) },
      { separator: true },
      { label: 'Копировать путь', action: () => { navigator.clipboard.writeText(this._cwd); this._bus.emit('terminal.focus') } }
    ], x, y)
  }

  _showMenuEmpty(x, y, dirPath, container, depth = 0) {
    const items = [
      { label: 'Новый файл', action: () => this._createInline('file', dirPath, container, depth) },
      { label: 'Новая папка', action: () => this._createInline('dir', dirPath, container, depth) }
    ]
    if (this._clipboard) {
      items.push({ separator: true })
      items.push({ label: 'Вставить', action: () => this._paste(dirPath, container, depth) })
    }
    this._contextMenu.show(items, x, y)
  }

  // ── Inline input helpers ─────────────────────────────────────────

  // Create inline input inside a container div (root or tree-children div after expand)
  _createInline(kind, parentPath, container, depth) {
    this._appendInlineInput(kind, parentPath, container, depth)
  }

  // Create inline input inside a dir's childrenEl, expanding it first
  _createInlineInDir(kind, parentPath, childrenEl, arrow, depth) {
    if (!childrenEl.classList.contains('open')) {
      childrenEl.classList.add('open')
      arrow.classList.add('expanded')
    }
    this._appendInlineInput(kind, parentPath, childrenEl, depth)
  }

  _appendInlineInput(kind, parentPath, container, depth) {
    // Find or create the ul inside the container
    let ul = container.querySelector(':scope > ul')
    if (!ul) {
      ul = document.createElement('ul')
      ul.style.listStyle = 'none'
      ul.style.padding = '0'
      ul.style.margin = '0'
      container.appendChild(ul)
    }

    const li = document.createElement('li')
    li.className = 'tree-node'

    const row = document.createElement('div')
    row.className = 'tree-node-row'
    row.style.paddingLeft = `${depth * 16 + 8}px`

    const input = document.createElement('input')
    input.className = 'tree-inline-input'
    input.placeholder = kind === 'file' ? 'filename' : 'folder name'
    row.appendChild(input)
    li.appendChild(row)
    ul.appendChild(li)

    const cleanup = () => li.remove()

    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') { cleanup(); return }
      if (e.key !== 'Enter') return
      const name = input.value.trim()
      if (!name) { cleanup(); return }

      const targetPath = parentPath.replace(/\/$/, '') + '/' + name
      let result
      if (kind === 'file') {
        result = await window.electronAPI.fsCreateFile(targetPath)
      } else {
        result = await window.electronAPI.fsCreateDir(targetPath)
      }

      if (result && result.success === false) {
        input.style.borderColor = '#f38ba8'
        return
      }

      cleanup()
      this._refreshList(container, parentPath, depth)
    })

    input.addEventListener('blur', cleanup)
    input.focus()
  }

  _renameInline(entry, row) {
    const nameEl = row.querySelector('.tree-name')
    const original = nameEl.textContent

    const input = document.createElement('input')
    input.className = 'tree-inline-input'
    input.value = original
    nameEl.replaceWith(input)
    input.select()

    const restore = () => input.replaceWith(nameEl)

    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') { restore(); return }
      if (e.key !== 'Enter') return
      const newName = input.value.trim()
      if (!newName || newName === original) { restore(); return }

      const dir = this._parentDir(entry.path)
      const newPath = dir + '/' + newName
      const result = await window.electronAPI.fsRename(entry.path, newPath)

      if (result && result.success === false) {
        input.style.borderColor = '#f38ba8'
        return
      }

      nameEl.textContent = newName
      restore()
      const li = row.closest('li')
      if (li) li.dataset.path = newPath
    })

    input.addEventListener('blur', restore)
  }

  async _deleteEntry(entry, row) {
    const result = await window.electronAPI.fsDelete(entry.path)
    if (result && result.success === false) return
    row.closest('li').remove()
  }

  async _paste(destDir, container, depth) {
    if (!this._clipboard) return
    const result = await window.electronAPI.fsCopy(this._clipboard.path, destDir)
    if (!result || result.success === false) return
    this._refreshList(container, destDir, depth)
  }

  // ── List refresh ─────────────────────────────────────────────────

  // container is always a div; replaces its ul child
  async _refreshList(container, dirPath, depth) {
    // depth === 1 означает корневую директорию
    const isRoot = depth === 1
    const entries = await this._loadDir(dirPath, isRoot)
    if (!entries) return

    // Save expanded dirs and selection before replacing
    const existingUl = container.querySelector(':scope > ul')
    const expandedDirs = new Set()
    /** @type {Map<string, HTMLElement>} */
    const existingMap = new Map()
    if (existingUl) {
      const openItems = existingUl.querySelectorAll('li[data-path] .tree-children.open')
      for (const childrenEl of openItems) {
        const li = childrenEl.closest('li[data-path]')
        if (li) expandedDirs.add(li.dataset.path)
      }
      for (const li of existingUl.querySelectorAll(':scope > li[data-path]')) {
        existingMap.set(li.dataset.path, li)
      }
    }

    const newUl = document.createElement('ul')
    newUl.style.listStyle = 'none'
    newUl.style.padding = '0'
    newUl.style.margin = '0'

    for (const entry of entries) {
      const existingLi = existingMap.get(entry.path)
      if (existingLi) {
        // Reuse existing DOM node — update only what may have changed
        existingLi.dataset.isDir = entry.isDirectory ? '1' : '0'
        existingLi.dataset.depth = String(depth)

        const row = existingLi.querySelector('.tree-node-row')
        if (row) {
          row.style.paddingLeft = `${depth * 16 + 8}px`
          const nameEl = row.querySelector('.tree-name')
          if (nameEl) nameEl.textContent = entry.name

          const iconEl = row.querySelector('.tree-icon')
          if (iconEl) iconEl.innerHTML = entry.isDirectory ? Icons.folder : Icons.file

          const arrowEl = row.querySelector('.tree-arrow')
          if (arrowEl) arrowEl.innerHTML = entry.isDirectory ? Icons.chevronRight : ''
        }
        newUl.appendChild(existingLi)
      } else {
        newUl.appendChild(this._buildNode(entry, depth))
      }
    }

    if (existingUl) {
      existingUl.replaceWith(newUl)
    } else {
      container.appendChild(newUl)
    }

    this._restoreSelection()

    // Restore expanded directories (only newly created nodes need this)
    if (expandedDirs.size > 0) {
      await this.restoreExpandedDirs(expandedDirs)
    }
  }

  _restoreSelection() {
    const allRows = this._container.querySelectorAll('.tree-node-row[data-path], .tree-root-node-row[data-path]')
    for (const row of allRows) {
      const path = row.dataset.path
      if (this._selectedPaths.has(path)) {
        row.classList.add('selected')
      }
    }
  }

  _handleDirChanged({ dirPath }) {
    clearTimeout(this._dirTimers.get(dirPath))
    this._dirTimers.set(dirPath, setTimeout(() => {
      this._dirTimers.delete(dirPath)
      if (dirPath === this._cwd) {
        this._refreshList(this._rootContainer, dirPath, 1)
        return
      }
      const li = this._container.querySelector(`li[data-path="${CSS.escape(dirPath)}"]`)
      if (!li) return
      const childrenEl = li.querySelector('.tree-children')
      if (!childrenEl || !childrenEl.classList.contains('open')) return
      const depth = parseInt(li.dataset.depth, 10)
      this._refreshList(childrenEl, dirPath, depth + 1)
    }, 500))
  }

  // Find the container div for a given dir path in the tree
  _findContainerForDir(dirPath) {
    if (dirPath === this._cwd) return this._rootContainer
    const li = this._container.querySelector(`li[data-path="${CSS.escape(dirPath)}"]`)
    if (li) {
      const childrenEl = li.querySelector('.tree-children')
      if (childrenEl) return childrenEl
    }
    return this._rootContainer
  }
}
