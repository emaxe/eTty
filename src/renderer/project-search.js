import { APP_CONFIG } from './core/config/app-config.js'
import { Icons } from './icons.js'

/**
 * Project Search dialog component.
 * Modal overlay for searching files by name and content within project root.
 *
 * Architecture: DI via constructor, EventBus for outgoing events, internal state.
 * Pattern: follows SettingsPage overlay (show/hide/_buildDOM/.hidden).
 */
export class ProjectSearchDialog {
  /**
   * @param {Object} deps
   * @param {import('./core/event-bus').EventBus} deps.eventBus
   * @param {import('./core/adapters/electron-api').ElectronApiAdapter} deps.api
   * @param {import('./core/state-store').StateStore} deps.store
   * @param {Function} deps.getActiveCwd — returns current tab root path
   * @param {Function} [deps.onClose]
   */
  constructor({ eventBus, api, store, getActiveCwd, onClose }) {
    this._bus = eventBus
    this._api = api
    this._store = store
    this._getActiveCwd = getActiveCwd
    this._onClose = onClose

    this._overlay = null
    this._input = null
    this._resultsList = null
    this._previewPane = null
    this._previewEmpty = null
    this._previewContent = null
    this._caseCheckbox = null
    this._wordCheckbox = null
    this._regexCheckbox = null
    this._includeInput = null
    this._excludeInput = null
    this._spinner = null
    this._queryId = 0
    this._selectedIndex = -1
    this._results = []
    this._searchTimer = null
    this._boundKeyDown = this._onKeyDown.bind(this)
    this._isVisible = false

    this._buildDOM()
  }

  _buildDOM() {
    const overlay = document.createElement('div')
    overlay.className = 'search-dialog-overlay hidden'
    overlay.innerHTML = `
      <div class="search-dialog">
        <div class="search-header">
          <div class="search-input-row">
            ${Icons.search}
            <input type="text" class="search-input" placeholder="Поиск по проекту..." spellcheck="false" autocomplete="off">
            <button class="search-close-btn" title="Закрыть">${Icons.close}</button>
          </div>
          <div class="search-options">
            <label class="search-option" title="Учитывать регистр">
              <input type="checkbox" class="search-case"> Aa
            </label>
            <label class="search-option" title="Слово целиком">
              <input type="checkbox" class="search-word"> \\b
            </label>
            <label class="search-option" title="Регулярное выражение">
              <input type="checkbox" class="search-regex"> .*
            </label>
            <div class="search-patterns-row">
              <input type="text" class="search-patterns-input" placeholder="Включить: *.js,*.ts" spellcheck="false">
              <input type="text" class="search-exclude-input" placeholder="Исключить: node_modules,.git" spellcheck="false">
            </div>
          </div>
          <div class="search-status hidden">
            <span class="search-spinner"></span>
            <span class="search-status-text">Поиск...</span>
          </div>
        </div>
        <div class="search-body">
          <div class="search-results-pane">
            <div class="search-results-placeholder">Введите запрос для поиска</div>
            <div class="search-results-list"></div>
          </div>
          <div class="search-preview-pane">
            <div class="search-preview-empty">Выберите файл для просмотра</div>
            <pre class="search-preview-content"></pre>
          </div>
        </div>
      </div>
    `
    document.body.appendChild(overlay)

    this._overlay = overlay
    this._input = overlay.querySelector('.search-input')
    this._resultsList = overlay.querySelector('.search-results-list')
    this._resultsPlaceholder = overlay.querySelector('.search-results-placeholder')
    this._previewPane = overlay.querySelector('.search-preview-pane')
    this._previewEmpty = overlay.querySelector('.search-preview-empty')
    this._previewContent = overlay.querySelector('.search-preview-content')
    this._caseCheckbox = overlay.querySelector('.search-case')
    this._wordCheckbox = overlay.querySelector('.search-word')
    this._regexCheckbox = overlay.querySelector('.search-regex')
    this._includeInput = overlay.querySelector('.search-patterns-input')
    this._excludeInput = overlay.querySelector('.search-exclude-input')
    this._statusRow = overlay.querySelector('.search-status')
    this._spinner = overlay.querySelector('.search-spinner')
    this._statusText = overlay.querySelector('.search-status-text')

    const closeBtn = overlay.querySelector('.search-close-btn')
    closeBtn.addEventListener('click', () => this.hide())

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.hide()
    })

    this._input.addEventListener('input', () => this._scheduleSearch())

    // Options change triggers immediate search if query exists
    ;[this._caseCheckbox, this._wordCheckbox, this._regexCheckbox].forEach(el => {
      el.addEventListener('change', () => { if (this._input.value.trim()) this._scheduleSearch(0) })
    })
    ;[this._includeInput, this._excludeInput].forEach(el => {
      el.addEventListener('input', () => { if (this._input.value.trim()) this._scheduleSearch(APP_CONFIG.SEARCH_DEBOUNCE_MS * 2) })
    })
  }

  show() {
    if (this._isVisible) return
    this._isVisible = true
    this._overlay.classList.remove('hidden')
    this._input.value = ''
    this._clearResults()
    this._input.focus()
    document.addEventListener('keydown', this._boundKeyDown)
  }

  hide() {
    if (!this._isVisible) return
    this._isVisible = false
    this._overlay.classList.add('hidden')
    document.removeEventListener('keydown', this._boundKeyDown)
    this._onClose?.()
  }

  isVisible() {
    return this._isVisible
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      this.hide()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      this._selectNext()
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      this._selectPrev()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (this._selectedIndex >= 0 && this._results[this._selectedIndex]) {
        this._openFile(this._results[this._selectedIndex].path)
      }
      return
    }
  }

  _scheduleSearch(delay = APP_CONFIG.SEARCH_DEBOUNCE_MS) {
    clearTimeout(this._searchTimer)
    const query = this._input.value.trim()
    if (!query) {
      this._clearResults()
      return
    }
    this._showSpinner(true)
    this._searchTimer = setTimeout(() => this._doSearch(query), delay)
  }

  async _doSearch(query) {
    const qid = ++this._queryId
    const dirPath = this._getActiveCwd()
    const options = {
      caseSensitive: this._caseCheckbox.checked,
      wholeWord: this._wordCheckbox.checked,
      regex: this._regexCheckbox.checked,
      includePatterns: this._includeInput.value,
      excludePatterns: this._excludeInput.value || 'node_modules,.git,dist,out,build'
    }

    try {
      const response = await this._api.searchQuery(dirPath, query, options)
      // Ignore stale responses
      if (qid !== this._queryId) return

      if (response.success) {
        this._renderResults(response.results, query)
      } else {
        this._renderError(response.error)
      }
    } catch (e) {
      if (qid !== this._queryId) return
      this._renderError(e.message)
    } finally {
      if (qid === this._queryId) this._showSpinner(false)
    }
  }

  _renderResults(results, query) {
    const all = [
      ...(results.nameMatches || []).map(r => ({ ...r, kind: 'name' })),
      ...(results.contentMatches || []).map(r => ({ ...r, kind: 'content' }))
    ]
    this._results = all
    this._selectedIndex = all.length > 0 ? 0 : -1

    if (all.length === 0) {
      this._resultsPlaceholder.classList.remove('hidden')
      this._resultsPlaceholder.textContent = 'Ничего не найдено'
      this._resultsList.innerHTML = ''
      this._clearPreview()
      return
    }

    this._resultsPlaceholder.classList.add('hidden')
    this._resultsList.innerHTML = ''

    all.forEach((item, index) => {
      const el = document.createElement('div')
      el.className = 'search-result-item' + (index === 0 ? ' selected' : '')
      el.dataset.index = index
      el.dataset.path = item.path

      const icon = item.kind === 'name' ? Icons.file : Icons.file
      const meta = item.kind === 'name'
        ? '<span class="search-result-meta">имя файла</span>'
        : `<span class="search-result-meta">${item.lines?.length || 0} совпадений</span>`

      el.innerHTML = `
        <div class="search-result-main">
          <span class="search-result-icon">${icon}</span>
          <span class="search-result-name">${this._escapeHtml(item.name)}</span>
          ${meta}
        </div>
        <div class="search-result-path">${this._escapeHtml(item.relPath)}</div>
      `

      el.addEventListener('click', () => this._selectItem(index))
      el.addEventListener('dblclick', () => {
        this._openFile(item.path)
      })

      this._resultsList.appendChild(el)
    })

    if (all.length > 0) {
      this._loadPreview(all[0])
    }
  }

  _renderError(message) {
    this._resultsPlaceholder.classList.remove('hidden')
    this._resultsPlaceholder.textContent = 'Ошибка: ' + message
    this._resultsList.innerHTML = ''
    this._clearPreview()
  }

  _clearResults() {
    this._results = []
    this._selectedIndex = -1
    this._resultsPlaceholder.classList.remove('hidden')
    this._resultsPlaceholder.textContent = 'Введите запрос для поиска'
    this._resultsList.innerHTML = ''
    this._clearPreview()
    this._showSpinner(false)
  }

  _selectItem(index) {
    if (index < 0 || index >= this._results.length) return
    const prev = this._resultsList.querySelector('.search-result-item.selected')
    if (prev) prev.classList.remove('selected')

    this._selectedIndex = index
    const next = this._resultsList.querySelector(`[data-index="${index}"]`)
    if (next) {
      next.classList.add('selected')
      next.scrollIntoView({ block: 'nearest' })
    }

    this._loadPreview(this._results[index])
  }

  _selectNext() {
    if (this._results.length === 0) return
    const next = (this._selectedIndex + 1) % this._results.length
    this._selectItem(next)
  }

  _selectPrev() {
    if (this._results.length === 0) return
    const prev = (this._selectedIndex - 1 + this._results.length) % this._results.length
    this._selectItem(prev)
  }

  async _loadPreview(item) {
    this._previewEmpty.classList.add('hidden')
    this._previewContent.classList.remove('hidden')
    this._previewContent.textContent = 'Загрузка...'

    try {
      const result = await this._api.fsReadFile(item.path)
      if (!result.success) {
        this._previewContent.textContent = 'Не удалось прочитать файл: ' + (result.error || 'unknown')
        return
      }

      const lines = result.content.split('\n')
      // For content matches, highlight matching lines and some context
      if (item.kind === 'content' && item.lines && item.lines.length > 0) {
        const matchLineNums = new Set(item.lines.map(l => l.line))
        const displayLines = []
        const context = 2 // lines before/after
        const included = new Set()

        for (const ml of item.lines) {
          const start = Math.max(0, ml.line - 1 - context)
          const end = Math.min(lines.length, ml.line + context)
          for (let i = start; i < end; i++) {
            if (!included.has(i)) {
              included.add(i)
              const isMatch = matchLineNums.has(i + 1)
              const num = String(i + 1).padStart(4, ' ')
              const escaped = this._escapeHtml(lines[i] || '')
              displayLines.push({ num, text: escaped, isMatch })
            }
          }
        }

        // Sort by line number
        displayLines.sort((a, b) => {
          const na = parseInt(a.num, 10)
          const nb = parseInt(b.num, 10)
          return na - nb
        })

        const html = displayLines.map(l => {
          const cls = l.isMatch ? 'search-preview-line search-preview-match' : 'search-preview-line'
          return `<div class="${cls}"><span class="search-preview-lineno">${l.num}</span><span class="search-preview-text">${l.text}</span></div>`
        }).join('')

        this._previewContent.innerHTML = html
      } else {
        // For name matches, show first ~50 lines
        const limit = Math.min(lines.length, 50)
        const html = []
        for (let i = 0; i < limit; i++) {
          const num = String(i + 1).padStart(4, ' ')
          const escaped = this._escapeHtml(lines[i] || '')
          html.push(`<div class="search-preview-line"><span class="search-preview-lineno">${num}</span><span class="search-preview-text">${escaped}</span></div>`)
        }
        if (lines.length > limit) {
          html.push(`<div class="search-preview-line search-preview-ellipsis"><span class="search-preview-lineno">    </span><span class="search-preview-text">... (${lines.length - limit} строк скрыто)</span></div>`)
        }
        this._previewContent.innerHTML = html.join('')
      }
    } catch (e) {
      this._previewContent.textContent = 'Ошибка загрузки: ' + e.message
    }
  }

  _clearPreview() {
    this._previewEmpty.classList.remove('hidden')
    this._previewContent.classList.add('hidden')
    this._previewContent.innerHTML = ''
  }

  _openFile(filePath) {
    this._bus.emit('filetree.openFile', filePath)
    this.hide()
  }

  _showSpinner(show) {
    this._statusRow.classList.toggle('hidden', !show)
    this._spinner.classList.toggle('spinning', show)
  }

  _escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  destroy() {
    clearTimeout(this._searchTimer)
    document.removeEventListener('keydown', this._boundKeyDown)
    if (this._overlay) {
      this._overlay.remove()
      this._overlay = null
    }
    this._bus = null
    this._api = null
    this._store = null
    this._getActiveCwd = null
    this._onClose = null
  }
}
