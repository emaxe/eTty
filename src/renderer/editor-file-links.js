/**
 * CodeMirror 6 extension: clickable file path links.
 *
 * Detects file paths in editor content and makes them Ctrl/Cmd+Click navigable.
 * Patterns recognised:
 *   - backtick-wrapped: `path/to/file.ext`
 *   - markdown links:   [text](path/to/file.md)
 *   - dot-prefix:       ./config.json, ../utils.js
 *   - absolute:         /Users/foo/bar.js
 *   - relative w/slash: src/foo/bar.js
 */

import {
  ViewPlugin,
  MatchDecorator,
  Decoration,
  EditorView
} from '@codemirror/view'

// ── Helpers ─────────────────────────────────────────────────────────────────

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform)

function isModKey(e) {
  return IS_MAC ? e.key === 'Meta' : e.key === 'Control'
}

function hasModKey(e) {
  return IS_MAC ? e.metaKey : e.ctrlKey
}

/** Known file extensions (lower-case, without dot). */
const KNOWN_EXTS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'json', 'yaml', 'yml', 'toml',
  'md', 'markdown', 'txt', 'rst',
  'html', 'htm', 'css', 'scss', 'less', 'sass',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'cpp', 'h', 'hpp',
  'sh', 'bash', 'zsh', 'fish',
  'sql', 'graphql', 'gql',
  'xml', 'svg', 'plist',
  'env', 'gitignore', 'dockerignore',
  'lock', 'log', 'csv',
  'vue', 'svelte', 'astro',
  'swift', 'dart', 'lua', 'zig', 'nim', 'ex', 'exs', 'erl',
  'tf', 'hcl', 'prisma', 'proto'
])

/** Returns true when text looks like a file path (for backtick-wrapped content). */
function isPathLike(text) {
  if (text.includes('/')) return true
  const dot = text.lastIndexOf('.')
  if (dot > 0 && dot < text.length - 1) {
    return KNOWN_EXTS.has(text.slice(dot + 1).toLowerCase())
  }
  return false
}

/** Strip trailing sentence punctuation that isn't part of a file extension. */
function stripTrailing(text) {
  return text.replace(/[.,;:!?)]+$/, m => {
    const before = text.slice(0, text.length - m.length)
    const dot = before.lastIndexOf('.')
    // If the text before trailing punct ends with a known extension, strip the punct
    if (dot >= 0 && KNOWN_EXTS.has(before.slice(dot + 1).toLowerCase())) return ''
    // Otherwise keep — the punct might be part of the path
    return m
  })
}

/**
 * Normalise a path — resolve `.` and `..` segments.
 * Works without Node.js `path` module.
 */
export function normalizePath(p) {
  const parts = p.split('/')
  const result = []
  for (const part of parts) {
    if (part === '..') result.pop()
    else if (part !== '.' && part !== '') result.push(part)
  }
  return '/' + result.join('/')
}

// ── Regex ───────────────────────────────────────────────────────────────────
//
// Combined pattern with named-ish groups (captured by index):
//   1 — backtick-wrapped content
//   2 — markdown link path  [text](PATH)
//   3 — dot-prefix or absolute path
//   4 — relative path with slash (e.g. src/foo/bar.js)

const FILE_PATH_RE = new RegExp(
  '(?:' +
    '`([^`\\n]+)`' +                                     // group 1: backtick
  ')|(?:' +
    '\\[(?:[^\\]]*)\\]\\(([^)\\s]+)\\)' +                // group 2: markdown link
  ')|(' +
    '(?<!:)' +                                            // not preceded by : (skip URLs)
    '(?:\\.{1,2}/|/(?=[a-zA-Z]))' +                      // group 3: ./  ../  /A
    '[^\\s`\'"\\]}>]+' +
  ')|(' +
    '(?<=^|[\\s`\'"(\\[{,;:])' +                         // group 4: word-boundary start
    '[a-zA-Z0-9_][a-zA-Z0-9_./-]*/' +                    // at least one slash
    '[a-zA-Z0-9_./-]*[a-zA-Z0-9_]' +                     // end on alnum/underscore
    '(?:\\.[a-zA-Z0-9]{1,10})?' +                         // optional extension
  ')',
  'g'
)

// ── Decoration ──────────────────────────────────────────────────────────────

function makeMark(path) {
  return Decoration.mark({
    class: 'cm-file-link',
    attributes: { 'data-path': path }
  })
}

const linkDecorator = new MatchDecorator({
  regexp: FILE_PATH_RE,
  decorate(add, from, to, match) {
    // Group 1 — backtick-wrapped
    if (match[1] != null) {
      const inner = match[1]
      if (!isPathLike(inner)) return
      // skip opening and closing backtick
      add(from + 1, from + 1 + inner.length, makeMark(inner))
      return
    }

    // Group 2 — markdown link [text](path)
    if (match[2] != null) {
      const path = match[2]
      if (/^https?:\/\//.test(path)) return // skip URLs
      // Decorate only the path inside parentheses (skip "[text](")
      const pathStart = from + match[0].indexOf('(') + 1
      add(pathStart, pathStart + path.length, makeMark(path))
      return
    }

    // Group 3 — dot-prefix or absolute path
    if (match[3] != null) {
      const raw = match[3]
      const clean = stripTrailing(raw)
      if (clean.length < 2) return
      add(from, from + clean.length, makeMark(clean))
      return
    }

    // Group 4 — relative path with slash
    if (match[4] != null) {
      const raw = match[4]
      const clean = stripTrailing(raw)
      if (clean.length < 3) return
      add(from, from + clean.length, makeMark(clean))
    }
  }
})

// ── ViewPlugin ──────────────────────────────────────────────────────────────

const fileLinkPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = linkDecorator.createDeco(view)
    }
    update(viewUpdate) {
      this.decorations = linkDecorator.updateDeco(viewUpdate, this.decorations)
    }
  },
  { decorations: v => v.decorations }
)

// ── Event handlers ──────────────────────────────────────────────────────────

function modKeyHandlers() {
  return EditorView.domEventHandlers({
    keydown(event, view) {
      if (isModKey(event)) view.dom.classList.add('cm-file-links-active')
    },
    keyup(event, view) {
      if (isModKey(event)) view.dom.classList.remove('cm-file-links-active')
    },
    blur(_event, view) {
      view.dom.classList.remove('cm-file-links-active')
    }
  })
}

function clickHandler(onFileClick) {
  return EditorView.domEventHandlers({
    click(event, view) {
      if (!hasModKey(event)) return false

      // Walk up from the event target to find a .cm-file-link span
      let el = event.target
      while (el && el !== view.dom) {
        if (el.classList?.contains('cm-file-link')) {
          const path = el.getAttribute('data-path')
          if (path) {
            event.preventDefault()
            onFileClick(path)
            return true
          }
        }
        el = el.parentElement
      }
      return false
    }
  })
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Create the file-links extension for CodeMirror 6.
 * @param {{ onFileClick: (path: string) => void }} opts
 * @returns {import('@codemirror/state').Extension}
 */
export function fileLinksExtension({ onFileClick }) {
  return [
    fileLinkPlugin,
    modKeyHandlers(),
    clickHandler(onFileClick)
  ]
}
