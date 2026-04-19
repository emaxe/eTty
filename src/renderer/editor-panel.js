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

export class EditorPanel {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.panelEl       — #editor-panel
   * @param {HTMLElement} opts.resizeHandleEl — #resize-handle-right
   * @param {Function}   opts.onResize       — called when panel shows/hides
   * @param {Function}   opts.writeToPty     — (data: string) => void
   * @param {Function}   opts.getActiveCwd   — () => string, active terminal cwd
   */
  constructor({ panelEl, resizeHandleEl, onResize, writeToPty, getActiveCwd }) {
    this._panelEl = panelEl
    this._resizeHandleEl = resizeHandleEl
    this._onResize = onResize
    this._writeToPty = writeToPty
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

    // Compartments for hot-swap
    this._themeCompartment = new Compartment()
    this._currentThemeExts = [_fallbackHighlight]

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
  }

  hide() {
    if (!this.isVisible()) return
    this._panelEl.classList.add('hidden')
    this._resizeHandleEl.classList.add('hidden')
    this._onResize?.()
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

  // ── Private ──────────────────────────────────────────────────────────────

  _createEditorView(filePath, content, langExts) {
    const self = this

    const state = EditorState.create({
      doc: content,
      extensions: [
        // Theme (hot-swappable)
        this._themeCompartment.of(this._currentThemeExts),

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

    return tab
  }

  _switchToTab(filePath) {
    const tab = this._tabs.get(filePath)
    if (!tab) return

    this._hideFloatBtn()

    // Deactivate current
    if (this._activeFilePath && this._activeFilePath !== filePath) {
      const prev = this._tabs.get(this._activeFilePath)
      if (prev) {
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

    // Inject into terminal: clear current input line first (Ctrl+U), then insert ref
    this._writeToPty?.('\x15' + lineRef)
  }

  _openExternal() {
    const filePath = this._activeFilePath
    if (!filePath) return
    // Use shell 'open' command — works on macOS, Linux uses 'xdg-open'
    const escaped = filePath.replace(/'/g, "'\\''")
    this._writeToPty?.(`open '${escaped}'\r`)
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

  _setupListeners() {
    this._btnOpenExternal.addEventListener('click', () => this._openExternal())
    this._btnClose.addEventListener('click', () => this.hide())
    this._btnSendFloat.addEventListener('click', () => this._sendLinesToTerminal())
  }
}
