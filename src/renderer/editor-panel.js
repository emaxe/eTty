import { Icons } from './icons.js'
import { UI_DIMENSIONS } from './core/config/ui-dimensions.js'
import { APP_CONFIG } from './core/config/app-config.js'
import { DraggableTabs } from './components/base/tabs/draggable-tabs.js'
import { EditorState, Compartment, StateField, StateEffect, RangeSetBuilder } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  gutter,
  GutterMarker
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
import { ContextMenu } from './components/base/context-menu/context-menu.js'

// ── Diff Gutter Extension ────────────────────────────────────────────────────

const setDiffData = StateEffect.define()

const diffDataField = StateField.define({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setDiffData)) return effect.value
    }
    return value
  }
})

class DiffGutterMarker extends GutterMarker {
  constructor(type) {
    super()
    this.type = type // 'added' | 'modified' | 'deleted'
  }
  toDOM() {
    const bar = document.createElement('div')
    bar.className = `diff-gutter-bar diff-gutter-${this.type}`
    return bar
  }
}

const diffGutterExtension = [
  diffDataField,
  gutter({
    class: 'cm-diff-gutter',
    markers(view) {
      const data = view.state.field(diffDataField)
      const doc = view.state.doc
      const builder = new RangeSetBuilder()
      for (const { line, type } of data) {
        // A trailing pure deletion (removed lines at EOF) has no surviving
        // line to anchor to — clamp it to the last line instead of dropping it.
        const clamped = type === 'deleted' && line > doc.lines ? doc.lines : line
        if (clamped >= 1 && clamped <= doc.lines) {
          const lineObj = doc.line(clamped)
          builder.add(lineObj.from, lineObj.from, new DiffGutterMarker(type))
        }
      }
      return builder.finish()
    },
    lineMarkerChange: (update) =>
      update.docChanged ||
      update.transactions.some(tr => tr.effects.some(e => e.is(setDiffData))),
  })
]

// ── EditorPanel ──────────────────────────────────────────────────────────────

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
  constructor({ panelEl, resizeHandleEl, eventBus, electronAPI, getActiveCwd, store }) {
    this._panelEl = panelEl
    this._resizeHandleEl = resizeHandleEl
    this._bus = eventBus
    this._api = electronAPI
    this._getActiveCwd = getActiveCwd
    this._store = store

    this._tabBarEl = panelEl.querySelector('#editor-tab-bar')
    this._bodyEl = panelEl.querySelector('#editor-body')
    this._btnOpenExternal = panelEl.querySelector('#btn-open-external')
    this._btnClose = panelEl.querySelector('#btn-close-editor')
    this._btnSendFloat = panelEl.querySelector('#btn-send-lines-float')
    this._btnSync = panelEl.querySelector('#btn-sync-file')
    this._statusFile = panelEl.querySelector('#editor-status-file')
    this._statusPos = panelEl.querySelector('#editor-status-pos')
    this._statusModified = panelEl.querySelector('#editor-status-modified')

    // Map<filePath, { view, element, modified, originalContent, originalMtime, pendingClose }>
    this._tabs = new Map()
    this._activeFilePath = null
    this._conflictOverlay = null

    this._contextMenu = new ContextMenu()

    this._draggable = new DraggableTabs(this._tabBarEl, {
      onReorder: (fromIndex, toIndex) => this._handleReorder(fromIndex, toIndex)
    })

    // Compartments for hot-swap
    this._themeCompartment = new Compartment()
    this._wrapCompartment = new Compartment()
    this._currentThemeExts = [_fallbackHighlight]
    this._wordWrap = false

    this._diffUnsubscribe = null

    this._cleanupController = new AbortController()
    this._setupListeners()
    this._setupGitStatusSubscription()
    this._setupFileTreeSubscription()
  }

  _syncStore() {
    this._store.set('editor.files', [...this._tabs.keys()])
    this._store.set('editor.activePath', this._activeFilePath)
  }

  // ── Public API ───────────────────────────────────────────────────────────

  async openFile(filePath) {
    // If already open, check sync and switch
    if (this._tabs.has(filePath)) {
      await this._checkAndSyncTab(filePath)
      this._switchToTab(filePath)
      this.show()
      return
    }

    this.show()
    this._showPlaceholder('Загрузка…')

    const [readResult, statResult] = await Promise.all([
      this._api.fsReadFile(filePath),
      this._api.fsStatFile(filePath)
    ])
    if (!readResult.success) {
      this._showPlaceholder(`Не удалось открыть файл:\n${readResult.error}`)
      return
    }

    const content = readResult.content
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
      originalMtime: statResult.success ? statResult.mtimeMs : 0,
      pendingClose: false
    })

    this._tabBarEl.appendChild(tabEl)
    this._draggable.observeElement(tabEl)
    this._syncStore()
    this._switchToTab(filePath)

    if (this._store?.get('git.isRepo')) {
      this._fetchAndApplyDiff(filePath)
    }
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
    this._bus.emit('editor.resize')
    this._bus.emit('editor.show')
  }

  hide() {
    if (!this.isVisible()) return
    this._panelEl.classList.add('hidden')
    this._resizeHandleEl.classList.add('hidden')
    this._bus.emit('editor.resize')
    this._bus.emit('editor.hide')
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

    // Check if file changed on disk since last open/save
    const stat = await this._api.fsStatFile(filePath)
    if (stat.success && stat.mtimeMs > (tab.originalMtime || 0)) {
      this._showSaveConflictDialog(filePath, stat.mtimeMs, content)
      return
    }

    await this._doSaveFile(filePath, content)
  }

  async _doSaveFile(filePath, content) {
    const tab = this._tabs.get(filePath)
    if (!tab) return

    const result = await this._api.fsWriteFile(filePath, content)
    if (result.success) {
      tab.originalContent = content
      const stat = await this._api.fsStatFile(filePath)
      tab.originalMtime = stat.success ? stat.mtimeMs : Date.now()
      this._setModified(filePath, false)
      this._updateSyncButton(false)
      this._bus.emit('editor.file-saved', { filePath })
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
        active.scrollSnapshot = active.view.scrollSnapshot()
      }
    }

    const files = []
    for (const [filePath, tab] of this._tabs) {
      files.push({
        path: filePath,
        scrollTop: tab.savedScrollTop ?? tab.view.scrollDOM.scrollTop,
        scrollLeft: tab.savedScrollLeft ?? tab.view.scrollDOM.scrollLeft,
        originalMtime: tab.originalMtime
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
  async restoreState(state) {
    // Clean up any current editor tabs — destroy CodeMirror views to prevent leaks
    for (const [, tab] of this._tabs) {
      if (this._bodyEl.contains(tab.view.dom)) tab.view.dom.remove()
      tab.element.remove()
      tab.view.destroy()
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
        await this.restoreEditorFromSaved(state)
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
    // Clear stale references so index.js cleanup doesn't destroy re-attached views
    state._detachedTabs.clear()

    // Switch to previously active tab
    const activePath = state.activePath && this._tabs.has(state.activePath)
      ? state.activePath
      : this._tabs.keys().next().value

    if (activePath) {
      await this._switchToTab(activePath)
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
        scrollLeft: tab.savedScrollLeft ?? scroller.scrollLeft,
        originalMtime: tab.originalMtime
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
   * @param {{ files: Array<{ path: string, scrollTop: number, scrollLeft: number, originalMtime?: number }>, activePath: string|null, visible: boolean }} state
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

        // Diff gutter — declared before lineNumbers() so it renders to its
        // left (VS Code convention), not squeezed between numbers and text.
        ...diffGutterExtension,

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
    closeBtn.innerHTML = Icons.close
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

    return tab
  }

  async _switchToTab(filePath) {
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
        prev.scrollSnapshot = prev.view.scrollSnapshot()
        prev.element.classList.remove('active')
        prev.view.dom.remove()
      }
    }

    // Remove placeholder if any
    const placeholder = this._bodyEl.querySelector('.editor-placeholder')
    if (placeholder) placeholder.remove()

    // Mount new view
    this._activeFilePath = filePath
    this._syncStore()
    tab.element.classList.add('active')
    tab.element.scrollIntoView({ behavior: 'auto', inline: 'nearest', block: 'nearest' })

    if (!this._bodyEl.contains(tab.view.dom)) {
      this._bodyEl.appendChild(tab.view.dom)
    }

    // Restore scroll position. Prefer the CodeMirror scroll snapshot — it survives
    // the re-measure CM6 does after the view's DOM is re-attached. Fall back to the
    // raw pixel offsets for views that never had a snapshot (e.g. just opened from disk).
    if (tab.scrollSnapshot) {
      tab.view.dispatch({ effects: tab.scrollSnapshot })
    } else if (tab.savedScrollTop != null) {
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

    // Check if file on disk changed while tab was inactive
    await this._checkAndSyncTab(filePath)
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
    this._syncStore()

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
    saveBtn.innerHTML = Icons.save

    const discardBtn = document.createElement('button')
    discardBtn.className = 'editor-tab-close'
    discardBtn.style.opacity = '1'
    discardBtn.title = 'Закрыть без сохранения'
    discardBtn.innerHTML = Icons.close

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'editor-tab-close'
    cancelBtn.style.opacity = '1'
    cancelBtn.title = 'Отмена'
    cancelBtn.innerHTML = Icons.arrowLeft

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
    const btnW = UI_DIMENSIONS.FLOAT_BTN.WIDTH
    const btnH = UI_DIMENSIONS.FLOAT_BTN.HEIGHT
    const margin = UI_DIMENSIONS.FLOAT_BTN.MARGIN

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
    this._bus.emit('editor.sendToTerminal', lineRef)
  }

  _openExternal() {
    const filePath = this._activeFilePath
    if (!filePath) return
    this._api.openExternal(filePath)
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
    const result = await this._api.fsReadFile(resolved)
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

  // — File sync —

  async _checkAndSyncTab(filePath) {
    const tab = this._tabs.get(filePath)
    if (!tab) return

    const stat = await this._api.fsStatFile(filePath)
    if (!stat.success) return

    const isOutdated = stat.mtimeMs > (tab.originalMtime || 0)
    if (!isOutdated) {
      this._updateSyncButton(false)
      return
    }

    if (!tab.modified) {
      // Clean tab — auto-reload
      const read = await this._api.fsReadFile(filePath)
      if (read.success) {
        this._reloadTabContent(filePath, read.content, stat.mtimeMs)
      }
      this._updateSyncButton(false)
      return
    }

    // Dirty tab — only highlight sync button
    this._updateSyncButton(true)
  }

  _reloadTabContent(filePath, newContent, newMtime) {
    const tab = this._tabs.get(filePath)
    if (!tab) return

    // Update metadata BEFORE dispatch so _onDocChanged sees correct originalContent
    tab.originalContent = newContent
    tab.originalMtime = newMtime

    const view = tab.view
    const tr = view.state.update({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: newContent
      }
    })
    view.dispatch(tr)
  }

  _updateSyncButton(isOutdated) {
    if (!this._btnSync) return
    this._btnSync.classList.toggle('sync-outdated', !!isOutdated)
  }

  async _onSyncButtonClick() {
    const filePath = this._activeFilePath
    if (!filePath) return
    const tab = this._tabs.get(filePath)
    if (!tab) return

    const stat = await this._api.fsStatFile(filePath)
    if (!stat.success) return

    const isOutdated = stat.mtimeMs > (tab.originalMtime || 0)
    if (!isOutdated) {
      this._updateSyncButton(false)
      return
    }

    if (!tab.modified) {
      const read = await this._api.fsReadFile(filePath)
      if (read.success) {
        this._reloadTabContent(filePath, read.content, stat.mtimeMs)
      }
      this._updateSyncButton(false)
      return
    }

    this._showConflictDialog(filePath, stat.mtimeMs)
  }

  _showConflictDialog(filePath, newMtime) {
    this._closeConflictOverlay()

    const fileName = filePath.split('/').pop()

    const overlay = document.createElement('div')
    overlay.className = 'conflict-dialog-overlay'

    const dialog = document.createElement('div')
    dialog.className = 'conflict-dialog'

    const header = document.createElement('div')
    header.className = 'conflict-dialog-header'
    header.textContent = `Файл изменён на диске: ${fileName}`

    const body = document.createElement('div')
    body.className = 'conflict-dialog-body'
    body.textContent = 'Файл был изменён внешним процессом, а в редакторе есть несохранённые изменения. Выберите действие:'

    const actions = document.createElement('div')
    actions.className = 'conflict-dialog-actions'

    const btnKeep = document.createElement('button')
    btnKeep.className = 'conflict-dialog-btn'
    btnKeep.textContent = 'Оставить мои изменения'

    const btnReload = document.createElement('button')
    btnReload.className = 'conflict-dialog-btn danger'
    btnReload.textContent = 'Загрузить с диска'

    const btnDiff = document.createElement('button')
    btnDiff.className = 'conflict-dialog-btn primary'
    btnDiff.textContent = 'Показать diff'

    const close = () => {
      this._closeConflictOverlay()
    }

    btnKeep.addEventListener('click', close)

    btnReload.addEventListener('click', async () => {
      const read = await this._api.fsReadFile(filePath)
      if (read.success) {
        this._reloadTabContent(filePath, read.content, newMtime)
      }
      close()
    })

    btnDiff.addEventListener('click', () => {
      this._showConflictDiff(filePath, newMtime, overlay, dialog)
    })

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })

    actions.append(btnKeep, btnReload, btnDiff)
    dialog.append(header, body, actions)
    overlay.appendChild(dialog)
    document.body.appendChild(overlay)
    overlay._diffEditors = []
    this._conflictOverlay = overlay
    btnKeep.focus()
  }

  async _showConflictDiff(filePath, newMtime, overlay, dialog) {
    const tab = this._tabs.get(filePath)
    if (!tab) return

    const read = await this._api.fsReadFile(filePath)
    if (!read.success) return

    const langExts = await getLanguageExtension(filePath)

    // Clear existing dialog content and switch to full-height diff mode
    dialog.innerHTML = ''
    dialog.classList.add('diff-mode')

    const header = document.createElement('div')
    header.className = 'conflict-dialog-header'
    header.textContent = 'Сравнение версий'

    const diffContainer = document.createElement('div')
    diffContainer.className = 'conflict-diff-container'

    const pair = document.createElement('div')
    pair.className = 'conflict-diff-pair'

    const readOnlyExt = EditorView.editable.of(false)
    const themeExt = this._themeCompartment.of(this._currentThemeExts)

    // Current editor version (CodeMirror read-only)
    const currentPanel = document.createElement('div')
    currentPanel.className = 'conflict-diff-panel'
    const currentLabel = document.createElement('div')
    currentLabel.className = 'conflict-diff-label'
    currentLabel.textContent = 'Текущая версия (редактор)'
    const currentEditor = new EditorView({
      state: EditorState.create({
        doc: tab.view.state.doc.toString(),
        extensions: [
          themeExt,
          readOnlyExt,
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          bracketMatching(),
          foldGutter(),
          ...langExts
        ]
      })
    })
    currentPanel.append(currentLabel, currentEditor.dom)

    // Disk version (CodeMirror read-only)
    const diskPanel = document.createElement('div')
    diskPanel.className = 'conflict-diff-panel'
    const diskLabel = document.createElement('div')
    diskLabel.className = 'conflict-diff-label'
    diskLabel.textContent = 'Версия на диске'
    const diskEditor = new EditorView({
      state: EditorState.create({
        doc: read.content,
        extensions: [
          themeExt,
          readOnlyExt,
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          bracketMatching(),
          foldGutter(),
          ...langExts
        ]
      })
    })
    diskPanel.append(diskLabel, diskEditor.dom)

    pair.append(currentPanel, diskPanel)
    diffContainer.appendChild(pair)

    // Synchronize scroll between the two diff panels (percentage-based)
    this._syncDiffScroll(currentEditor, diskEditor)

    overlay._diffEditors.push(currentEditor, diskEditor)

    const actions = document.createElement('div')
    actions.className = 'conflict-dialog-actions'

    const btnKeep = document.createElement('button')
    btnKeep.className = 'conflict-dialog-btn'
    btnKeep.textContent = 'Оставить мои изменения'

    const btnReload = document.createElement('button')
    btnReload.className = 'conflict-dialog-btn danger'
    btnReload.textContent = 'Загрузить с диска'

    const close = () => {
      currentEditor.destroy()
      diskEditor.destroy()
      overlay._diffEditors = []
      this._closeConflictOverlay()
    }

    btnKeep.addEventListener('click', close)
    btnReload.addEventListener('click', () => {
      this._reloadTabContent(filePath, read.content, newMtime)
      close()
    })

    actions.append(btnKeep, btnReload)
    dialog.append(header, diffContainer, actions)
  }

  _showSaveConflictDialog(filePath, diskMtime, pendingContent) {
    this._closeConflictOverlay()

    const fileName = filePath.split('/').pop()

    const overlay = document.createElement('div')
    overlay.className = 'conflict-dialog-overlay'

    const dialog = document.createElement('div')
    dialog.className = 'conflict-dialog'

    const header = document.createElement('div')
    header.className = 'conflict-dialog-header'
    header.textContent = `Файл изменён на диске: ${fileName}`

    const body = document.createElement('div')
    body.className = 'conflict-dialog-body'
    body.textContent = 'Файл был изменён внешним процессом после последнего открытия. Сохранить ваши изменения поверх внешних?'

    const actions = document.createElement('div')
    actions.className = 'conflict-dialog-actions'

    const btnOverwrite = document.createElement('button')
    btnOverwrite.className = 'conflict-dialog-btn danger'
    btnOverwrite.textContent = 'Перезаписать'

    const btnCancel = document.createElement('button')
    btnCancel.className = 'conflict-dialog-btn'
    btnCancel.textContent = 'Отменить'

    const btnDiff = document.createElement('button')
    btnDiff.className = 'conflict-dialog-btn primary'
    btnDiff.textContent = 'Показать diff'

    const close = () => {
      this._closeConflictOverlay()
    }

    btnCancel.addEventListener('click', close)

    btnOverwrite.addEventListener('click', async () => {
      await this._doSaveFile(filePath, pendingContent)
      close()
    })

    btnDiff.addEventListener('click', () => {
      this._showSaveConflictDiff(filePath, diskMtime, pendingContent, overlay, dialog)
    })

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })

    actions.append(btnCancel, btnOverwrite, btnDiff)
    dialog.append(header, body, actions)
    overlay.appendChild(dialog)
    document.body.appendChild(overlay)
    overlay._diffEditors = []
    this._conflictOverlay = overlay
    btnCancel.focus()
  }

  async _showSaveConflictDiff(filePath, diskMtime, pendingContent, overlay, dialog) {
    const read = await this._api.fsReadFile(filePath)
    if (!read.success) return

    const langExts = await getLanguageExtension(filePath)

    dialog.innerHTML = ''
    dialog.classList.add('diff-mode')

    const header = document.createElement('div')
    header.className = 'conflict-dialog-header'
    header.textContent = 'Сравнение: ваши изменения vs версия на диске'

    const diffContainer = document.createElement('div')
    diffContainer.className = 'conflict-diff-container'

    const pair = document.createElement('div')
    pair.className = 'conflict-diff-pair'

    const readOnlyExt = EditorView.editable.of(false)
    const themeExt = this._themeCompartment.of(this._currentThemeExts)

    const currentPanel = document.createElement('div')
    currentPanel.className = 'conflict-diff-panel'
    const currentLabel = document.createElement('div')
    currentLabel.className = 'conflict-diff-label'
    currentLabel.textContent = 'Ваши изменения (редактор)'
    const currentEditor = new EditorView({
      state: EditorState.create({
        doc: pendingContent,
        extensions: [
          themeExt, readOnlyExt,
          lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(),
          drawSelection(), bracketMatching(), foldGutter(),
          ...langExts
        ]
      })
    })
    currentPanel.append(currentLabel, currentEditor.dom)

    const diskPanel = document.createElement('div')
    diskPanel.className = 'conflict-diff-panel'
    const diskLabel = document.createElement('div')
    diskLabel.className = 'conflict-diff-label'
    diskLabel.textContent = 'Версия на диске'
    const diskEditor = new EditorView({
      state: EditorState.create({
        doc: read.content,
        extensions: [
          themeExt, readOnlyExt,
          lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(),
          drawSelection(), bracketMatching(), foldGutter(),
          ...langExts
        ]
      })
    })
    diskPanel.append(diskLabel, diskEditor.dom)

    pair.append(currentPanel, diskPanel)
    diffContainer.appendChild(pair)

    this._syncDiffScroll(currentEditor, diskEditor)
    overlay._diffEditors.push(currentEditor, diskEditor)

    const actions = document.createElement('div')
    actions.className = 'conflict-dialog-actions'

    const btnCancel = document.createElement('button')
    btnCancel.className = 'conflict-dialog-btn'
    btnCancel.textContent = 'Отменить'

    const btnOverwrite = document.createElement('button')
    btnOverwrite.className = 'conflict-dialog-btn danger'
    btnOverwrite.textContent = 'Перезаписать'

    const close = () => {
      currentEditor.destroy()
      diskEditor.destroy()
      overlay._diffEditors = []
      this._closeConflictOverlay()
    }

    btnCancel.addEventListener('click', close)
    btnOverwrite.addEventListener('click', async () => {
      await this._doSaveFile(filePath, pendingContent)
      close()
    })

    actions.append(btnCancel, btnOverwrite)
    dialog.append(header, diffContainer, actions)
  }

  _syncDiffScroll(editorA, editorB) {
    const scrollerA = editorA.scrollDOM
    const scrollerB = editorB.scrollDOM
    if (!scrollerA || !scrollerB) return

    let lastSetA = -1
    let lastSetB = -1
    let rafId = null

    const doSync = () => {
      rafId = null

      const posA = scrollerA.scrollTop
      const posB = scrollerB.scrollTop

      const maxA = scrollerA.scrollHeight - scrollerA.clientHeight
      const maxB = scrollerB.scrollHeight - scrollerB.clientHeight
      if (maxA <= 0 || maxB <= 0) return

      const userScrolledA = posA !== lastSetA
      const userScrolledB = posB !== lastSetB

      if (!userScrolledA && !userScrolledB) return

      const ratioA = posA / maxA
      const ratioB = posB / maxB

      if (userScrolledA) {
        const target = Math.round(ratioA * maxB)
        scrollerB.scrollTop = Math.max(0, Math.min(target, maxB))
        lastSetB = scrollerB.scrollTop
      } else {
        const target = Math.round(ratioB * maxA)
        scrollerA.scrollTop = Math.max(0, Math.min(target, maxA))
        lastSetA = scrollerA.scrollTop
      }

      lastSetA = scrollerA.scrollTop
      lastSetB = scrollerB.scrollTop
    }

    const onScroll = () => {
      if (rafId === null) {
        rafId = requestAnimationFrame(doSync)
      }
    }

    scrollerA.addEventListener('scroll', onScroll, { passive: true })
    scrollerB.addEventListener('scroll', onScroll, { passive: true })

    if (this._conflictOverlay) {
      if (!this._conflictOverlay._diffScrollCleanups) {
        this._conflictOverlay._diffScrollCleanups = []
      }
      this._conflictOverlay._diffScrollCleanups.push(
        () => {
          scrollerA.removeEventListener('scroll', onScroll)
          scrollerB.removeEventListener('scroll', onScroll)
          if (rafId !== null) cancelAnimationFrame(rafId)
        }
      )
    }
  }

  _closeConflictOverlay() {
    if (this._conflictOverlay) {
      if (this._conflictOverlay._diffScrollCleanups) {
        this._conflictOverlay._diffScrollCleanups.forEach((fn) => fn())
      }
      if (this._conflictOverlay._diffEditors) {
        this._conflictOverlay._diffEditors.forEach((ed) => ed.destroy())
      }
      this._conflictOverlay.remove()
      this._conflictOverlay = null
    }
    if (this._activeFilePath) {
      const tab = this._tabs.get(this._activeFilePath)
      if (tab) tab.view.focus()
    }
  }

  // — Diff gutter —

  _setupGitStatusSubscription() {
    if (!this._bus) return

    this._diffUnsubscribe = this._bus.on('git.status-updated', ({ rootPath, fileStatuses }) => {
      const filePath = this._activeFilePath
      if (!filePath) return

      let relPath = filePath
      if (rootPath && filePath.startsWith(rootPath)) {
        relPath = filePath.slice(rootPath.length)
        if (relPath.startsWith('/')) relPath = relPath.slice(1)
      }

      if (fileStatuses[relPath]) {
        this._fetchAndApplyDiff(filePath)
      } else {
        this._clearDiffGutter()
      }
    })
  }

  _setupFileTreeSubscription() {
    if (!this._bus) return

    this._rootChangeUnsub = this._bus.on('filetree.rootChanged', () => {
      this._closeAllTabs()
    })
  }

  async _fetchAndApplyDiff(filePath) {
    if (!filePath) return
    const rootPath = this._store?.get('git.rootPath')
    if (!rootPath) return

    const tab = this._tabs.get(filePath)
    if (!tab?.view) return

    let relPath = filePath
    if (filePath.startsWith(rootPath)) {
      relPath = filePath.slice(rootPath.length)
      if (relPath.startsWith('/')) relPath = relPath.slice(1)
    }

    const diffStr = await this._api.gitGetDiff(rootPath, relPath, { compareTo: 'head' })

    // Проверить, что файл всё ещё актуален после async операции
    if (this._activeFilePath !== filePath || !this._tabs.has(filePath)) return

    if (!diffStr || typeof diffStr !== 'string') {
      this._clearDiffGutter()
      return
    }

    const diffData = this._parseDiffForGutter(diffStr)

    const freshTab = this._tabs.get(filePath)
    if (!freshTab?.view) return
    freshTab.view.dispatch({
      effects: setDiffData.of(diffData)
    })
  }

  _parseDiffForGutter(diffStr) {
    const lines = diffStr.split('\n')
    const result = []
    let newLineNum = 0
    const hunkLines = []

    const flushHunk = () => {
      let i = 0
      while (i < hunkLines.length) {
        const line = hunkLines[i]
        if (line.type === 'add') {
          const hasNeighborDel = hunkLines.slice(Math.max(0, i - 2), i + 3).some(l => l.type === 'del')
          result.push({ line: line.lineNum, type: hasNeighborDel ? 'modified' : 'added' })
        } else if (line.type === 'del') {
          // Mark once per contiguous deletion run, anchored on the surviving
          // line right after it. Skip when an adjacent 'add' already covers
          // the spot with a 'modified' marker (replace, not pure deletion).
          const isRunStart = i === 0 || hunkLines[i - 1].type !== 'del'
          const hasNeighborAdd = hunkLines.slice(Math.max(0, i - 2), i + 3).some(l => l.type === 'add')
          if (isRunStart && !hasNeighborAdd) {
            result.push({ line: line.lineNum, type: 'deleted' })
          }
        }
        i++
      }
      hunkLines.length = 0
    }

    for (const line of lines) {
      if (line.startsWith('@@')) {
        flushHunk()
        const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
        if (match) {
          newLineNum = parseInt(match[1], 10)
        }
        continue
      }
      if (line.startsWith('+++') || line.startsWith('---')) continue
      if (line.startsWith('+')) {
        hunkLines.push({ type: 'add', lineNum: newLineNum })
        newLineNum++
      } else if (line.startsWith('-')) {
        hunkLines.push({ type: 'del', lineNum: newLineNum })
      } else {
        hunkLines.push({ type: 'ctx', lineNum: newLineNum })
        newLineNum++
      }
    }
    flushHunk()

    return result
  }

  _clearDiffGutter() {
    const filePath = this._activeFilePath
    if (!filePath) return
    const tab = this._tabs.get(filePath)
    if (!tab?.view) return
    tab.view.dispatch({ effects: setDiffData.of([]) })
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

  _handleReorder(fromIndex, toIndex) {
    const keys = [...this._tabs.keys()]
    const fromPath = keys[fromIndex]

    keys.splice(fromIndex, 1)
    keys.splice(toIndex, 0, fromPath)

    // Rebuild Map in new order
    const newMap = new Map()
    for (const key of keys) {
      newMap.set(key, this._tabs.get(key))
    }
    this._tabs = newMap
  }

  destroy() {
    if (this._diffUnsubscribe) {
      this._diffUnsubscribe()
      this._diffUnsubscribe = null
    }
    if (this._rootChangeUnsub) {
      this._rootChangeUnsub()
      this._rootChangeUnsub = null
    }

    for (const [, tab] of this._tabs) {
      tab.view.destroy()
      tab.element.remove()
    }
    this._tabs.clear()
    this._activeFilePath = null

    this._draggable.destroy()
    this._contextMenu.destroy()
    this._cleanupController?.abort()
    this._cleanupController = null

    if (this._conflictOverlay) {
      this._conflictOverlay.remove()
      this._conflictOverlay = null
    }

    this._panelEl = null
    this._resizeHandleEl = null
    this._tabBarEl = null
    this._bodyEl = null
    this._btnOpenExternal = null
    this._btnClose = null
    this._btnSendFloat = null
    this._btnSync = null
    this._statusFile = null
    this._statusPos = null
    this._statusModified = null
    this._btnWordWrap = null
    this._bus = null
    this._api = null
    this._getActiveCwd = null
    this._store = null
  }

  _setupListeners() {
    const signal = this._cleanupController.signal
    this._btnWordWrap = this._panelEl.querySelector('#btn-word-wrap')
    this._btnWordWrap.addEventListener('click', () => {
      const on = this.toggleWordWrap()
      this._btnWordWrap.classList.toggle('active', on)
    }, { signal })
    this._btnOpenExternal.addEventListener('click', () => this._openExternal(), { signal })
    this._btnClose.addEventListener('click', () => this.hide(), { signal })
    this._btnSendFloat.addEventListener('click', () => this._sendLinesToTerminal(), { signal })
    this._btnSync.addEventListener('click', () => this._onSyncButtonClick(), { signal })
  }
}
