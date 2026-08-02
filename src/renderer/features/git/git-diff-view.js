/**
 * Right-hand pane of the Git panel: unified diff for the selected file —
 * line numbers, syntax highlighting, per-word change emphasis, and the
 * file-level action bar (Open / Stage / Unstage / Discard).
 */
import { Icons } from '../../icons.js'
import { Button } from '../../components/base/button/button.js'
import { APP_CONFIG } from '../../core/config/app-config.js'
import { parseUnifiedDiff, computeWordDiff } from './diff-parser.js'
import { tokenizeLines } from './diff-highlighter.js'
import { statusMeta } from './git-status.js'

/** Splits token spans at the given [start,end) "changed" ranges (character offsets). */
function splitSpansByRanges(tokenSpans, changedRanges) {
  if (!changedRanges.length) return tokenSpans.map(s => ({ ...s, changed: false }))
  const out = []
  let pos = 0
  for (const span of tokenSpans) {
    const spanStart = pos
    const spanEnd = pos + span.text.length
    let cursor = spanStart
    for (const [rs, re] of changedRanges) {
      const s = Math.max(rs, cursor)
      const e = Math.min(re, spanEnd)
      if (s < e) {
        if (s > cursor) out.push({ text: span.text.slice(cursor - spanStart, s - spanStart), cls: span.cls, changed: false })
        out.push({ text: span.text.slice(s - spanStart, e - spanStart), cls: span.cls, changed: true })
        cursor = e
      }
    }
    if (cursor < spanEnd) out.push({ text: span.text.slice(cursor - spanStart, spanEnd - spanStart), cls: span.cls, changed: false })
    pos = spanEnd
  }
  return out
}

/** Converts computeWordDiff() segments into [start,end) character ranges. */
function segmentsToRanges(segments) {
  const ranges = []
  let pos = 0
  for (const seg of segments) {
    if (seg.changed) ranges.push([pos, pos + seg.text.length])
    pos += seg.text.length
  }
  return ranges
}

export class GitDiffView {
  /**
   * @param {Object} deps
   * @param {HTMLElement} deps.containerEl
   * @param {(file: object) => void} deps.onOpenFile
   * @param {(file: object) => void} deps.onStage
   * @param {(file: object) => void} deps.onUnstage
   * @param {(file: object) => void} deps.onDiscard
   */
  constructor({ containerEl, onOpenFile, onStage, onUnstage, onDiscard }) {
    this._containerEl = containerEl
    this._onOpenFile = onOpenFile
    this._onStage = onStage
    this._onUnstage = onUnstage
    this._onDiscard = onDiscard

    this._requestId = 0
    this._currentFile = null
    this._buttons = []

    this._buildDOM()
  }

  _buildDOM() {
    this._containerEl.innerHTML = `
      <div class="git-detail-head hidden">
        <span class="git-status-badge"></span>
        <span class="git-detail-path"></span>
        <span class="git-detail-stats"></span>
        <div class="git-detail-actions"></div>
      </div>
      <div class="git-diff-view"></div>
    `
    this._headEl = this._containerEl.querySelector('.git-detail-head')
    this._badgeEl = this._containerEl.querySelector('.git-status-badge')
    this._pathEl = this._containerEl.querySelector('.git-detail-path')
    this._statsEl = this._containerEl.querySelector('.git-detail-stats')
    this._actionsEl = this._containerEl.querySelector('.git-detail-actions')
    this._bodyEl = this._containerEl.querySelector('.git-diff-view')
    this.clear()
  }

  getScrollTop() { return this._bodyEl ? this._bodyEl.scrollTop : 0 }
  setScrollTop(value) { if (this._bodyEl) this._bodyEl.scrollTop = value }
  getCurrentFile() { return this._currentFile }

  clear() {
    this._currentFile = null
    this._requestId++
    this._headEl.classList.add('hidden')
    this._destroyButtons()
    this._renderPlaceholder('Select a file to view its diff', Icons.file)
  }

  _renderPlaceholder(text, icon) {
    this._bodyEl.innerHTML = ''
    const wrap = document.createElement('div')
    wrap.className = 'git-diff-placeholder'
    if (icon) {
      const iconEl = document.createElement('span')
      iconEl.className = 'git-diff-placeholder-icon'
      iconEl.innerHTML = icon
      wrap.appendChild(iconEl)
    }
    const label = document.createElement('span')
    label.textContent = text
    wrap.appendChild(label)
    this._bodyEl.appendChild(wrap)
  }

  _destroyButtons() {
    this._buttons.forEach(b => b.destroy())
    this._buttons = []
    if (this._actionsEl) this._actionsEl.innerHTML = ''
  }

  _renderHead(file) {
    const meta = statusMeta(file.status)
    this._headEl.classList.remove('hidden')
    this._badgeEl.textContent = meta.letter
    this._badgeEl.className = `git-status-badge git-status-badge-${meta.cls}`
    this._badgeEl.title = meta.label
    this._pathEl.textContent = file.path
    this._pathEl.title = file.path
    this._statsEl.innerHTML = ''
    if (file.additions) {
      const add = document.createElement('span')
      add.className = 'git-additions'
      add.textContent = `+${file.additions}`
      this._statsEl.appendChild(add)
    }
    if (file.deletions) {
      const del = document.createElement('span')
      del.className = 'git-deletions'
      del.textContent = `−${file.deletions}`
      this._statsEl.appendChild(del)
    }

    this._destroyButtons()
    const openBtn = new Button({ variant: 'ghost', size: 'sm', icon: Icons.arrowRight, title: 'Open in editor', onClick: () => this._onOpenFile?.(file) })
    this._buttons.push(openBtn)
    this._actionsEl.appendChild(openBtn.element)

    if (!file.isIgnored) {
      if (file.staged) {
        const unstageBtn = new Button({ variant: 'ghost', size: 'sm', label: 'Unstage', onClick: () => this._onUnstage?.([file]) })
        this._buttons.push(unstageBtn)
        this._actionsEl.appendChild(unstageBtn.element)
      } else {
        const stageBtn = new Button({ variant: 'ghost', size: 'sm', label: 'Stage', onClick: () => this._onStage?.([file]) })
        this._buttons.push(stageBtn)
        this._actionsEl.appendChild(stageBtn.element)
      }

      const discardBtn = new Button({ variant: 'ghost', size: 'sm', icon: Icons.trash, title: 'Discard changes', onClick: () => this._onDiscard?.(file) })
      this._buttons.push(discardBtn)
      this._actionsEl.appendChild(discardBtn.element)
    }
  }

  /**
   * @param {object} file — {path, status, additions, deletions, staged, untracked, isIgnored}
   * @param {() => Promise<string>} fetchDiff
   * @param {{silent?: boolean, emptyMessage?: string}} [opts] — silent: keep
   *   showing the previous content while refreshing (used for background
   *   auto-refresh), instead of flashing a loading skeleton.
   */
  async show(file, fetchDiff, opts = {}) {
    const reqId = ++this._requestId
    this._currentFile = file
    this._renderHead(file)
    if (!opts.silent) {
      this._bodyEl.innerHTML = ''
      this._bodyEl.appendChild(this._buildSkeleton())
    }

    let diffStr = ''
    try {
      diffStr = await fetchDiff()
    } catch {
      diffStr = ''
    }
    if (reqId !== this._requestId) return

    const parsed = parseUnifiedDiff(diffStr)

    if (parsed.isBinary) {
      this._renderPlaceholder('Binary file — diff not shown', Icons.file)
      return
    }
    if (parsed.isEmpty) {
      this._renderPlaceholder(opts.emptyMessage || 'No changes to display', Icons.ok)
      return
    }

    const totalLines = parsed.hunks.reduce((n, h) => n + h.lines.length, 0)
    if (totalLines > APP_CONFIG.GIT_DIFF_MAX_RENDER_LINES) {
      this._bodyEl.innerHTML = ''
      const wrap = document.createElement('div')
      wrap.className = 'git-diff-placeholder'
      const label = document.createElement('span')
      label.textContent = `Diff is too large to render automatically (${totalLines} lines)`
      wrap.appendChild(label)
      const showBtn = new Button({ variant: 'default', size: 'sm', label: 'Show anyway', onClick: async () => {
        showBtn.destroy()
        this._bodyEl.innerHTML = ''
        await this._renderHunks(parsed, file, reqId)
      } })
      wrap.appendChild(showBtn.element)
      this._bodyEl.appendChild(wrap)
      return
    }

    await this._renderHunks(parsed, file, reqId)
  }

  _buildSkeleton() {
    const wrap = document.createElement('div')
    wrap.className = 'git-diff-skeleton'
    for (let i = 0; i < 8; i++) {
      const row = document.createElement('div')
      row.className = 'git-diff-skeleton-row'
      row.style.width = `${40 + Math.random() * 50}%`
      wrap.appendChild(row)
    }
    return wrap
  }

  async _renderHunks(parsed, file, reqId) {
    const frag = document.createDocumentFragment()

    for (const hunk of parsed.hunks) {
      if (hunk.header) frag.appendChild(this._buildHunkHeaderRow(hunk))

      const oldTexts = hunk.lines.filter(l => l.type === 'del' || l.type === 'ctx').map(l => l.text)
      const newTexts = hunk.lines.filter(l => l.type === 'add' || l.type === 'ctx').map(l => l.text)
      const [oldTokens, newTokens] = await Promise.all([
        tokenizeLines(oldTexts, file.path),
        tokenizeLines(newTexts, file.path),
      ])
      if (reqId !== this._requestId) return

      let oldIdx = 0
      let newIdx = 0
      const lines = hunk.lines
      let i = 0
      while (i < lines.length) {
        const line = lines[i]

        if (line.type === 'meta') {
          frag.appendChild(this._buildMetaRow(line))
          i++
          continue
        }

        if (line.type === 'ctx') {
          const spans = oldTokens[oldIdx++]
          newIdx++
          frag.appendChild(this._buildRow('ctx', line, spans))
          i++
          continue
        }

        if (line.type === 'del') {
          const delStart = i
          while (i < lines.length && lines[i].type === 'del') i++
          const delCount = i - delStart
          const addStart = i
          while (i < lines.length && lines[i].type === 'add') i++
          const addCount = i - addStart
          const pairCount = Math.min(delCount, addCount)

          for (let k = 0; k < delCount; k++) {
            const dl = lines[delStart + k]
            const spans = oldTokens[oldIdx++]
            const finalSpans = k < pairCount
              ? splitSpansByRanges(spans, segmentsToRanges(computeWordDiff(dl.text, lines[addStart + k].text).del))
              : spans
            frag.appendChild(this._buildRow('del', dl, finalSpans))
          }
          for (let k = 0; k < addCount; k++) {
            const al = lines[addStart + k]
            const spans = newTokens[newIdx++]
            const finalSpans = k < pairCount
              ? splitSpansByRanges(spans, segmentsToRanges(computeWordDiff(lines[delStart + k].text, al.text).add))
              : spans
            frag.appendChild(this._buildRow('add', al, finalSpans))
          }
          continue
        }

        // Stray 'add' with no preceding 'del' (start of hunk, or after ctx)
        const spans = newTokens[newIdx++]
        frag.appendChild(this._buildRow('add', line, spans))
        i++
      }
    }

    this._bodyEl.innerHTML = ''
    this._bodyEl.appendChild(frag)
  }

  _buildHunkHeaderRow(hunk) {
    const row = document.createElement('div')
    row.className = 'diff-row diff-row-hunk'
    row.appendChild(this._emptyCell('diff-ln diff-ln-old'))
    row.appendChild(this._emptyCell('diff-ln diff-ln-new'))
    row.appendChild(this._emptyCell('diff-marker'))
    const code = document.createElement('span')
    code.className = 'diff-code diff-hunk-header'
    code.textContent = hunk.header
    row.appendChild(code)
    return row
  }

  _buildMetaRow(line) {
    const row = document.createElement('div')
    row.className = 'diff-row diff-row-meta'
    row.appendChild(this._emptyCell('diff-ln diff-ln-old'))
    row.appendChild(this._emptyCell('diff-ln diff-ln-new'))
    row.appendChild(this._emptyCell('diff-marker'))
    const code = document.createElement('span')
    code.className = 'diff-code'
    code.textContent = line.text
    row.appendChild(code)
    return row
  }

  _emptyCell(className) {
    const el = document.createElement('span')
    el.className = className
    return el
  }

  _buildRow(type, line, spans) {
    const row = document.createElement('div')
    row.className = `diff-row diff-row-${type}`

    const oldLn = document.createElement('span')
    oldLn.className = 'diff-ln diff-ln-old'
    oldLn.textContent = line.oldNo != null ? String(line.oldNo) : ''
    row.appendChild(oldLn)

    const newLn = document.createElement('span')
    newLn.className = 'diff-ln diff-ln-new'
    newLn.textContent = line.newNo != null ? String(line.newNo) : ''
    row.appendChild(newLn)

    const marker = document.createElement('span')
    marker.className = 'diff-marker'
    marker.textContent = type === 'add' ? '+' : type === 'del' ? '−' : ''
    row.appendChild(marker)

    const code = document.createElement('span')
    code.className = 'diff-code'
    if (spans && spans.length) {
      for (const span of spans) {
        if (!span.text) continue
        if (!span.cls && !span.changed) {
          code.appendChild(document.createTextNode(span.text))
          continue
        }
        const tokenEl = document.createElement('span')
        tokenEl.className = [span.cls, span.changed ? 'diff-word' : ''].filter(Boolean).join(' ')
        tokenEl.textContent = span.text
        code.appendChild(tokenEl)
      }
    } else {
      code.appendChild(document.createTextNode(line.text))
    }
    row.appendChild(code)

    return row
  }

  destroy() {
    this._destroyButtons()
    this._requestId++
    this._onOpenFile = null
    this._onStage = null
    this._onUnstage = null
    this._onDiscard = null
    if (this._containerEl) this._containerEl.innerHTML = ''
    this._containerEl = null
  }
}
