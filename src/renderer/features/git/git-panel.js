/**
 * Git panel (overlay): master/detail view over the working tree — staging,
 * branch management, commit/push, and a syntax-highlighted unified diff.
 * Opened from the status bar or Cmd/Ctrl+Shift+G. Orchestrates GitFileList
 * (left pane) and GitDiffView (right pane); talks to main only through
 * ElectronApiAdapter.
 */
import { Icons } from '../../icons.js'
import { ContextMenu } from '../../components/base/context-menu/context-menu.js'
import { APP_CONFIG } from '../../core/config/app-config.js'
import { GitFileList } from './git-file-list.js'
import { GitDiffView } from './git-diff-view.js'

export class GitPanel {
  /**
   * @param {Object} deps
   * @param {HTMLElement} deps.overlayEl
   * @param {import('../../core/event-bus.js').EventBus} deps.eventBus
   * @param {import('../../core/state-store.js').StateStore} deps.store
   * @param {import('../../core/adapters/electron-api.js').ElectronApiAdapter} deps.api
   * @param {import('../../confirm-dialog.js').ConfirmDialog} deps.confirmDialog
   * @param {Function} [deps.onClose]
   */
  constructor({ overlayEl, eventBus, store, api, confirmDialog, onClose }) {
    this._overlayEl = overlayEl
    this._bus = eventBus
    this._store = store
    this._api = api
    this._confirmDialog = confirmDialog
    this._onClose = onClose

    this._rootPath = null
    this._branch = null
    this._ahead = 0
    this._behind = 0
    this._totalAdditions = 0
    this._totalDeletions = 0
    this._branches = []
    this._currentBranch = null
    this._lastStagedCount = 0

    this._toastTimer = null
    this._statusUnsub = null
    this._branchPopoverEl = null
    this._branchPopoverOutsideHandler = null
    this._cleanupController = new AbortController()
    this._menu = new ContextMenu()

    this._buildDOM()
    this._bindEvents()
  }

  _buildDOM() {
    this._overlayEl.innerHTML = `
      <div class="git-header">
        <button class="git-branch-btn btn btn--default btn--sm" type="button">
          <span class="btn__icon">${Icons.gitBranch}</span>
          <span class="git-branch-btn-label">—</span>
          <span class="git-branch-btn-chevron">${Icons.chevronDown}</span>
        </button>
        <div class="git-header-stats"></div>
        <div class="git-header-spacer"></div>
        <button class="git-btn-refresh btn btn--ghost btn--sm" type="button" title="Refresh">${Icons.refresh}</button>
        <button class="git-close btn btn--ghost btn--sm" type="button" title="Close">${Icons.close}</button>
      </div>
      <div class="git-root-path"></div>
      <div class="git-toast"></div>
      <div class="git-body">
        <div class="git-sidebar"></div>
        <div class="git-splitter"></div>
        <div class="git-detail"></div>
      </div>
      <div class="git-commit-bar">
        <textarea class="git-commit-msg" placeholder="Commit message…" rows="1"></textarea>
        <button class="git-btn-commit btn btn--primary btn--sm" type="button">Commit</button>
        <button class="git-btn-push btn btn--default btn--sm" type="button">Push</button>
        <button class="git-btn-more btn btn--ghost btn--sm" type="button" title="More actions">⋯</button>
      </div>
    `

    this._branchBtnEl = this._overlayEl.querySelector('.git-branch-btn')
    this._branchLabelEl = this._overlayEl.querySelector('.git-branch-btn-label')
    this._statsEl = this._overlayEl.querySelector('.git-header-stats')
    this._btnRefresh = this._overlayEl.querySelector('.git-btn-refresh')
    this._btnClose = this._overlayEl.querySelector('.git-close')
    this._rootPathEl = this._overlayEl.querySelector('.git-root-path')
    this._toastEl = this._overlayEl.querySelector('.git-toast')
    this._sidebarEl = this._overlayEl.querySelector('.git-sidebar')
    this._splitterEl = this._overlayEl.querySelector('.git-splitter')
    this._detailEl = this._overlayEl.querySelector('.git-detail')
    this._commitMsgEl = this._overlayEl.querySelector('.git-commit-msg')
    this._btnCommit = this._overlayEl.querySelector('.git-btn-commit')
    this._btnPush = this._overlayEl.querySelector('.git-btn-push')
    this._btnMore = this._overlayEl.querySelector('.git-btn-more')

    const savedWidth = this._store?.get('ui.git.sidebarWidth')
    this._sidebarEl.style.width = `${savedWidth || APP_CONFIG.GIT_SIDEBAR_DEFAULT_WIDTH}px`

    this._fileList = new GitFileList({
      containerEl: this._sidebarEl,
      store: this._store,
      onSelect: (file, groupKey) => this._showDiff(file, groupKey),
      onStage: (files) => this._doStage(files),
      onUnstage: (files) => this._doUnstage(files),
      onDiscard: (file) => this._onDiscardFile(file),
      onOpenFile: (file) => this._openFile(file),
      onCopyPath: (file) => this._copyPath(file),
    })

    this._diffView = new GitDiffView({
      containerEl: this._detailEl,
      onOpenFile: (file) => this._openFile(file),
      onStage: (files) => this._doStage(files),
      onUnstage: (files) => this._doUnstage(files),
      onDiscard: (file) => this._onDiscardFile(file),
    })
  }

  _bindEvents() {
    const signal = this._cleanupController.signal

    document.addEventListener('keydown', (e) => this._onGlobalKeyDown(e), { signal })

    this._btnClose.addEventListener('click', () => this.hide(), { signal })
    this._btnRefresh.addEventListener('click', () => this._refresh(), { signal })
    this._branchBtnEl.addEventListener('click', () => this._toggleBranchPopover(), { signal })
    this._btnCommit.addEventListener('click', () => this._doCommit(), { signal })
    this._btnPush.addEventListener('click', () => this._doPush(), { signal })
    this._btnMore.addEventListener('click', (e) => this._openMoreMenu(e), { signal })

    this._commitMsgEl.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        this._doCommit()
      }
    }, { signal })

    this._splitterEl.addEventListener('mousedown', (e) => this._onSplitterMouseDown(e), { signal })

    this._statusUnsub = this._bus.on('git.status-updated', (payload) => {
      if (!this._rootPath || !this.isVisible()) return
      if (payload && payload.rootPath && payload.rootPath !== this._rootPath) return
      this._refresh({ background: true })
    })
  }

  _onGlobalKeyDown(e) {
    if (!this.isVisible()) return
    if (e.key === 'Escape') {
      this.hide()
      return
    }
    if (e.key === '/' && !this._isTypingTarget(e.target)) {
      e.preventDefault()
      this._fileList.focusFilter()
    }
  }

  _isTypingTarget(el) {
    const tag = el?.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA'
  }

  _onSplitterMouseDown(e) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = this._sidebarEl.offsetWidth
    this._splitterEl.classList.add('dragging')

    const onMove = (ev) => {
      const delta = ev.clientX - startX
      const newWidth = Math.max(APP_CONFIG.GIT_SIDEBAR_MIN_WIDTH, Math.min(APP_CONFIG.GIT_SIDEBAR_MAX_WIDTH, startWidth + delta))
      this._sidebarEl.style.width = `${newWidth}px`
    }
    const onUp = () => {
      this._splitterEl.classList.remove('dragging')
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      this._store?.set('ui.git.sidebarWidth', this._sidebarEl.offsetWidth)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  async show(rootPath) {
    this._rootPath = rootPath
    this._overlayEl.classList.remove('hidden')
    this._diffView.clear()
    this._showRootPath()
    await this._refresh()
    requestAnimationFrame(() => this._fileList?.focusFilter())
  }

  async _showRootPath() {
    if (!this._rootPathEl) return
    if (!this._rootPath) { this._rootPathEl.textContent = ''; return }
    const pollPath = this._rootPath
    const root = await this._api.gitGetRoot(this._rootPath)
    if (this._rootPath !== pollPath) return
    this._rootPathEl.textContent = root || this._rootPath
  }

  hide() {
    if (!this.isVisible()) return
    this._closeBranchPopover()
    this._overlayEl.classList.add('hidden')
    this._rootPath = null
    this._onClose?.()
  }

  /** Hide without firing onClose (used when switching tabs). */
  hideQuiet() {
    this._closeBranchPopover()
    this._overlayEl.classList.add('hidden')
    this._rootPath = null
  }

  isVisible() {
    return !!this._overlayEl && !this._overlayEl.classList.contains('hidden')
  }

  async _refresh({ background = false } = {}) {
    if (!this._rootPath) return
    if (!background) this._btnRefresh.classList.add('spinning')

    try {
      const rootPath = this._rootPath
      const [status, branches] = await Promise.all([
        this._api.gitGetStatus(rootPath),
        this._api.gitGetBranches(rootPath),
      ])
      if (this._rootPath !== rootPath) return // stale — panel switched repos while awaiting

      if (status?.error) {
        this._showToast(status.error, 'error')
        return
      }

      if (status?.notARepo) {
        this._branch = null
        this._renderHeaderStats()
        this._fileList.setData({ staged: [], unstaged: [], untracked: [], ignored: [], isRepo: false })
        this._diffView.clear()
        this._lastStagedCount = 0
        return
      }

      this._branch = status.branch
      this._ahead = status.ahead || 0
      this._behind = status.behind || 0
      this._totalAdditions = status.totalAdditions || 0
      this._totalDeletions = status.totalDeletions || 0
      this._lastStagedCount = (status.staged || []).length
      this._renderHeaderStats()

      const prevSelected = this._fileList.getSelected()
      const prevScroll = this._diffView.getScrollTop()

      this._fileList.setData({
        staged: (status.staged || []).map(f => ({ ...f, staged: true })),
        unstaged: (status.unstaged || []).map(f => ({ ...f, staged: false })),
        untracked: (status.untracked || []).map(f => ({ ...f, staged: false, untracked: true })),
        ignored: (status.ignored || []).map(f => ({ ...f, isIgnored: true })),
        isRepo: true,
      })

      if (!branches?.error) {
        this._branches = branches.all || []
        this._currentBranch = branches.current || null
        this._renderBranchButton()
      }

      const stillSelected = this._fileList.getSelected()
      if (stillSelected) {
        await this._showDiff(stillSelected.file, stillSelected.groupKey, { silent: true })
        this._diffView.setScrollTop(prevScroll)
      } else if (prevSelected) {
        this._diffView.clear()
      }
    } finally {
      this._btnRefresh.classList.remove('spinning')
    }
  }

  _renderHeaderStats() {
    this._statsEl.innerHTML = ''
    if (!this._branch) return
    const addStat = (cls, text) => {
      const el = document.createElement('span')
      el.className = cls
      el.textContent = text
      this._statsEl.appendChild(el)
    }
    if (this._ahead > 0) addStat('git-stat-ahead', `↑${this._ahead}`)
    if (this._behind > 0) addStat('git-stat-behind', `↓${this._behind}`)
    if (this._totalAdditions > 0) addStat('stat-add', `+${this._totalAdditions}`)
    if (this._totalDeletions > 0) addStat('stat-del', `−${this._totalDeletions}`)
  }

  _renderBranchButton() {
    this._branchLabelEl.textContent = this._currentBranch || '—'
    this._branchBtnEl.title = this._currentBranch || ''
  }

  async _showDiff(file, groupKey, opts = {}) {
    const staged = groupKey === 'staged'
    const untracked = groupKey === 'untracked'
    const isIgnoredGroup = groupKey === 'ignored'

    await this._diffView.show(
      file,
      async () => {
        if (isIgnoredGroup) return ''
        const result = await this._api.gitGetDiff(this._rootPath, file.path, { staged, untracked })
        return typeof result === 'string' ? result : ''
      },
      {
        silent: opts.silent,
        emptyMessage: isIgnoredGroup ? 'This file is ignored by .gitignore — no diff to show' : undefined,
      }
    )
  }

  async _doStage(files) {
    if (!files || files.length === 0 || !this._rootPath) return
    const result = await this._api.gitStage(this._rootPath, files.map(f => f.path))
    if (result?.error) this._showToast(result.error, 'error')
    else await this._refresh()
  }

  async _doUnstage(files) {
    if (!files || files.length === 0 || !this._rootPath) return
    const result = await this._api.gitUnstage(this._rootPath, files.map(f => f.path))
    if (result?.error) this._showToast(result.error, 'error')
    else await this._refresh()
  }

  async _onDiscardFile(file) {
    if (!this._rootPath) return
    const confirmed = await this._confirmDialog.open({
      title: 'Discard Changes',
      message: `Discard changes to "${file.path}"? This cannot be undone.`,
      confirmText: 'Discard',
      cancelText: 'Cancel',
    })
    if (!confirmed) return
    const result = await this._api.gitDiscardFile(this._rootPath, [file.path], { untracked: !!file.untracked })
    if (result?.error) this._showToast(result.error, 'error')
    else await this._refresh()
  }

  _openFile(file) {
    if (!this._rootPath || !file) return
    const base = this._rootPath.replace(/\/$/, '')
    this._bus.emit('filetree.openFile', `${base}/${file.path}`)
  }

  async _copyPath(file) {
    try {
      await navigator.clipboard.writeText(file.path)
      this._showToast('Path copied', 'success')
    } catch {
      this._showToast('Could not copy path', 'error')
    }
  }

  async _doCommit() {
    if (!this._rootPath) return
    const msg = this._commitMsgEl.value.trim()
    if (!msg) {
      this._showToast('Commit message cannot be empty', 'error')
      return
    }
    this._setActionsDisabled(true)
    const stageAll = this._lastStagedCount === 0
    const result = await this._api.gitCommit(this._rootPath, msg, { stageAll })
    if (result?.error) {
      this._showToast(result.error, 'error')
    } else {
      this._commitMsgEl.value = ''
      this._showToast('Committed', 'success')
      await this._refresh()
    }
    this._setActionsDisabled(false)
  }

  async _doPush() {
    if (!this._rootPath) return
    this._setActionsDisabled(true)
    const originalLabel = this._btnPush.textContent
    this._btnPush.textContent = '…'
    const result = await this._api.gitPush(this._rootPath)
    if (result?.error) this._showToast(result.error, 'error')
    else this._showToast('Pushed successfully', 'success')
    this._btnPush.textContent = originalLabel
    this._setActionsDisabled(false)
    await this._refresh()
  }

  _setActionsDisabled(bool) {
    [this._btnCommit, this._btnPush, this._commitMsgEl].forEach((el) => { if (el) el.disabled = bool })
  }

  _openMoreMenu(e) {
    e.stopPropagation()
    const rect = this._btnMore.getBoundingClientRect()
    this._menu.show([
      { label: 'Discard All Changes', action: () => this._confirmDiscardAll() },
    ], Math.round(rect.left), Math.round(rect.bottom + 4))
  }

  async _confirmDiscardAll() {
    if (!this._rootPath) return
    const confirmed = await this._confirmDialog.open({
      title: 'Discard All Changes',
      message: 'This permanently discards all uncommitted changes and untracked files. This cannot be undone.',
      confirmText: 'Discard All',
      cancelText: 'Cancel',
    })
    if (!confirmed) return
    const result = await this._api.gitDiscard(this._rootPath)
    if (result?.error) {
      this._showToast(result.error, 'error')
    } else {
      this._diffView.clear()
      this._showToast('Changes discarded', 'success')
      await this._refresh()
    }
  }

  _showToast(msg, type = 'error') {
    clearTimeout(this._toastTimer)
    this._toastEl.textContent = msg
    this._toastEl.className = `git-toast visible ${type === 'success' ? 'success' : 'error'}`
    this._toastTimer = setTimeout(() => {
      this._toastEl.classList.remove('visible')
    }, type === 'success' ? 2000 : 4000)
  }

  // — Branch popover —

  _toggleBranchPopover() {
    if (this._branchPopoverEl) this._closeBranchPopover()
    else this._openBranchPopover()
  }

  _openBranchPopover() {
    this._closeBranchPopover()

    const pop = document.createElement('div')
    pop.className = 'git-branch-popover'
    pop.innerHTML = `
      <input type="text" class="git-branch-search" placeholder="Search or create branch…" />
      <div class="git-branch-list"></div>
    `
    document.body.appendChild(pop)
    this._branchPopoverEl = pop

    const rect = this._branchBtnEl.getBoundingClientRect()
    pop.style.left = `${Math.round(rect.left)}px`
    pop.style.top = `${Math.round(rect.bottom + 4)}px`

    const searchInput = pop.querySelector('.git-branch-search')
    const listEl = pop.querySelector('.git-branch-list')

    const renderList = () => {
      const q = searchInput.value.trim()
      const qLower = q.toLowerCase()
      listEl.innerHTML = ''
      const filtered = this._branches.filter(b => b.toLowerCase().includes(qLower))

      filtered.forEach((name) => {
        const item = document.createElement('div')
        item.className = 'git-branch-item'
        if (name === this._currentBranch) item.classList.add('current')

        const label = document.createElement('span')
        label.className = 'git-branch-item-label'
        label.textContent = name
        item.appendChild(label)

        if (name !== this._currentBranch) {
          const delBtn = document.createElement('button')
          delBtn.type = 'button'
          delBtn.className = 'git-branch-item-delete'
          delBtn.innerHTML = Icons.trash
          delBtn.title = 'Delete branch'
          delBtn.addEventListener('click', (e) => {
            e.stopPropagation()
            this._closeBranchPopover()
            this._deleteBranch(name)
          })
          item.appendChild(delBtn)
        }

        item.addEventListener('click', () => {
          this._closeBranchPopover()
          if (name !== this._currentBranch) this._checkoutBranch(name)
        })
        listEl.appendChild(item)
      })

      if (q && !this._branches.some(b => b.toLowerCase() === qLower)) {
        const createItem = document.createElement('div')
        createItem.className = 'git-branch-item git-branch-item-create'
        createItem.textContent = `+ Create branch "${q}"`
        createItem.addEventListener('click', () => {
          this._closeBranchPopover()
          this._createBranch(q)
        })
        listEl.appendChild(createItem)
      } else if (!filtered.length) {
        const empty = document.createElement('div')
        empty.className = 'git-branch-item-empty'
        empty.textContent = 'No branches'
        listEl.appendChild(empty)
      }
    }

    renderList()
    searchInput.addEventListener('input', renderList)
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = searchInput.value.trim()
        if (!q) return
        const exact = this._branches.find(b => b.toLowerCase() === q.toLowerCase())
        this._closeBranchPopover()
        if (exact) { if (exact !== this._currentBranch) this._checkoutBranch(exact) }
        else this._createBranch(q)
      } else if (e.key === 'Escape') {
        e.stopPropagation()
        this._closeBranchPopover()
      }
    })

    requestAnimationFrame(() => searchInput.focus())

    this._branchPopoverOutsideHandler = (e) => {
      if (this._branchPopoverEl && !this._branchPopoverEl.contains(e.target) &&
          e.target !== this._branchBtnEl && !this._branchBtnEl.contains(e.target)) {
        this._closeBranchPopover()
      }
    }
    setTimeout(() => document.addEventListener('click', this._branchPopoverOutsideHandler), 0)
  }

  _closeBranchPopover() {
    if (this._branchPopoverEl) {
      this._branchPopoverEl.remove()
      this._branchPopoverEl = null
    }
    if (this._branchPopoverOutsideHandler) {
      document.removeEventListener('click', this._branchPopoverOutsideHandler)
      this._branchPopoverOutsideHandler = null
    }
  }

  async _checkoutBranch(name) {
    if (!this._rootPath) return
    const result = await this._api.gitCheckout(this._rootPath, name)
    if (result?.error) this._showToast(result.error, 'error')
    else await this._refresh()
  }

  async _createBranch(name) {
    if (!name || !this._rootPath) return
    const result = await this._api.gitCreateBranch(this._rootPath, name)
    if (result?.error) this._showToast(result.error, 'error')
    else await this._refresh()
  }

  async _deleteBranch(name) {
    if (!this._rootPath) return
    if (name === 'main' || name === 'master') {
      this._showToast('Cannot delete main/master branch', 'error')
      return
    }
    if (this._branches.length <= 1) {
      this._showToast('Cannot delete the only branch', 'error')
      return
    }
    const confirmed = await this._confirmDialog.open({
      title: 'Delete Branch',
      message: `Delete branch "${name}"? This cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
    })
    if (!confirmed) return
    const result = await this._api.gitDeleteBranch(this._rootPath, name)
    if (result?.error) this._showToast(result.error, 'error')
    else await this._refresh()
  }

  destroy() {
    this._closeBranchPopover()
    clearTimeout(this._toastTimer)
    this._statusUnsub?.()
    this._statusUnsub = null
    this._cleanupController?.abort()
    this._cleanupController = null
    this._menu?.destroy()
    this._menu = null
    this._fileList?.destroy()
    this._fileList = null
    this._diffView?.destroy()
    this._diffView = null
    if (this._overlayEl) this._overlayEl.innerHTML = ''
    this._overlayEl = null
    this._bus = null
    this._store = null
    this._api = null
    this._confirmDialog = null
    this._onClose = null
  }
}
