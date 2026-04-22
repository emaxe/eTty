import { EditorState, Compartment } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor
} from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab
} from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import {
  indentOnInput,
  bracketMatching,
  foldGutter,
  foldKeymap,
  syntaxHighlighting,
  defaultHighlightStyle
} from '@codemirror/language'
// Fallback highlight style used before the real theme is applied
const _fallbackHighlight = syntaxHighlighting(defaultHighlightStyle, { fallback: true })
import { buildEditorTheme } from './editor-theme.js'
import { getLanguageExtension } from './editor-languages.js'
import { fileLinksExtension, normalizePath } from './editor-file-links.js'
import { ContextMenu } from './context-menu.js'

export class EditorPanel {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.panelEl       — #editor-panel
   * @param {HTMLElement} opts.resizeHandleEl — #resize-handle-right
   * @param {Function}   opts.onResize       — called when panel shows/hides
   * @param {Function}   [opts.onShow]       — called when panel becomes visible
   * @param {Function}   [opts.onHide]       — called when panel becomes hidden (close button, last tab close)
   * @param {Function}   opts.writeToPty     — (data: string) => void, pure write for text injection
   * @param {Function}   opts.shellCmdToPty  — (data: string) => void, clears line + writes for shell commands
   * @param {Function}   opts.getActiveCwd   — () => string, active terminal cwd
   */
  constructor({ panelEl, resizeHandleEl, onResize, onShow, onHide, writeToPty, shellCmdToPty, getActiveCwd }) {
    this._panelEl = panelEl
    this._resizeHandleEl = resizeHandleEl
    this._onResize = onResize
    this._onShow = onShow
    this._onHide = onHide
    this._writeToPty = writeToPty
    this._shellCmdToPty = shellCmdToPty
    this._getActiveCwd = getActiveCwd

    this._tabBarEl = panelEl.querySelector('#editor-tab-bar')
    this._bodyEl = panelEl.querySelector('#editor-body')
    this._btnOpenExternal = panelEl.querySelector('#btn-open-external')
    this._btnClose = panelEl.querySelector('#btn-close-editor')
    this._btnSendFloat = panelEl.querySelector('#btn-send-lines-float')
    this._statusFile = panelEl.querySelector('#editor-status-file')
    this._statusPos = panelEl.querySelector('#editor-status-pos')
    this._statusModified = panelEl.querySelector('#editor-status-modified')

    // Map<filePath, { view, element, modified, originalContent, pendingClose }>
    this._tabs = new Map()
    this._activeFilePath = null

    this._contextMenu = new ContextMenu()

    // Drag-and-drop state
    this._dragState = null
    this._dropIndicator = null
    this._onEditorDragMove = this._onEditorDragMove.bind(this)
    this._onEditorDragEnd = this._onEditorDragEnd.bind(this)

    // Compartments for hot-swap
    this._themeCompartment = new Compartment()
    this._wrapCompartment = new Compartment()
    this._currentThemeExts = [_fallbackHighlight]
    this._wordWrap = false

    this._setupListeners()
  }

  // ── Public API ───────────────────────────────────────────────────────────

  async openFile(filePath) {
    // If already open, just switch to it
    if (this._tabs.has(filePath)) {
      this._switchToTab(filePath)
      this.show()
      return
    }

    this.show()
    this._showPlaceholder('Загрузка…')

    const result = await window.electronAPI.fsReadFile(filePath)
    if (!result.success) {
      this._showPlaceholder(`Не удалось открыть файл:\n${result.error}`)
      return
    }

    const content = result.content
    const langExts = await getLanguageExtension(filePath)

    let view
    try {
      view = this._createEditorView(filePath, content, langExts)
    } catch (e) {
      console.error('[EditorPanel] createEditorView failed:', e)
      this._showPlaceholder(`Ошибка инициализации редактора:\n${e.message}`)
      return
    }

    const tabEl = this._createTabElement(filePath)

    this._tabs.set(filePath, {
      view,
      element: tabEl,
      modified: false,
      originalContent: content,
      pendingClose: false
    })

    this._tabBarEl.appendChild(tabEl)
    this._switchToTab(filePath)
  }

  closeFile(filePath) {
    const tab = this._tabs.get(filePath)
    if (!tab) return

    if (tab.modified) {
      this._confirmClose(filePath)
      return
    }
    this._closeTab(filePath)
  }

  show() {
    if (this.isVisible()) return
    this._panelEl.classList.remove('hidden')
    this._resizeHandleEl.classList.remove('hidden')
    this._onResize?.()
    this._onShow?.()
  }

  hide() {
    if (!this.isVisible()) return
    this._panelEl.classList.add('hidden')
    this._resizeHandleEl.classList.add('hidden')
    this._onResize?.()
    this._onHide?.()
  }

  toggle() {
    this.isVisible() ? this.hide() : this.show()
  }

  isVisible() {
    return !this._panelEl.classList.contains('hidden')
  }

  setTheme(editorColors) {
    const newExts = buildEditorTheme(editorColors)
    this._currentThemeExts = newExts
    for (const [, tab] of this._tabs) {
      tab.view.dispatch({
        effects: this._themeCompartment.reconfigure(newExts)
      })
    }
  }

  toggleWordWrap() {
    this._wordWrap = !this._wordWrap
    const ext = this._wordWrap ? EditorView.lineWrapping : []
    for (const [, tab] of this._tabs) {
      tab.view.dispatch({ effects: this._wrapCompartment.reconfigure(ext) })
    }
    return this._wordWrap
  }

  isWordWrapOn() {
    return this._wordWrap
  }

  async saveActiveFile() {
    const filePath = this._activeFilePath
    if (!filePath) return
    const tab = this._tabs.get(filePath)
    if (!tab) return

    const content = tab.view.state.doc.toString()
    const result = await window.electronAPI.fsWriteFile(filePath, content)
    if (result.success) {
      tab.originalContent = content
      this._setModified(filePath, false)
    }
  }

  hasUnsavedChanges() {
    for (const [, tab] of this._tabs) {
      if (tab.modified) return true
    }
    return false
  }

  getOpenFiles() {
    return [...this._tabs.keys()]
  }

  /**
   * Suspend editor state — detach all views from DOM, return serialisable snapshot.
   * Call this before switching terminal tabs.
   * @returns {{ files: Array<{ path: string, scrollTop: number, scrollLeft: number }>, activePath: string|null, visible: boolean }}
   */
  suspendState() {
    // Save scroll of the active view
    if (this._activeFilePath) {
      const active = this._tabs.get(this._activeFilePath)
      if (active) {
        const scroller = active.view.scrollDOM
        active.savedScrollTop = scroller.scrollTop
        active.savedScrollLeft = scroller.scrollLeft
      }
    }

    const files = []
    for (const [filePath, tab] of this._tabs) {
      files.push({
        path: filePath,
        scrollTop: tab.savedScrollTop ?? tab.view.scrollDOM.scrollTop,
        scrollLeft: tab.savedScrollLeft ?? tab.view.scrollDOM.scrollLeft
      })
      // Detach DOM
      if (this._bodyEl.contains(tab.view.dom)) tab.view.dom.remove()
      tab.element.remove()
    }

    const state = {
      files,
      activePath: this._activeFilePath,
      visible: this.isVisible()
    }

    // Clear internal state without destroying views — keep them in a detached map
    const detached = new Map(this._tabs)
    this._tabs = new Map()
    this._activeFilePath = null
    this._tabBarEl.innerHTML = ''
    this._showPlaceholder('Файл не открыт')
    this.hide()

    return { ...state, _detachedTabs: detached }
  }

  /**
   * Restore previously suspended editor state.
   * @param {object|null} state — return value of suspendState(), or null for fresh state
   */
  restoreState(state) {
    // Clean up any current editor tabs
    for (const [, tab] of this._tabs) {
      if (this._bodyEl.contains(tab.view.dom)) tab.view.dom.remove()
      tab.element.remove()
    }
    this._tabs = new Map()
    this._activeFilePath = null
    this._tabBarEl.innerHTML = ''

    if (!state) {
      this._showPlaceholder('Файл не открыт')
      this.hide()
      return
    }

    // If state has serialised data but no detached views — restore from disk
    if (!state._detachedTabs || state._detachedTabs.size === 0) {
      if (state.files && state.files.length > 0) {
        this.restoreEditorFromSaved(state)
      } else {
        this._showPlaceholder('Файл не открыт')
        this.hide()
      }
      return
    }

    // Re-attach tabs
    for (const [filePath, tab] of state._detachedTabs) {
      this._tabs.set(filePath, tab)
      this._tabBarEl.appendChild(tab.element)
    }

    // Switch to previously active tab
    const activePath = state.activePath && this._tabs.has(state.activePath)
      ? state.activePath
      : this._tabs.keys().next().value

    if (activePath) {
      this._switchToTab(activePath)
    }

    if (state.visible) {
      this.show()
    } else {
      this.hide()
    }
  }

  /**
   * Export editor state for persistence (serialisable, no view references).
   * @returns {{ files: Array<{ path: string, scrollTop: number, scrollLeft: number }>, activePath: string|null, visible: boolean }|null}
   */
  exportEditorState() {
    if (this._tabs.size === 0) return null
    const files = []
    for (const [filePath, tab] of this._tabs) {
      const scroller = tab.view.scrollDOM
      files.push({
        path: filePath,
        scrollTop: tab.savedScrollTop ?? scroller.scrollTop,
        scrollLeft: tab.savedScrollLeft ?? scroller.scrollLeft
      })
    }
    return {
      files,
      activePath: this._activeFilePath,
      visible: this.isVisible()
    }
  }

  /**
   * Restore editor state from persistence (re-opens files from disk).
   * @param {{ files: Array<{ path: string, scrollTop: number, scrollLeft: number }>, activePath: string|null, visible: boolean }} state
   */
  async restoreEditorFromSaved(state) {
    if (!state || !state.files || state.files.length === 0) return
    for (const f of state.files) {
      await this.openFile(f.path)
      const tab = this._tabs.get(f.path)
      if (tab) {
        tab.savedScrollTop = f.scrollTop
        tab.savedScrollLeft = f.scrollLeft
      }
    }
    if (state.activePath && this._tabs.has(state.activePath)) {
      this._switchToTab(state.activePath)
    }
    if (state.visible) {
      this.show()
    } else {
      this.hide()
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  _createEditorView(filePath, content, langExts) {
    const self = this

    const state = EditorState.create({
      doc: content,
      extensions: [
        // Theme (hot-swappable)
        this._themeCompartment.of(this._currentThemeExts),

        // Word wrap (hot-swappable)
        this._wrapCompartment.of(this._wordWrap ? EditorView.lineWrapping : []),

        // Language (static per file)
        ...langExts,

        // Core extensions
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        drawSelection(),
        dropCursor(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        foldGutter(),
        history(),
        rectangularSelection(),
        crosshairCursor(),

        // Keymaps
        keymap.of([
          { key: 'Mod-s', run: () => { self.saveActiveFile(); return true } },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab
        ]),

        // File-link decorations (Ctrl/Cmd+Click to open)
        fileLinksExtension({
          onFileClick: (pathText) => self._handleFileLinkClick(pathText)
        }),

        // Update listener for dirty tracking and status bar
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            self._onDocChanged(filePath, update.state.doc.toString())
          }
          if (update.selectionSet || update.docChanged) {
            self._updateStatusBar()
            self._updateSendButton()
          }
        })
      ]
    })

    return new EditorView({ state })
  }

  _createTabElement(filePath) {
    const name = filePath.split('/').pop()
    const tab = document.createElement('div')
    tab.className = 'editor-tab'
    tab.dataset.path = filePath

    const nameSpan = document.createElement('span')
    nameSpan.className = 'editor-tab-name'
    nameSpan.textContent = name
    nameSpan.title = filePath

    const closeBtn = document.createElement('button')
    closeBtn.className = 'editor-tab-close'
    closeBtn.title = 'Закрыть вкладку'
    closeBtn.innerHTML = '✕'
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      this.closeFile(filePath)
    })

    tab.appendChild(nameSpan)
    tab.appendChild(closeBtn)
    tab.addEventListener('click', () => this._switchToTab(filePath))

    // Context menu
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      this._showTabContextMenu(filePath, e.clientX, e.clientY)
    })

    // Drag-and-drop
    tab.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      if (e.target.closest('.editor-tab-close')) return
      this._initEditorDrag(filePath, e)
    })

    return tab
  }

  _switchToTab(filePath) {
    const tab = this._tabs.get(filePath)
    if (!tab) return

    this._hideFloatBtn()

    // Deactivate current — save scroll position before removing DOM
    if (this._activeFilePath && this._activeFilePath !== filePath) {
      const prev = this._tabs.get(this._activeFilePath)
      if (prev) {
        const scroller = prev.view.scrollDOM
        prev.savedScrollTop = scroller.scrollTop
        prev.savedScrollLeft = scroller.scrollLeft
        prev.element.classList.remove('active')
        prev.view.dom.remove()
      }
    }

    // Remove placeholder if any
    const placeholder = this._bodyEl.querySelector('.editor-placeholder')
    if (placeholder) placeholder.remove()

    // Mount new view
    this._activeFilePath = filePath
    tab.element.classList.add('active')
    tab.element.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })

    if (!this._bodyEl.contains(tab.view.dom)) {
      this._bodyEl.appendChild(tab.view.dom)
    }

    // Restore scroll position after layout
    if (tab.savedScrollTop != null) {
      const top = tab.savedScrollTop
      const left = tab.savedScrollLeft || 0
      requestAnimationFrame(() => {
        const scroller = tab.view.scrollDOM
        scroller.scrollTop = top
        scroller.scrollLeft = left
      })
    }

    tab.view.focus()
    this._updateStatusBar()
    this._updateSendButton()
  }

  _closeTab(filePath) {
    const tab = this._tabs.get(filePath)
    if (!tab) return

    // Remove DOM
    tab.element.remove()
    if (this._bodyEl.contains(tab.view.dom)) {
      tab.view.dom.remove()
    }
    tab.view.destroy()
    this._tabs.delete(filePath)

    // Switch to adjacent tab or show empty state
    if (this._activeFilePath === filePath) {
      this._activeFilePath = null
      const remaining = [...this._tabs.keys()]
      if (remaining.length > 0) {
        this._switchToTab(remaining[remaining.length - 1])
      } else {
        this._showPlaceholder('Файл не открыт')
        this._updateStatusBar()
        this._updateSendButton()
        this.hide()
      }
    }
  }

  _confirmClose(filePath) {
    const tab = this._tabs.get(filePath)
    if (!tab || tab.pendingClose) return

    const name = filePath.split('/').pop()
    tab.pendingClose = true

    // Replace close button with confirm/cancel
    const tabEl = tab.element
    const originalClose = tabEl.querySelector('.editor-tab-close')
    originalClose.style.display = 'none'

    const confirmSpan = document.createElement('span')
    confirmSpan.style.cssText = 'display:flex;gap:2px;align-items:center;'

    const saveBtn = document.createElement('button')
    saveBtn.className = 'editor-tab-close'
    saveBtn.style.opacity = '1'
    saveBtn.title = `Сохранить и закрыть`
    saveBtn.textContent = '💾'
    saveBtn.style.fontSize = '9px'

    const discardBtn = document.createElement('button')
    discardBtn.className = 'editor-tab-close'
    discardBtn.style.opacity = '1'
    discardBtn.title = 'Закрыть без сохранения'
    discardBtn.textContent = '✕'

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'editor-tab-close'
    cancelBtn.style.opacity = '1'
    cancelBtn.title = 'Отмена'
    cancelBtn.textContent = '←'

    const restore = () => {
      tab.pendingClose = false
      confirmSpan.remove()
      originalClose.style.display = ''
    }

    saveBtn.addEventListener('click', async (e) => {
      e.stopPropagation()
      await this.saveActiveFile()
      this._closeTab(filePath)
    })
    discardBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      tab.modified = false
      this._closeTab(filePath)
    })
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      restore()
    })

    confirmSpan.append(saveBtn, discardBtn, cancelBtn)
    tabEl.appendChild(confirmSpan)
    this._switchToTab(filePath)
  }

  _onDocChanged(filePath, newContent) {
    const tab = this._tabs.get(filePath)
    if (!tab) return
    const modified = newContent !== tab.originalContent
    if (modified !== tab.modified) {
      this._setModified(filePath, modified)
    }
  }

  _setModified(filePath, modified) {
    const tab = this._tabs.get(filePath)
    if (!tab) return
    tab.modified = modified
    tab.element.classList.toggle('modified', modified)
    if (filePath === this._activeFilePath) {
      this._statusModified.textContent = modified ? '●' : ''
    }
  }

  _updateStatusBar() {
    const filePath = this._activeFilePath
    if (!filePath) {
      this._statusFile.textContent = ''
      this._statusPos.textContent = ''
      this._statusModified.textContent = ''
      return
    }

    const tab = this._tabs.get(filePath)
    if (!tab) return

    // Relative path from cwd
    const cwd = this._getActiveCwd?.() || ''
    let displayPath = filePath
    if (cwd && filePath.startsWith(cwd + '/')) {
      displayPath = filePath.slice(cwd.length + 1)
    }
    this._statusFile.textContent = displayPath

    // Cursor position
    const state = tab.view.state
    const sel = state.selection.main
    const line = state.doc.lineAt(sel.head)
    const col = sel.head - line.from + 1
    this._statusPos.textContent = `Ln ${line.number}, Col ${col}`

    this._statusModified.textContent = tab.modified ? '●' : ''
  }

  _updateSendButton() {
    const filePath = this._activeFilePath
    if (!filePath) { this._hideFloatBtn(); return }
    const tab = this._tabs.get(filePath)
    if (!tab) { this._hideFloatBtn(); return }
    const sel = tab.view.state.selection.main
    if (sel.empty) {
      this._hideFloatBtn()
    } else {
      this._positionFloatBtn(tab.view, sel)
    }
  }

  _positionFloatBtn(view, sel) {
    const btn = this._btnSendFloat
    const coordsFrom = view.coordsAtPos(sel.from, -1)
    const coordsTo = view.coordsAtPos(sel.to, 1)
    if (!coordsFrom || !coordsTo) { this._hideFloatBtn(); return }

    const bodyRect = this._bodyEl.getBoundingClientRect()
    const btnW = 24
    const btnH = 24
    const margin = 6

    // Horizontally: to the LEFT of the selection start
    let left = coordsFrom.left - bodyRect.left - btnW - margin
    if (left < 4) left = 4

    // Vertically: aligned with the bottom of the last selected line
    let top = coordsTo.bottom - bodyRect.top - btnH / 2 - btnH / 4
    const maxTop = this._bodyEl.clientHeight - btnH - 4
    if (top > maxTop) top = maxTop
    if (top < 0) top = 4

    btn.style.top = top + 'px'
    btn.style.left = left + 'px'
    btn.style.display = 'flex'
  }

  _hideFloatBtn() {
    this._btnSendFloat.style.display = 'none'
  }

  _sendLinesToTerminal() {
    const filePath = this._activeFilePath
    if (!filePath) return
    const tab = this._tabs.get(filePath)
    if (!tab) return

    const state = tab.view.state
    const sel = state.selection.main
    if (sel.empty) return

    const startLine = state.doc.lineAt(sel.from).number
    const endLine = state.doc.lineAt(sel.to).number

    // Relative path from cwd
    const cwd = this._getActiveCwd?.() || ''
    let displayPath = filePath
    if (cwd && filePath.startsWith(cwd + '/')) {
      displayPath = filePath.slice(cwd.length + 1)
    }

    const lineRef = startLine === endLine
      ? `${displayPath}:${startLine}`
      : `${displayPath}:${startLine}-${endLine}`

    // Clear selection
    tab.view.dispatch({ selection: { anchor: sel.to } })
    this._hideFloatBtn()

    // Use bracketed paste mode so TUI apps (Copilot, Claude Code, etc.)
    // correctly receive the text as pasted input
    this._writeToPty?.('\x1b[200~' + lineRef + '\x1b[201~')
  }

  _openExternal() {
    const filePath = this._activeFilePath
    if (!filePath) return
    // Use shell 'open' command — works on macOS, Linux uses 'xdg-open'
    const escaped = filePath.replace(/'/g, "'\\''")
    this._shellCmdToPty?.(`open '${escaped}'\r`)
  }

  async _handleFileLinkClick(pathText) {
    let resolved
    if (pathText.startsWith('/')) {
      resolved = normalizePath(pathText)
    } else if (pathText.startsWith('./') || pathText.startsWith('../')) {
      const base = this._activeFilePath
        ? this._activeFilePath.substring(0, this._activeFilePath.lastIndexOf('/'))
        : this._getActiveCwd?.() || '/'
      resolved = normalizePath(base + '/' + pathText)
    } else {
      const cwd = this._getActiveCwd?.() || '/'
      resolved = normalizePath(cwd + '/' + pathText)
    }

    // Pre-check: try reading the file before switching tabs
    const result = await window.electronAPI.fsReadFile(resolved)
    if (!result.success) {
      this._showLinkError(resolved, result.error)
      return
    }
    this.openFile(resolved)
  }

  _showLinkError(filePath, error) {
    const overlay = document.createElement('div')
    overlay.className = 'link-error-overlay'

    const dialog = document.createElement('div')
    dialog.className = 'link-error-dialog'

    const title = document.createElement('div')
    title.className = 'link-error-title'
    title.textContent = 'Не удалось открыть файл'

    const msg = document.createElement('div')
    msg.className = 'link-error-msg'
    msg.textContent = filePath

    const detail = document.createElement('div')
    detail.className = 'link-error-detail'
    detail.textContent = error

    const btn = document.createElement('button')
    btn.className = 'link-error-btn'
    btn.textContent = 'OK'

    const close = () => overlay.remove()
    btn.addEventListener('click', close)
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })

    dialog.append(title, msg, detail, btn)
    overlay.appendChild(dialog)
    document.body.appendChild(overlay)
    btn.focus()
  }

  _showPlaceholder(msg) {
    // Remove any mounted editor view
    if (this._activeFilePath) {
      const tab = this._tabs.get(this._activeFilePath)
      if (tab && this._bodyEl.contains(tab.view.dom)) {
        tab.view.dom.remove()
      }
    }
    let placeholder = this._bodyEl.querySelector('.editor-placeholder')
    if (!placeholder) {
      placeholder = document.createElement('div')
      placeholder.className = 'editor-placeholder'
      this._bodyEl.appendChild(placeholder)
    }
    placeholder.textContent = msg
  }

  // — Context menu —

  _showTabContextMenu(filePath, x, y) {
    const keys = [...this._tabs.keys()]
    const index = keys.indexOf(filePath)
    if (index < 0) return
    const total = keys.length

    this._contextMenu.show([
      { label: 'Закрыть все', action: () => this._closeAllTabs() },
      { label: 'Закрыть все кроме этой', action: () => this._closeAllExcept(filePath), disabled: total <= 1 },
      { separator: true },
      { label: 'Закрыть все слева', action: () => this._closeLeftOf(filePath), disabled: index === 0 },
      { label: 'Закрыть все справа', action: () => this._closeRightOf(filePath), disabled: index === total - 1 }
    ], x, y)
  }

  _closeAllTabs() {
    const keys = [...this._tabs.keys()]
    for (const path of keys) {
      const tab = this._tabs.get(path)
      if (tab) { tab.modified = false; this._closeTab(path) }
    }
  }

  _closeAllExcept(keepPath) {
    const keys = [...this._tabs.keys()]
    for (const path of keys) {
      if (path === keepPath) continue
      const tab = this._tabs.get(path)
      if (tab) { tab.modified = false; this._closeTab(path) }
    }
  }

  _closeLeftOf(filePath) {
    const keys = [...this._tabs.keys()]
    const index = keys.indexOf(filePath)
    for (let i = 0; i < index; i++) {
      const tab = this._tabs.get(keys[i])
      if (tab) { tab.modified = false; this._closeTab(keys[i]) }
    }
  }

  _closeRightOf(filePath) {
    const keys = [...this._tabs.keys()]
    const index = keys.indexOf(filePath)
    for (let i = keys.length - 1; i > index; i--) {
      const tab = this._tabs.get(keys[i])
      if (tab) { tab.modified = false; this._closeTab(keys[i]) }
    }
  }

  // — Drag-and-drop —

  _initEditorDrag(filePath, e) {
    const tabData = this._tabs.get(filePath)
    if (!tabData) return

    this._dragState = {
      filePath,
      startX: e.clientX,
      startY: e.clientY,
      isDragging: false,
      tabEl: tabData.element,
      dropTargetIndex: null
    }

    document.addEventListener('mousemove', this._onEditorDragMove)
    document.addEventListener('mouseup', this._onEditorDragEnd)
  }

  _onEditorDragMove(e) {
    const ds = this._dragState
    if (!ds) return

    const dx = e.clientX - ds.startX
    const dy = e.clientY - ds.startY

    if (!ds.isDragging) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return
      ds.isDragging = true
      ds.tabEl.classList.add('dragging')
      document.body.style.cursor = 'grabbing'
      this._createEditorDropIndicator()
    }

    const targetIndex = this._getEditorDropIndex(e.clientX)
    if (targetIndex !== ds.dropTargetIndex) {
      ds.dropTargetIndex = targetIndex
      this._positionEditorDropIndicator(targetIndex)
    }
  }

  _onEditorDragEnd() {
    document.removeEventListener('mousemove', this._onEditorDragMove)
    document.removeEventListener('mouseup', this._onEditorDragEnd)

    const ds = this._dragState
    if (!ds) return

    if (ds.isDragging && ds.dropTargetIndex != null) {
      this._reorderEditorTab(ds.filePath, ds.dropTargetIndex)
    }

    ds.tabEl.classList.remove('dragging')
    document.body.style.cursor = ''
    this._removeEditorDropIndicator()
    this._dragState = null
  }

  _getEditorDropIndex(clientX) {
    const keys = [...this._tabs.keys()]
    for (let i = 0; i < keys.length; i++) {
      const tab = this._tabs.get(keys[i])
      const rect = tab.element.getBoundingClientRect()
      const midX = rect.left + rect.width / 2
      if (clientX < midX) return i
    }
    return keys.length
  }

  _reorderEditorTab(fromPath, toIndex) {
    const keys = [...this._tabs.keys()]
    const fromIndex = keys.indexOf(fromPath)
    if (fromIndex < 0 || fromIndex === toIndex || fromIndex + 1 === toIndex) return

    keys.splice(fromIndex, 1)
    const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex
    keys.splice(insertAt, 0, fromPath)

    // Rebuild Map in new order
    const newMap = new Map()
    for (const key of keys) {
      newMap.set(key, this._tabs.get(key))
    }
    this._tabs = newMap

    // Move DOM element
    const tab = this._tabs.get(fromPath)
    const nextKey = keys[insertAt + 1]
    if (nextKey) {
      this._tabBarEl.insertBefore(tab.element, this._tabs.get(nextKey).element)
    } else {
      this._tabBarEl.appendChild(tab.element)
    }
  }

  _createEditorDropIndicator() {
    this._dropIndicator = document.createElement('div')
    this._dropIndicator.className = 'editor-tab-drop-indicator'
    this._tabBarEl.appendChild(this._dropIndicator)
  }

  _positionEditorDropIndicator(targetIndex) {
    if (!this._dropIndicator) return
    const keys = [...this._tabs.keys()]
    const barRect = this._tabBarEl.getBoundingClientRect()
    let left
    if (targetIndex < keys.length) {
      const tab = this._tabs.get(keys[targetIndex])
      const rect = tab.element.getBoundingClientRect()
      left = rect.left - barRect.left - 1
    } else {
      const lastTab = this._tabs.get(keys[keys.length - 1])
      const lastRect = lastTab.element.getBoundingClientRect()
      left = lastRect.right - barRect.left - 1
    }
    this._dropIndicator.style.left = left + 'px'
  }

  _removeEditorDropIndicator() {
    if (this._dropIndicator) {
      this._dropIndicator.remove()
      this._dropIndicator = null
    }
  }

  _setupListeners() {
    this._btnWordWrap = this._panelEl.querySelector('#btn-word-wrap')
    this._btnWordWrap.addEventListener('click', () => {
      const on = this.toggleWordWrap()
      this._btnWordWrap.classList.toggle('active', on)
    })
    this._btnOpenExternal.addEventListener('click', () => this._openExternal())
    this._btnClose.addEventListener('click', () => this.hide())
    this._btnSendFloat.addEventListener('click', () => this._sendLinesToTerminal())
  }
}
