/**
 * Left-hand pane of the Git panel: filterable, grouped file list
 * (Staged Changes / Changes / Untracked / Ignored) with checkboxes for
 * staging, a context menu per row, and keyboard navigation.
 */
import { Icons } from '../../icons.js'
import { ContextMenu } from '../../components/base/context-menu/context-menu.js'
import { APP_CONFIG } from '../../core/config/app-config.js'
import { statusMeta } from './git-status.js'

const GROUP_DEFS = [
  { key: 'staged', label: 'Staged Changes', bulk: 'unstageAll', bulkLabel: 'Unstage all' },
  { key: 'unstaged', label: 'Changes', bulk: 'stageAll', bulkLabel: 'Stage all' },
  { key: 'untracked', label: 'Untracked', bulk: 'stageAll', bulkLabel: 'Stage all' },
  { key: 'ignored', label: 'Ignored', bulk: null, bulkLabel: null },
]

const DEFAULT_COLLAPSED = ['ignored']

export class GitFileList {
  /**
   * @param {Object} deps
   * @param {HTMLElement} deps.containerEl
   * @param {import('../../core/state-store.js').StateStore} [deps.store]
   * @param {(file: object, groupKey: string) => void} deps.onSelect
   * @param {(files: object[]) => void} deps.onStage
   * @param {(files: object[]) => void} deps.onUnstage
   * @param {(file: object) => void} deps.onDiscard
   * @param {(file: object) => void} deps.onOpenFile
   * @param {(file: object) => void} deps.onCopyPath
   */
  constructor({ containerEl, store, onSelect, onStage, onUnstage, onDiscard, onOpenFile, onCopyPath }) {
    this._containerEl = containerEl
    this._store = store || null
    this._onSelect = onSelect
    this._onStage = onStage
    this._onUnstage = onUnstage
    this._onDiscard = onDiscard
    this._onOpenFile = onOpenFile
    this._onCopyPath = onCopyPath

    this._groups = { staged: [], unstaged: [], untracked: [], ignored: [] }
    this._isRepo = true
    this._filterText = ''
    this._filterTimer = null
    this._selectedPath = null
    this._selectedGroup = null
    this._flatVisible = []
    this._contextMenu = new ContextMenu()
    this._cleanupController = new AbortController()

    this._buildDOM()
    this._bindEvents()
  }

  _collapsedSet() {
    const stored = this._store?.get('ui.git.collapsedGroups')
    return new Set(stored !== undefined ? stored : DEFAULT_COLLAPSED)
  }

  _toggleCollapsed(groupKey) {
    const set = this._collapsedSet()
    if (set.has(groupKey)) set.delete(groupKey)
    else set.add(groupKey)
    this._store?.set('ui.git.collapsedGroups', [...set])
    this._render()
  }

  _buildDOM() {
    this._containerEl.innerHTML = `
      <div class="git-filter-row">
        <span class="git-filter-icon">${Icons.search}</span>
        <input type="text" class="git-filter-input" placeholder="Filter files…" />
        <button class="git-filter-clear hidden" title="Clear filter">${Icons.close}</button>
      </div>
      <div class="git-groups"></div>
    `
    this._filterInput = this._containerEl.querySelector('.git-filter-input')
    this._filterClearBtn = this._containerEl.querySelector('.git-filter-clear')
    this._groupsEl = this._containerEl.querySelector('.git-groups')
  }

  _bindEvents() {
    const signal = this._cleanupController.signal

    this._filterInput.addEventListener('input', () => {
      this._filterClearBtn.classList.toggle('hidden', !this._filterInput.value)
      clearTimeout(this._filterTimer)
      this._filterTimer = setTimeout(() => {
        this._filterText = this._filterInput.value.trim().toLowerCase()
        this._render()
      }, APP_CONFIG.SEARCH_DEBOUNCE_MS)
    }, { signal })

    this._filterClearBtn.addEventListener('click', () => {
      this._filterInput.value = ''
      this._filterClearBtn.classList.add('hidden')
      this._filterText = ''
      this._render()
      this._filterInput.focus()
    }, { signal })

    this._groupsEl.addEventListener('keydown', (e) => this._onKeyDown(e), { signal })
  }

  focusFilter() {
    this._filterInput.focus()
    this._filterInput.select()
  }

  /** @param {{staged: object[], unstaged: object[], untracked: object[], ignored: object[], isRepo: boolean}} data */
  setData(data) {
    this._groups = {
      staged: data.staged || [],
      unstaged: data.unstaged || [],
      untracked: data.untracked || [],
      ignored: data.ignored || [],
    }
    this._isRepo = data.isRepo !== false

    // Keep selection if the file is still present in the same group; else clear it.
    if (this._selectedPath) {
      const stillThere = (this._groups[this._selectedGroup] || []).some(f => f.path === this._selectedPath)
      if (!stillThere) {
        this._selectedPath = null
        this._selectedGroup = null
      }
    }

    this._render()
  }

  getSelected() {
    if (!this._selectedPath) return null
    const file = (this._groups[this._selectedGroup] || []).find(f => f.path === this._selectedPath)
    return file ? { file, groupKey: this._selectedGroup } : null
  }

  select(path, groupKey) {
    this._selectedPath = path
    this._selectedGroup = groupKey
    this._highlightSelection()
  }

  clearSelection() {
    this._selectedPath = null
    this._selectedGroup = null
    this._highlightSelection()
  }

  _matchesFilter(file) {
    if (!this._filterText) return true
    return file.path.toLowerCase().includes(this._filterText)
  }

  _render() {
    this._groupsEl.innerHTML = ''
    this._flatVisible = []

    if (!this._isRepo) {
      this._renderMessage('Not a git repository', Icons.hexagon)
      return
    }

    const collapsed = this._collapsedSet()
    const totalFiles = GROUP_DEFS.reduce((n, g) => n + this._groups[g.key].length, 0)

    if (totalFiles === 0) {
      this._renderMessage('Working tree clean', Icons.ok)
      return
    }

    let anyVisible = false

    for (const def of GROUP_DEFS) {
      const allFiles = this._groups[def.key]
      if (allFiles.length === 0) continue
      const visibleFiles = allFiles.filter(f => this._matchesFilter(f))
      if (this._filterText && visibleFiles.length === 0) continue
      anyVisible = true

      const isCollapsed = collapsed.has(def.key)
      this._groupsEl.appendChild(this._buildGroupHeader(def, allFiles.length, isCollapsed))

      if (!isCollapsed) {
        for (const file of visibleFiles) {
          const row = this._buildFileRow(file, def.key)
          this._groupsEl.appendChild(row)
          this._flatVisible.push({ file, groupKey: def.key, el: row })
        }
      }
    }

    if (!anyVisible) {
      this._renderMessage(`No files match "${this._filterInput.value.trim()}"`, Icons.search)
      return
    }

    this._highlightSelection()
  }

  _renderMessage(text, icon) {
    const wrap = document.createElement('div')
    wrap.className = 'git-list-message'
    const iconEl = document.createElement('span')
    iconEl.className = 'git-list-message-icon'
    iconEl.innerHTML = icon
    wrap.appendChild(iconEl)
    const label = document.createElement('span')
    label.textContent = text
    wrap.appendChild(label)
    this._groupsEl.appendChild(wrap)
  }

  _buildGroupHeader(def, count, isCollapsed) {
    const header = document.createElement('div')
    header.className = 'git-group-header'

    const arrow = document.createElement('span')
    arrow.className = 'git-group-arrow'
    arrow.innerHTML = isCollapsed ? Icons.chevronRight : Icons.chevronDown
    header.appendChild(arrow)

    const label = document.createElement('span')
    label.className = 'git-group-label'
    label.textContent = def.label
    header.appendChild(label)

    const count_ = document.createElement('span')
    count_.className = 'git-group-count'
    count_.textContent = String(count)
    header.appendChild(count_)

    header.addEventListener('click', (e) => {
      if (e.target.closest('.git-group-bulk')) return
      this._toggleCollapsed(def.key)
    })

    if (def.bulk && count > 0) {
      const bulkBtn = document.createElement('button')
      bulkBtn.className = 'git-group-bulk'
      bulkBtn.textContent = def.bulkLabel
      bulkBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        const files = this._groups[def.key]
        if (def.bulk === 'stageAll') this._onStage?.(files)
        else if (def.bulk === 'unstageAll') this._onUnstage?.(files)
      })
      header.appendChild(bulkBtn)
    }

    return header
  }

  _buildFileRow(file, groupKey) {
    const row = document.createElement('div')
    row.className = 'git-file-row'
    row.tabIndex = -1
    row.dataset.filePath = file.path
    row.dataset.groupKey = groupKey
    if (file.isIgnored) row.classList.add('git-file-row-ignored')

    if (groupKey === 'ignored') {
      row.appendChild(this._emptyCell('git-file-checkbox-spacer'))
    } else {
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.className = 'git-file-checkbox'
      checkbox.checked = groupKey === 'staged'
      checkbox.title = groupKey === 'staged' ? 'Unstage' : 'Stage'
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation()
        if (groupKey === 'staged') this._onUnstage?.([file])
        else this._onStage?.([file])
      })
      row.appendChild(checkbox)
    }

    const meta = statusMeta(file.status)
    const badge = document.createElement('span')
    badge.className = `git-status-badge git-status-badge-${meta.cls}`
    badge.textContent = meta.letter
    badge.title = meta.label
    row.appendChild(badge)

    const path = document.createElement('span')
    path.className = 'git-file-path'
    path.textContent = file.path
    path.title = file.path
    row.appendChild(path)

    if (file.additions) {
      const add = document.createElement('span')
      add.className = 'git-additions'
      add.textContent = `+${file.additions}`
      row.appendChild(add)
    }
    if (file.deletions) {
      const del = document.createElement('span')
      del.className = 'git-deletions'
      del.textContent = `−${file.deletions}`
      row.appendChild(del)
    }

    row.addEventListener('click', () => {
      this.select(file.path, groupKey)
      this._onSelect?.(file, groupKey)
    })

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      this.select(file.path, groupKey)
      this._onSelect?.(file, groupKey)
      this._showContextMenu(file, groupKey, e.clientX, e.clientY)
    })

    return row
  }

  _emptyCell(className) {
    const el = document.createElement('span')
    el.className = className
    return el
  }

  _showContextMenu(file, groupKey, x, y) {
    const items = [
      { label: 'Open in Editor', action: () => this._onOpenFile?.(file) },
      { label: 'Copy Path', action: () => this._onCopyPath?.(file) },
    ]
    if (groupKey !== 'ignored') {
      items.push({ separator: true })
      if (groupKey === 'staged') {
        items.push({ label: 'Unstage', action: () => this._onUnstage?.([file]) })
      } else {
        items.push({ label: 'Stage', action: () => this._onStage?.([file]) })
      }
      items.push({ label: 'Discard Changes', action: () => this._onDiscard?.(file) })
    }
    this._contextMenu.show(items, x, y)
  }

  _highlightSelection() {
    for (const { file, groupKey, el } of this._flatVisible) {
      el.classList.toggle('selected', file.path === this._selectedPath && groupKey === this._selectedGroup)
    }
  }

  _onKeyDown(e) {
    if (this._flatVisible.length === 0) return
    const currentIndex = this._flatVisible.findIndex(v => v.file.path === this._selectedPath && v.groupKey === this._selectedGroup)

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const delta = e.key === 'ArrowDown' ? 1 : -1
      const nextIndex = currentIndex < 0
        ? (delta > 0 ? 0 : this._flatVisible.length - 1)
        : Math.max(0, Math.min(this._flatVisible.length - 1, currentIndex + delta))
      const next = this._flatVisible[nextIndex]
      this.select(next.file.path, next.groupKey)
      this._onSelect?.(next.file, next.groupKey)
      next.el.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter') {
      const current = this._flatVisible[currentIndex]
      if (current) { e.preventDefault(); this._onOpenFile?.(current.file) }
    } else if (e.key === ' ') {
      const current = this._flatVisible[currentIndex]
      if (current && current.groupKey !== 'ignored') {
        e.preventDefault()
        if (current.groupKey === 'staged') this._onUnstage?.([current.file])
        else this._onStage?.([current.file])
      }
    }
  }

  destroy() {
    clearTimeout(this._filterTimer)
    this._cleanupController?.abort()
    this._cleanupController = null
    this._contextMenu?.destroy()
    this._contextMenu = null
    this._onSelect = null
    this._onStage = null
    this._onUnstage = null
    this._onDiscard = null
    this._onOpenFile = null
    this._onCopyPath = null
    if (this._containerEl) this._containerEl.innerHTML = ''
    this._containerEl = null
    this._store = null
  }
}
