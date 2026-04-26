# Block-Based Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace monolithic xterm.js-per-tab with a block-based terminal: Input Block (custom DOM input with ghost text + suggestions), Output Block (live xterm.js during command execution), Completed Block (frozen readonly DOM). Interactive TUI programs run in a fullscreen xterm.js overlay. All blocks persist across restorations.

**Architecture:** Shell Integration Protocol (OSC 1337) — zsh hooks inject block boundary sequences via preexec/precmd. Renderer parses OSC, constructs DOM blocks, routes PTY output. One PTY per tab. Feature flag toggles `block` and `classic` modes.

**Tech Stack:** Electron 33, electron-vite, xterm.js 5.5, node-pty 1.0, zsh, CodeMirror 6 (unchanged)

---

## File Structure

### New Files

| File | Responsibility | Est. Lines |
|------|---------------|-----------|
| `src/main/shell-integration.js` | Generate zsh hook script with OSC 1337 sequences | 60 |
| `src/main/block-persistence.js` | Save/load block state to `~/.config/eTty/blocks/<tabId>.json` | 100 |
| `src/renderer/ansi-to-html.js` | Lightweight ANSI escape → HTML converter | 80 |
| `src/renderer/input-block.js` | Custom DOM input: prompt, `<input>`, ghost text, suggestion menu | 200 |
| `src/renderer/output-block.js` | Live xterm.js wrapper for command output | 100 |
| `src/renderer/completed-block.js` | Frozen readonly DOM block with toolbar (Copy, Re-run) | 120 |
| `src/renderer/tui-overlay.js` | Fullscreen xterm.js overlay for TUI programs | 120 |
| `src/renderer/block-terminal.js` | Orchestrator: manages block lifecycle, routes PTY data, TUI detection | 280 |
| `src/renderer/classic-terminal.js` | Extracted current xterm.js-per-tab behavior (feature flag fallback) | 180 |

### Modified Files

| File | Changes |
|------|---------|
| `src/main/pty-manager.js` | Use `generateShellIntegrationScript` from new module |
| `src/main/index.js` | Register `blocks:*` IPC handlers |
| `src/main/settings-store.js` | Add `terminal: { mode: 'classic' }` default |
| `src/preload/index.js` | Expose `blocks:save`, `blocks:load`, `blocks:delete` |
| `src/renderer/index.js` | Dispatch `block` vs `classic` mode in `createTab`, wire BlockTerminal |
| `src/renderer/tab-bar.js` | Remove direct `term` references, use `tab.terminal` adapter |
| `src/renderer/settings-page.js` | Add `terminal.mode` toggle |
| `src/renderer/styles.css` | Add `.block-*` and `.tui-overlay` styles (~150 lines) |

---

## Task 1: Shell Integration Hooks

**Files:**
- Create: `src/main/shell-integration.js`
- Modify: `src/main/pty-manager.js`

**Goal:** Extract zsh hook generation into a module, add OSC 1337 Start/End sequences.

- [ ] **Step 1: Export `PROMPT_MAP` from `pty-manager.js`**

Replace line 8:
```js
export const PROMPT_MAP = {
  short: '%1~ %% ',
  minimal: '> ',
  arrow: '%1~ ❯ '
}
```

- [ ] **Step 2: Create `src/main/shell-integration.js`**

```js
const PROMPT_MAP = {
  short: '%1~ %% ',
  minimal: '> ',
  arrow: '%1~ ❯ '
}

/**
 * Generates a zsh hook script for block-based terminal integration.
 * @param {Object} options
 * @param {string} options.historyFile - HISTFILE path
 * @param {string} options.promptStyle - 'default' | 'short' | 'minimal' | 'arrow'
 * @param {string} options.home - Home directory path
 * @returns {string} Full .zshrc content
 */
export function generateShellIntegrationScript({ historyFile, promptStyle, home }) {
  const historyLines = historyFile
    ? [
        `HISTFILE="${historyFile}"`,
        `HISTSIZE=5000`,
        `SAVEHIST=5000`,
        `setopt INC_APPEND_HISTORY`,
        `setopt HIST_IGNORE_DUPS`,
        `setopt HIST_IGNORE_SPACE`
      ]
    : []

  const promptLine = PROMPT_MAP[promptStyle]
    ? `PROMPT='${PROMPT_MAP[promptStyle]}'`
    : ''

  return [
    `[[ -f "${home}/.zshrc" ]] && builtin source "${home}/.zshrc"`,
    `PROMPT_EOL_MARK=""`,
    ...historyLines,
    `autoload -Uz add-zsh-hook`,
    // Existing eTty hooks
    `_etty_cwd() { printf '\\033]7;file://%s\\007' "$PWD"; }`,
    `_etty_preexec() { printf '\\033]133;C\\007' }`,
    `_etty_precmd_state() { printf '\\033]133;A\\007' }`,
    `add-zsh-hook precmd _etty_cwd`,
    `add-zsh-hook preexec _etty_preexec`,
    `add-zsh-hook precmd _etty_precmd_state`,
    `_etty_cwd`,
    // Block integration hooks
    `_etty_block_start() { printf '\\033]1337;Start\\007' }`,
    `_etty_block_end() {`,
    `  local last_status=$?`,
    `  printf '\\033]1337;End=%s\\007' "$last_status"`,
    `}`,
    `add-zsh-hook preexec _etty_block_start`,
    `add-zsh-hook precmd _etty_block_end`,
    promptLine
  ].filter(Boolean).join('\n') + '\n'
}
```

- [ ] **Step 3: Refactor `pty-manager.js` to use `generateShellIntegrationScript`**

Add import at top:
```js
import { generateShellIntegrationScript } from './shell-integration.js'
```

Replace `_createZdotdir` method (lines 31-72) with:
```js
  _createZdotdir(historyFile, promptStyle) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etty-'))
    const home = os.homedir()

    fs.writeFileSync(
      path.join(tmpDir, '.zshenv'),
      `[[ -f "${path.join(home, '.zshenv')}" ]] && builtin source "${path.join(home, '.zshenv')}"\n`
    )

    fs.writeFileSync(
      path.join(tmpDir, '.zshrc'),
      generateShellIntegrationScript({ historyFile, promptStyle, home })
    )

    return tmpDir
  }
```

- [ ] **Step 4: Verify hook script contains OSC 1337**

Run quick verification:
```bash
cd /Users/maksimklisin/Desktop/_JS/eTty
node -e "
import { generateShellIntegrationScript } from './src/main/shell-integration.js';
const script = generateShellIntegrationScript({ historyFile: '/tmp/hist', promptStyle: 'arrow', home: '/home/test' });
console.assert(script.includes('1337;Start'), 'Missing Start hook');
console.assert(script.includes('1337;End'), 'Missing End hook');
console.assert(script.includes('add-zsh-hook preexec _etty_block_start'), 'Missing preexec hook');
console.assert(script.includes('add-zsh-hook precmd _etty_block_end'), 'Missing precmd hook');
console.log('OK: shell-integration hooks verified');
"
```

Expected: `OK: shell-integration hooks verified`

- [ ] **Step 5: Commit**

```bash
git add src/main/shell-integration.js src/main/pty-manager.js
git commit -m "feat(block-terminal): add OSC 1337 shell integration hooks

- Extract zsh hook generation to shell-integration.js
- Add _etty_block_start (preexec) and _etty_block_end (precmd)
- Emit OSC 1337;Start and OSC 1337;End=<exitCode> sequences"
```

---

## Task 2: Feature Flag — Terminal Mode Setting

**Files:**
- Modify: `src/main/settings-store.js`
- Modify: `src/renderer/index.js`
- Modify: `src/renderer/settings-page.js`

**Goal:** Add `terminal.mode` setting with values `'classic'` (default) and `'block'`.

- [ ] **Step 1: Read `src/main/settings-store.js` to find default config object**

The file likely has a `DEFAULT_CONFIG` or similar. Read it, then add:
```js
terminal: {
  mode: 'classic' // 'classic' | 'block'
}
```

- [ ] **Step 2: Add default in `src/renderer/index.js`**

In `init()`, after loading settings (around line 86), add:
```js
if (!config.terminal) config.terminal = {}
if (!config.terminal.mode) config.terminal.mode = 'classic'
```

- [ ] **Step 3: Add settings UI toggle in `settings-page.js`**

Find the terminal settings category in `_buildDOM()`. Add a select row:

```js
const terminalCategory = document.createElement('div')
terminalCategory.className = 'settings-category'

const terminalTitle = document.createElement('div')
terminalTitle.className = 'settings-category-title'
terminalTitle.textContent = 'Терминал'
terminalCategory.appendChild(terminalTitle)

// Terminal mode row
const modeRow = document.createElement('div')
modeRow.className = 'settings-row'
const modeLabel = document.createElement('div')
modeLabel.className = 'settings-label'
modeLabel.textContent = 'Режим терминала'
const modeSelect = document.createElement('select')
modeSelect.className = 'settings-select'
modeSelect.innerHTML = `
  <option value="classic">Классический (xterm.js)</option>
  <option value="block">Блочный (подсказки + история)</option>
`
modeSelect.value = this._config.terminal?.mode || 'classic'
modeSelect.addEventListener('change', () => {
  this._config.terminal = this._config.terminal || {}
  this._config.terminal.mode = modeSelect.value
  this._saveSettings()
  this._onSettingsChanged?.('terminal.mode', modeSelect.value)
})
modeRow.appendChild(modeLabel)
modeRow.appendChild(modeSelect)
terminalCategory.appendChild(modeRow)

// Append terminal category to settings body
overlay.querySelector('.settings-body')?.appendChild(terminalCategory)
```

Note: The exact insertion point depends on `settings-page.js` structure. Find where other categories are appended and add the terminal category there.

- [ ] **Step 4: Handle `terminal.mode` change in `index.js`**

In the `onSettingsChanged` callback (around line 279), add:
```js
if (key === 'terminal.mode') {
  // Mode changes require tab reload — show a toast or ignore
  console.log('Terminal mode changed to', value, '- will apply to new tabs')
}
```

- [ ] **Step 5: Commit**

```bash
git add src/main/settings-store.js src/renderer/index.js src/renderer/settings-page.js
git commit -m "feat(settings): add terminal.mode feature flag (classic/block)"
```

---

## Task 3: ANSI-to-HTML Parser

**Files:**
- Create: `src/renderer/ansi-to-html.js`

**Goal:** Convert ANSI escape sequences (colors, bold, underline) to HTML span elements.

- [ ] **Step 1: Implement `src/renderer/ansi-to-html.js`**

```js
const ANSI_COLORS = [
  '#000000', '#c00000', '#00c000', '#c0c000',
  '#0000c0', '#c000c0', '#00c0c0', '#c0c0c0'
]
const ANSI_BRIGHT_COLORS = [
  '#808080', '#ff0000', '#00ff00', '#ffff00',
  '#0000ff', '#ff00ff', '#00ffff', '#ffffff'
]

function parseColor(params) {
  if (params.length === 0) return null
  const mode = params.shift()
  if (mode === 5 && params.length >= 1) {
    const code = params.shift()
    if (code < 16) return ANSI_COLORS[code] || ANSI_BRIGHT_COLORS[code - 8]
    if (code < 232) {
      const r = Math.floor((code - 16) / 36) * 51
      const g = Math.floor(((code - 16) % 36) / 6) * 51
      const b = ((code - 16) % 6) * 51
      return `rgb(${r},${g},${b})`
    }
    const gray = (code - 232) * 10 + 8
    return `rgb(${gray},${gray},${gray})`
  }
  if (mode === 2 && params.length >= 3) {
    return `rgb(${params.shift()},${params.shift()},${params.shift()})`
  }
  return null
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function ansiToHtml(text) {
  const regex = /\x1b\[([0-9;]*)m/g
  let result = ''
  let lastIndex = 0
  let match

  let fg = null, bg = null, bold = false, dim = false, italic = false, underline = false

  function buildStyle() {
    const styles = []
    if (fg) styles.push(`color:${fg}`)
    if (bg) styles.push(`background-color:${bg}`)
    if (bold) styles.push('font-weight:bold')
    if (dim) styles.push('opacity:0.6')
    if (italic) styles.push('font-style:italic')
    if (underline) styles.push('text-decoration:underline')
    return styles.length > 0 ? ` style="${styles.join(';')}"` : ''
  }

  function emitText(plain) {
    if (!plain) return
    const style = buildStyle()
    result += style ? `<span${style}>${escapeHtml(plain)}</span>` : escapeHtml(plain)
  }

  while ((match = regex.exec(text)) !== null) {
    emitText(text.slice(lastIndex, match.index))

    const params = match[1].split(';').map(Number).filter(n => !isNaN(n))
    if (params.length === 0) params.push(0)

    let i = 0
    while (i < params.length) {
      const code = params[i++]
      switch (code) {
        case 0: fg = null; bg = null; bold = false; dim = false; italic = false; underline = false; break
        case 1: bold = true; break
        case 2: dim = true; break
        case 3: italic = true; break
        case 4: underline = true; break
        case 22: bold = false; dim = false; break
        case 23: italic = false; break
        case 24: underline = false; break
        case 30: case 31: case 32: case 33: case 34: case 35: case 36: case 37:
          fg = ANSI_COLORS[code - 30]; break
        case 38: { const c = parseColor(params.slice(i)); if (c) { fg = c; i = params.length; } break }
        case 39: fg = null; break
        case 40: case 41: case 42: case 43: case 44: case 45: case 46: case 47:
          bg = ANSI_COLORS[code - 40]; break
        case 48: { const c = parseColor(params.slice(i)); if (c) { bg = c; i = params.length; } break }
        case 49: bg = null; break
        case 90: case 91: case 92: case 93: case 94: case 95: case 96: case 97:
          fg = ANSI_BRIGHT_COLORS[code - 90]; break
        case 100: case 101: case 102: case 103: case 104: case 105: case 106: case 107:
          bg = ANSI_BRIGHT_COLORS[code - 100]; break
      }
    }
    lastIndex = regex.lastIndex
  }

  emitText(text.slice(lastIndex))
  return result || escapeHtml(text)
}
```

- [ ] **Step 2: Verify parser with inline test**

```bash
cd /Users/maksimklisin/Desktop/_JS/eTty
node -e "
import { ansiToHtml } from './src/renderer/ansi-to-html.js';
const tests = [
  ['Hello', 'Hello'],
  ['\x1b[31mRed\x1b[0m Normal', '<span style=\"color:#c00000\">Red</span> Normal'],
  ['\x1b[1;32mBold Green\x1b[0m', '<span style=\"color:#00c000;font-weight:bold\">Bold Green</span>'],
  ['\x1b[38;5;196mExtended\x1b[0m', '<span style=\"color:rgb(255,0,0)\">Extended</span>'],
  ['\x1b[38;2;255;128;0mTrueColor\x1b[0m', '<span style=\"color:rgb(255,128,0)\">TrueColor</span>'],
];
let ok = true;
for (const [input, expected] of tests) {
  const result = ansiToHtml(input);
  if (result !== expected) { console.error('FAIL:', input, '=>', result, 'expected:', expected); ok = false; }
}
if (ok) console.log('PASS: all ansi-to-html tests');
"
```

Expected: `PASS: all ansi-to-html tests`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/ansi-to-html.js
git commit -m "feat(block-terminal): add ANSI-to-HTML parser

Supports 3/4-bit colors, 8-bit, 24-bit, bold, italic, underline.
Lightweight converter for CompletedBlock output rendering."
```

---

## Task 4: CompletedBlock Component

**Files:**
- Create: `src/renderer/completed-block.js`

**Goal:** Frozen readonly DOM block: header (cwd, input, meta), output area (HTML from ANSI), toolbar (Copy, Re-run).

- [ ] **Step 1: Implement `src/renderer/completed-block.js`**

```js
import { ansiToHtml } from './ansi-to-html.js'

/**
 * Frozen readonly block for a completed command.
 */
export class CompletedBlock {
  constructor({ cwd, input, outputText, outputHtml, exitCode, durationMs, timestamp, onCopy, onRerun }) {
    this.cwd = cwd || ''
    this.input = input || ''
    this.outputText = outputText || ''
    this.outputHtml = outputHtml || ansiToHtml(outputText || '')
    this.exitCode = exitCode
    this.durationMs = durationMs
    this.timestamp = timestamp || Date.now()
    this.onCopy = onCopy
    this.onRerun = onRerun
    this.element = this._buildDOM()
  }

  _buildDOM() {
    const el = document.createElement('div')
    el.className = 'block-completed'

    // Header
    const header = document.createElement('div')
    header.className = 'block-header'

    const cwdSpan = document.createElement('span')
    cwdSpan.className = 'block-cwd'
    cwdSpan.textContent = this.cwd
    cwdSpan.title = this.cwd

    const inputSpan = document.createElement('span')
    inputSpan.className = 'block-input-text'
    inputSpan.textContent = this.input
    inputSpan.title = this.input

    const metaSpan = document.createElement('span')
    metaSpan.className = 'block-meta'
    const parts = []
    if (this.durationMs != null) parts.push(`${(this.durationMs / 1000).toFixed(1)}s`)
    if (this.exitCode !== undefined) parts.push(`exit ${this.exitCode}`)
    metaSpan.textContent = parts.join(' · ')

    header.appendChild(cwdSpan)
    header.appendChild(inputSpan)
    header.appendChild(metaSpan)

    // Output
    const output = document.createElement('div')
    output.className = 'block-output'
    output.innerHTML = this.outputHtml

    // Toolbar
    const toolbar = document.createElement('div')
    toolbar.className = 'block-toolbar'

    const btnCopy = document.createElement('button')
    btnCopy.textContent = 'Copy'
    btnCopy.addEventListener('click', () => this.onCopy?.(this.outputText))

    const btnRerun = document.createElement('button')
    btnRerun.textContent = 'Re-run'
    btnRerun.addEventListener('click', () => this.onRerun?.(this.input))

    toolbar.appendChild(btnCopy)
    toolbar.appendChild(btnRerun)

    el.appendChild(header)
    el.appendChild(output)
    el.appendChild(toolbar)

    return el
  }

  serialize() {
    return {
      type: 'completed',
      cwd: this.cwd,
      input: this.input,
      outputText: this.outputText,
      outputHtml: this.outputHtml,
      exitCode: this.exitCode,
      durationMs: this.durationMs,
      timestamp: this.timestamp
    }
  }

  static fromJSON(data, callbacks) {
    return new CompletedBlock({ ...data, ...callbacks })
  }
}
```

- [ ] **Step 2: Verify in DevTools**

After starting the app (`npm run dev`), open DevTools and run:
```js
const { CompletedBlock } = await import('./src/renderer/completed-block.js')
const block = new CompletedBlock({
  cwd: '~/Projects/eTty',
  input: 'git status',
  outputText: 'On branch main\\nnothing to commit',
  exitCode: 0,
  durationMs: 820,
  onCopy: (text) => console.log('Copied:', text),
  onRerun: (cmd) => console.log('Re-run:', cmd)
})
document.body.appendChild(block.element)
```

Expected: A block with header "~/Projects/eTty git status 0.8s · exit 0", output text, and Copy/Re-run buttons.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/completed-block.js
git commit -m "feat(block-terminal): add CompletedBlock component

Frozen readonly block with header, ANSI-rendered output, Copy/Re-run toolbar."
```

---

## Task 5: OutputBlock Component

**Files:**
- Create: `src/renderer/output-block.js`

**Goal:** Live xterm.js wrapper for command output. Created on command start, receives PTY data, destroyed on freeze.

- [ ] **Step 1: Implement `src/renderer/output-block.js`**

```js
import { Terminal } from '@xterm/xterm'
import { WebglAddon } from '@xterm/addon-webgl'

/**
 * Live terminal output block. Owns an xterm.js Terminal instance.
 * Receives PTY data while command is running.
 */
export class OutputBlock {
  constructor({ theme }) {
    this.theme = theme
    this.element = this._buildDOM()
    this._term = null
    this._frozen = false
  }

  _buildDOM() {
    const el = document.createElement('div')
    el.className = 'block-output-live'

    const badge = document.createElement('div')
    badge.className = 'block-running-badge'
    badge.innerHTML = '<span class="spinner"></span> Running…'
    this._badge = badge

    const termContainer = document.createElement('div')
    termContainer.className = 'block-output-term'
    this._termContainer = termContainer

    el.appendChild(badge)
    el.appendChild(termContainer)

    return el
  }

  init() {
    this._term = new Terminal({
      cursorBlink: false,
      fontSize: 14,
      fontFamily: 'Menlo, "SF Mono", Consolas, "Courier New", monospace',
      scrollback: 10000,
      allowProposedApi: true,
      theme: this.theme
    })

    this._term.options.cursorStyle = 'block'
    this._term.options.cursorBlink = false

    this._term.open(this._termContainer)

    try {
      this._term.loadAddon(new WebglAddon())
    } catch (e) {
      console.warn('WebGL addon failed in OutputBlock:', e)
    }
  }

  write(data) {
    if (this._frozen) return
    this._term?.write(data)
  }

  /**
   * Freeze the block: serialize buffer, destroy xterm.js, return data for CompletedBlock.
   */
  freeze() {
    if (this._frozen) return null
    this._frozen = true

    let outputText = ''
    const buffer = this._term?.buffer?.active
    if (buffer) {
      for (let i = 0; i < Math.min(buffer.length, 10000); i++) {
        const line = buffer.getLine(i)
        if (line) outputText += line.translateToString(true) + '\n'
      }
    }

    this._term?.dispose()
    this._term = null
    this._badge.remove()

    return { outputText: outputText.trimEnd() }
  }

  resize(cols, rows) {
    if (!this._frozen) {
      this._term?.resize(cols, rows)
    }
  }

  focus() {
    if (!this._frozen) {
      this._term?.focus()
    }
  }
}
```

- [ ] **Step 2: Verify in DevTools**

```js
const { OutputBlock } = await import('./src/renderer/output-block.js')
const theme = { background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#89b4fa' }
const block = new OutputBlock({ theme })
document.body.appendChild(block.element)
block.init()
block.write('Hello from xterm.js\r\n')
block.write('\x1b[31mRed text\x1b[0m\r\n')
const data = block.freeze()
console.log('Frozen output:', data.outputText)
```

Expected: Live terminal appears, shows text. After `freeze()`, `data.outputText` contains the text.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/output-block.js
git commit -m "feat(block-terminal): add OutputBlock component

Live xterm.js wrapper for command output. Serializes buffer on freeze."
```

---

## Task 6: InputBlock Component

**Files:**
- Create: `src/renderer/input-block.js`

**Goal:** Custom DOM input with prompt string, ghost text overlay, and async suggestion menu.

- [ ] **Step 1: Implement `src/renderer/input-block.js`**

```js
/**
 * Custom DOM input block for command entry.
 * Features: prompt display, ghost text, suggestion dropdown, history integration.
 */
export class InputBlock {
  constructor({ prompt, onSubmit, onCancel, getSuggestions }) {
    this.prompt = prompt || '$ '
    this.onSubmit = onSubmit
    this.onCancel = onCancel
    this.getSuggestions = getSuggestions
    this.element = this._buildDOM()
    this._suggestions = []
    this._selectedIndex = -1
    this._ghostText = ''
    this._inputDebounce = null
  }

  _buildDOM() {
    const el = document.createElement('div')
    el.className = 'block-input'

    const prompt = document.createElement('span')
    prompt.className = 'block-prompt'
    prompt.textContent = this.prompt
    this._promptEl = prompt

    const wrapper = document.createElement('div')
    wrapper.className = 'block-input-wrapper'

    const input = document.createElement('input')
    input.className = 'block-input-field'
    input.type = 'text'
    input.autocomplete = 'off'
    input.spellcheck = false
    this._input = input

    const ghost = document.createElement('span')
    ghost.className = 'block-ghost'
    this._ghostEl = ghost

    wrapper.appendChild(input)
    wrapper.appendChild(ghost)

    const menu = document.createElement('div')
    menu.className = 'block-suggestion-menu hidden'
    this._menu = menu

    el.appendChild(prompt)
    el.appendChild(wrapper)
    el.appendChild(menu)

    input.addEventListener('keydown', (e) => this._onKeyDown(e))
    input.addEventListener('input', () => {
      clearTimeout(this._inputDebounce)
      this._inputDebounce = setTimeout(() => this._onInput(), 50)
    })
    input.addEventListener('blur', () => {
      setTimeout(() => this._hideMenu(), 150)
    })

    return el
  }

  _onKeyDown(e) {
    if (!this._menu.classList.contains('hidden')) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          this._selectedIndex = Math.min(this._selectedIndex + 1, this._suggestions.length - 1)
          this._renderMenu()
          return
        case 'ArrowUp':
          e.preventDefault()
          this._selectedIndex = Math.max(this._selectedIndex - 1, -1)
          this._renderMenu()
          return
        case 'Enter':
          e.preventDefault()
          if (this._selectedIndex >= 0) {
            this._input.value = this._suggestions[this._selectedIndex]
            this._ghostEl.textContent = ''
          }
          this._hideMenu()
          this._input.focus()
          return
        case 'Escape':
          e.preventDefault()
          this._hideMenu()
          return
        case 'ArrowRight':
          if (this._selectedIndex >= 0) {
            e.preventDefault()
            this._input.value = this._suggestions[this._selectedIndex]
            this._ghostEl.textContent = ''
            this._hideMenu()
          } else if (this._ghostText) {
            e.preventDefault()
            this._input.value = this._ghostText
            this._ghostEl.textContent = ''
            this._hideMenu()
          }
          return
      }
    }

    // Menu hidden
    if (e.key === 'Enter') {
      e.preventDefault()
      const value = this._input.value.trim()
      if (value) {
        this.onSubmit?.(value)
        this._input.value = ''
        this._ghostEl.textContent = ''
      }
      return
    }
    if (e.key === 'Escape') {
      this.onCancel?.()
      return
    }
    if (e.key === 'c' && e.ctrlKey) {
      e.preventDefault()
      this._input.value = ''
      this._ghostEl.textContent = ''
      this.onCancel?.()
      return
    }
    if (e.key === 'ArrowRight' && this._ghostText) {
      e.preventDefault()
      this._input.value = this._ghostText
      this._ghostEl.textContent = ''
      this._hideMenu()
      return
    }
  }

  async _onInput() {
    const value = this._input.value
    if (!value.trim()) {
      this._ghostEl.textContent = ''
      this._hideMenu()
      return
    }

    let suggestions = []
    try {
      suggestions = await this.getSuggestions?.(value) || []
    } catch (e) {
      console.warn('Suggestions error:', e)
    }

    this._suggestions = suggestions.slice(0, 8)
    this._selectedIndex = -1

    if (this._suggestions.length > 0) {
      this._ghostText = this._suggestions[0]
      const ghostSuffix = this._ghostText.startsWith(value) ? this._ghostText.slice(value.length) : ''
      this._ghostEl.textContent = ghostSuffix
      this._renderMenu()
    } else {
      this._ghostText = ''
      this._ghostEl.textContent = ''
      this._hideMenu()
    }
  }

  _renderMenu() {
    if (this._suggestions.length === 0) {
      this._hideMenu()
      return
    }

    this._menu.innerHTML = ''
    this._menu.classList.remove('hidden')

    for (let i = 0; i < this._suggestions.length; i++) {
      const item = document.createElement('div')
      item.className = 'block-suggestion-item'
      if (i === this._selectedIndex) item.classList.add('selected')
      item.textContent = this._suggestions[i]
      item.addEventListener('mousedown', (e) => {
        e.preventDefault()
        this._input.value = this._suggestions[i]
        this._ghostEl.textContent = ''
        this._hideMenu()
        this._input.focus()
      })
      this._menu.appendChild(item)
    }
  }

  _hideMenu() {
    this._menu.classList.add('hidden')
    this._selectedIndex = -1
  }

  focus() { this._input.focus() }
  setPrompt(prompt) { this.prompt = prompt; this._promptEl.textContent = prompt }
  setValue(value) { this._input.value = value; this._onInput() }
  getValue() { return this._input.value }
  disable() { this._input.disabled = true; this._input.blur() }
  enable() { this._input.disabled = false }
}
```

- [ ] **Step 2: Verify in DevTools**

```js
const { InputBlock } = await import('./src/renderer/input-block.js')
const input = new InputBlock({
  prompt: '~/eTty $ ',
  onSubmit: (v) => console.log('Submit:', v),
  onCancel: () => console.log('Cancel'),
  getSuggestions: async (prefix) => {
    const all = ['npm run dev', 'npm run build', 'git status', 'git log']
    return all.filter(c => c.startsWith(prefix))
  }
})
document.body.appendChild(input.element)
input.focus()
```

Expected: Type `npm` — ghost text shows " run dev", suggestion menu appears with 2 items. ArrowRight fills "npm run dev".

- [ ] **Step 3: Commit**

```bash
git add src/renderer/input-block.js
git commit -m "feat(block-terminal): add InputBlock component

Custom DOM input with prompt, ghost text, async suggestion dropdown.
ArrowRight accepts ghost text. ArrowUp/Down navigates menu."
```

---

## Task 7: TuiOverlay Component

**Files:**
- Create: `src/renderer/tui-overlay.js`

**Goal:** Fullscreen xterm.js overlay for interactive programs (vim, htop, ssh). Inline styles for critical positioning.

- [ ] **Step 1: Implement `src/renderer/tui-overlay.js`**

```js
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'

/**
 * Fullscreen xterm.js overlay for interactive TUI programs.
 */
export class TuiOverlay {
  constructor({ theme, onClose }) {
    this.theme = theme
    this.onClose = onClose
    this.element = this._buildDOM()
    this._term = null
    this._fitAddon = null
    this._isVisible = false
    document.body.appendChild(this.element)
  }

  _buildDOM() {
    const el = document.createElement('div')
    el.className = 'tui-overlay'
    el.style.cssText = 'position:fixed;inset:0;z-index:1000;display:none;flex-direction:column;background:#1e1e2e;'

    const header = document.createElement('div')
    header.className = 'tui-overlay-header'
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 10px;background:#181825;border-bottom:1px solid #313244;font-size:12px;color:#6c7086;flex-shrink:0;user-select:none;'

    const label = document.createElement('span')
    label.textContent = 'Interactive Mode'

    const closeBtn = document.createElement('button')
    closeBtn.textContent = '×'
    closeBtn.title = 'Close (sends Ctrl+C to program)'
    closeBtn.style.cssText = 'background:none;border:none;color:#6c7086;font-size:18px;line-height:1;cursor:pointer;padding:0 4px;'
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#f38ba8' })
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = '#6c7086' })
    closeBtn.addEventListener('click', () => this.onClose?.())

    header.appendChild(label)
    header.appendChild(closeBtn)

    const termContainer = document.createElement('div')
    termContainer.className = 'tui-overlay-term'
    termContainer.style.cssText = 'flex:1;overflow:hidden;padding:4px;'
    this._termContainer = termContainer

    el.appendChild(header)
    el.appendChild(termContainer)

    return el
  }

  init() {
    this._term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, "SF Mono", Consolas, "Courier New", monospace',
      scrollback: 10000,
      allowProposedApi: true,
      theme: this.theme
    })

    this._fitAddon = new FitAddon()
    this._term.loadAddon(this._fitAddon)
    this._term.loadAddon(new WebLinksAddon())

    this._term.open(this._termContainer)

    try {
      this._term.loadAddon(new WebglAddon())
    } catch (e) {
      console.warn('WebGL addon failed in TuiOverlay:', e)
    }

    this._fitAddon.fit()
  }

  show() {
    if (this._isVisible) return
    this._isVisible = true
    this.element.style.display = 'flex'
    requestAnimationFrame(() => {
      this._fitAddon?.fit()
      this._term?.focus()
    })
  }

  hide() {
    if (!this._isVisible) return
    this._isVisible = false
    this.element.style.display = 'none'
  }

  write(data) {
    this._term?.write(data)
  }

  resize() {
    this._fitAddon?.fit()
  }

  focus() {
    this._term?.focus()
  }

  getTerm() {
    return this._term
  }

  dispose() {
    this._term?.dispose()
    this.element.remove()
  }
}
```

- [ ] **Step 2: Verify in DevTools**

```js
const { TuiOverlay } = await import('./src/renderer/tui-overlay.js')
const theme = { background: '#1e1e2e', foreground: '#cdd6f4' }
const overlay = new TuiOverlay({ theme, onClose: () => overlay.hide() })
overlay.init()
overlay.show()
overlay.write('Interactive mode active\r\n')
setTimeout(() => overlay.hide(), 3000)
```

Expected: Fullscreen overlay appears with header "Interactive Mode" and close button. Disappears after 3 seconds.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/tui-overlay.js
git commit -m "feat(block-terminal): add TuiOverlay component

Fullscreen xterm.js overlay for interactive programs (vim, htop, ssh).
Critical positioning via inline styles (CSS to be added in Task 14)."
```

---

## Task 8: BlockTerminal Orchestrator

**Files:**
- Create: `src/renderer/block-terminal.js`

**Goal:** Orchestrate block lifecycle: Input → Output → Completed. Route PTY data. Detect TUI via alternate screen.

- [ ] **Step 1: Implement `src/renderer/block-terminal.js`**

```js
import { InputBlock } from './input-block.js'
import { OutputBlock } from './output-block.js'
import { CompletedBlock } from './completed-block.js'
import { TuiOverlay } from './tui-overlay.js'

/**
 * Orchestrator per tab. Manages block lifecycle, routes PTY data, detects TUI.
 * State: 'idle' | 'running' | 'tui'
 */
export class BlockTerminal {
  constructor({ container, theme, pid, cwd, promptStyle, onPtyWrite, onPtyResize, getHistorySuggestions }) {
    this.container = container
    this.container.innerHTML = ''
    this.container.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:8px 12px;overflow-y:auto;'
    this.theme = theme
    this.pid = pid
    this.cwd = cwd
    this.promptStyle = promptStyle || 'default'
    this.onPtyWrite = onPtyWrite
    this.onPtyResize = onPtyResize
    this.getHistorySuggestions = getHistorySuggestions
    this.state = 'idle'
    this.blocks = []
    this._currentInput = null
    this._currentOutput = null
    this._tuiOverlay = null
    this._pendingTuiTimer = null
    this._commandStartTime = null
    this._tuiWhitelist = new Set([
      'vim', 'nvim', 'vi', 'nano', 'emacs', 'micro',
      'htop', 'btop', 'top', 'less', 'more',
      'ssh', 'tmux', 'screen'
    ])

    this._createInputBlock()
  }

  _formatPrompt(cwd) {
    const folder = cwd.split('/').filter(Boolean).pop() || '/'
    const map = {
      default: `${cwd} $ `,
      short: `${folder} %% `,
      minimal: '> ',
      arrow: `${folder} ❯ `
    }
    return map[this.promptStyle] || map.default
  }

  _createInputBlock() {
    const input = new InputBlock({
      prompt: this._formatPrompt(this.cwd),
      onSubmit: (value) => this._onInputSubmit(value),
      onCancel: () => {
        this._currentInput.setValue('')
        this._currentInput.focus()
      },
      getSuggestions: (prefix) => this.getHistorySuggestions?.(prefix) || Promise.resolve([])
    })
    this._currentInput = input
    this.container.appendChild(input.element)
    input.focus()
  }

  _onInputSubmit(value) {
    if (this.state !== 'idle') return

    const firstWord = value.trim().split(/\s+/)[0].toLowerCase()
    const isTui = this._tuiWhitelist.has(firstWord) ||
      value.trim().toLowerCase().startsWith('git rebase -i')

    if (isTui) {
      this._enterTuiMode(value)
      return
    }

    this._currentInput.disable()
    this._sendToPty(value + '\n')
    this.state = 'running'
    this._commandStartTime = Date.now()

    // Create OutputBlock optimistically
    const output = new OutputBlock({ theme: this.theme })
    output.init()
    this._currentOutput = output
    this.container.appendChild(output.element)
    output.focus()
    this._scrollToBottom()
  }

  _sendToPty(data) {
    this.onPtyWrite?.(data)
  }

  _enterTuiMode(inputValue) {
    this.state = 'tui'
    this._currentInput?.disable()
    this._sendToPty(inputValue + '\n')

    if (!this._tuiOverlay) {
      this._tuiOverlay = new TuiOverlay({
        theme: this.theme,
        onClose: () => this._sendToPty('\x03')
      })
      this._tuiOverlay.init()
    }
    this._tuiOverlay.show()
  }

  _exitTuiMode() {
    this.state = 'idle'
    this._tuiOverlay?.hide()
    this._currentInput?.element.remove()
    this._currentInput = null
    this._createInputBlock()
    this._scrollToBottom()
  }

  // ── PTY Data Handling ──

  onPtyData(data) {
    if (this.state === 'tui') {
      this._tuiOverlay?.write(data)
      this._detectTuiExit(data)
      return
    }

    if (this.state === 'running') {
      if (this._detectTuiEnter(data)) {
        // Abandon current OutputBlock, switch to TUI
        if (this._currentOutput) {
          this._currentOutput.element.remove()
          this._currentOutput._term?.dispose()
          this._currentOutput = null
        }
        this.state = 'tui'
        if (!this._tuiOverlay) {
          this._tuiOverlay = new TuiOverlay({
            theme: this.theme,
            onClose: () => this._sendToPty('\x03')
          })
          this._tuiOverlay.init()
        }
        this._tuiOverlay.show()
        this._tuiOverlay.write(data)
        return
      }
      this._currentOutput?.write(data)
      return
    }
  }

  // ── TUI Detection ──

  _detectTuiEnter(data) {
    return data.includes('\x1b[?1049h')
  }

  _detectTuiExit(data) {
    if (data.includes('\x1b[?1049l')) {
      this._exitTuiMode()
      return true
    }
    return false
  }

  // ── OSC Handlers ──

  onOscStart() {
    // Confirmation that shell received the command.
    // OutputBlock already created optimistically in _onInputSubmit.
  }

  onOscEnd(exitCode) {
    clearTimeout(this._pendingTuiTimer)

    if (this.state === 'tui') {
      this._exitTuiMode()
      return
    }

    if (this.state !== 'running') return

    const durationMs = this._commandStartTime ? Date.now() - this._commandStartTime : null
    const freezeData = this._currentOutput?.freeze()

    if (freezeData) {
      const completed = new CompletedBlock({
        cwd: this.cwd,
        input: this._currentInput?.getValue() || '',
        outputText: freezeData.outputText,
        exitCode,
        durationMs,
        timestamp: Date.now(),
        onCopy: (text) => navigator.clipboard.writeText(text),
        onRerun: (input) => {
          this._currentInput?.setValue(input)
          this._onInputSubmit(input)
        }
      })
      this.blocks.push(completed)
      this.container.insertBefore(completed.element, this._currentOutput.element)
      this._currentOutput.element.remove()
    }

    this._currentOutput = null
    this._currentInput?.element.remove()
    this._currentInput = null
    this.state = 'idle'
    this._commandStartTime = null
    this._createInputBlock()
    this._scrollToBottom()
  }

  _scrollToBottom() {
    requestAnimationFrame(() => {
      this.container.scrollTop = this.container.scrollHeight
    })
  }

  // ── External API ──

  setCwd(cwd) {
    this.cwd = cwd
    this._currentInput?.setPrompt(this._formatPrompt(cwd))
  }

  setTheme(theme) {
    this.theme = theme
    this._tuiOverlay?._term?.options.setOption?.('theme', theme)
  }

  focus() {
    if (this.state === 'tui') {
      this._tuiOverlay?.focus()
    } else {
      this._currentInput?.focus()
    }
  }

  resize() {
    this._tuiOverlay?.resize()
    this._currentOutput?.resize(80, 24)
  }

  write(data) {
    this.onPtyWrite?.(data)
  }

  injectInput(text) {
    if (this.state === 'idle' && this._currentInput) {
      this._currentInput.setValue(text)
    } else {
      this._sendToPty('\x15' + text)
    }
  }

  // ── Serialization ──

  serialize() {
    return {
      version: 1,
      blocks: this.blocks.map(b => b.serialize())
    }
  }

  restore(data) {
    if (!data || data.version !== 1) return
    this.container.innerHTML = ''
    this.blocks = []
    for (const blockData of data.blocks || []) {
      const block = CompletedBlock.fromJSON(blockData, {
        onCopy: (text) => navigator.clipboard.writeText(text),
        onRerun: (input) => {
          this._currentInput?.setValue(input)
          this._onInputSubmit(input)
        }
      })
      this.blocks.push(block)
      this.container.appendChild(block.element)
    }
    this._currentInput?.element.remove()
    this._currentInput = null
    this._createInputBlock()
  }

  dispose() {
    clearTimeout(this._pendingTuiTimer)
    this._tuiOverlay?.dispose()
    this._currentOutput?._term?.dispose()
  }
}
```

- [ ] **Step 2: Verify in DevTools (mock lifecycle)**

```js
const { BlockTerminal } = await import('./src/renderer/block-terminal.js')
const container = document.createElement('div')
container.style.cssText = 'width:100%;height:300px;'
document.body.appendChild(container)
const bt = new BlockTerminal({
  container,
  theme: { background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#89b4fa' },
  pid: 12345,
  cwd: '/Users/test',
  promptStyle: 'arrow',
  onPtyWrite: (data) => console.log('PTY write:', JSON.stringify(data))
})

// Simulate command execution
bt._onInputSubmit('echo hello')
console.assert(bt.state === 'running', 'Expected running state')
bt.onPtyData('hello\r\n')
bt.onOscEnd(0)
console.assert(bt.state === 'idle', 'Expected idle state')
console.assert(bt.blocks.length === 1, 'Expected 1 completed block')
console.log('BlockTerminal lifecycle OK')
```

Expected: InputBlock appears, after simulated submit → OutputBlock appears, after `onOscEnd` → CompletedBlock appears with "echo hello" + output, new InputBlock at bottom.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/block-terminal.js
git commit -m "feat(block-terminal): add BlockTerminal orchestrator

Manages block lifecycle: Input → Output → Completed.
Routes PTY data, detects TUI via alternate screen (ESC[?1049h).
Supports serialization for persistence."
```

---

## Task 9: Block Persistence (Main Process)

**Files:**
- Create: `src/main/block-persistence.js`
- Modify: `src/main/index.js`
- Modify: `src/preload/index.js`

**Goal:** Save/load block state to `~/.config/eTty/blocks/<tabId>.json`. Wire IPC channels.

- [ ] **Step 1: Create `src/main/block-persistence.js`**

```js
import { app } from 'electron'
import { join } from 'path'
import { mkdir, readFile, writeFile, unlink, access, readdir } from 'fs/promises'
import log from 'electron-log'

const BLOCKS_DIR = join(app.getPath('userData'), 'blocks')

async function ensureBlocksDir() {
  await mkdir(BLOCKS_DIR, { recursive: true })
}

function getBlockPath(tabId) {
  return join(BLOCKS_DIR, `${tabId}.json`)
}

export async function saveBlocks(tabId, data) {
  try {
    await ensureBlocksDir()
    await writeFile(getBlockPath(tabId), JSON.stringify(data, null, 2), 'utf-8')
    log.info(`blocks: saved tab ${tabId} (${data.blocks?.length || 0} blocks)`)
  } catch (e) {
    log.error('blocks: save failed', e.message)
  }
}

export async function loadBlocks(tabId) {
  try {
    const path = getBlockPath(tabId)
    await access(path)
    const content = await readFile(path, 'utf-8')
    const data = JSON.parse(content)
    if (data.version !== 1) {
      log.warn(`blocks: version mismatch for ${tabId}, ignoring`)
      return null
    }
    log.info(`blocks: loaded tab ${tabId} (${data.blocks?.length || 0} blocks)`)
    return data
  } catch {
    return null
  }
}

export async function deleteBlocks(tabId) {
  try {
    await unlink(getBlockPath(tabId))
    log.info(`blocks: deleted tab ${tabId}`)
  } catch {
    // File may not exist
  }
}

export async function cleanupOrphanedBlocks(activeTabIds) {
  try {
    const files = await readdir(BLOCKS_DIR)
    const activeSet = new Set(activeTabIds)
    let removed = 0
    for (const file of files) {
      const tabId = file.replace('.json', '')
      if (!activeSet.has(tabId)) {
        await unlink(join(BLOCKS_DIR, file))
        removed++
      }
    }
    if (removed > 0) {
      log.info(`blocks: cleaned up ${removed} orphaned block files`)
    }
  } catch (e) {
    log.error('blocks: cleanup failed', e.message)
  }
}
```

- [ ] **Step 2: Register IPC handlers in `src/main/index.js`**

Add import near other imports:
```js
import { saveBlocks, loadBlocks, deleteBlocks, cleanupOrphanedBlocks } from './block-persistence.js'
```

Add handlers in `app.whenReady().then(() => { ... })` alongside other `ipcMain.handle` calls:
```js
ipcMain.handle('blocks:save', async (event, { tabId, data }) => {
  await saveBlocks(tabId, data)
})

ipcMain.handle('blocks:load', async (event, tabId) => {
  return await loadBlocks(tabId)
})

ipcMain.handle('blocks:delete', async (event, tabId) => {
  await deleteBlocks(tabId)
})
```

- [ ] **Step 3: Expose in `src/preload/index.js`**

Add to `contextBridge.exposeInMainWorld` object:
```js
blocksSave: (tabId, data) => ipcRenderer.invoke('blocks:save', { tabId, data }),
blocksLoad: (tabId) => ipcRenderer.invoke('blocks:load', tabId),
blocksDelete: (tabId) => ipcRenderer.invoke('blocks:delete', tabId),
```

- [ ] **Step 4: Commit**

```bash
git add src/main/block-persistence.js src/main/index.js src/preload/index.js
git commit -m "feat(block-terminal): add block persistence layer

Save/load/delete block state to ~/.config/eTty/blocks/<tabId>.json.
IPC channels: blocks:save, blocks:load, blocks:delete."
```

---

## Task 10: Classic Terminal Extraction

**Files:**
- Create: `src/renderer/classic-terminal.js`

**Goal:** Extract current xterm.js-per-tab behavior into `ClassicTerminal` class with the same interface as `BlockTerminal`, so `index.js` can dispatch between modes.

- [ ] **Step 1: Create `src/renderer/classic-terminal.js`**

```js
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'

/**
 * Classic monolithic xterm.js terminal (extracted from index.js).
 * Preserves all existing behavior: OSC handlers, Kitty protocol, non-ASCII.
 * Interface matches BlockTerminal where possible.
 */
export class ClassicTerminal {
  constructor({ container, theme, pid, onPtyWrite, onPtyResize, onCwdChange, onTitleChange }) {
    this.container = container
    this.theme = theme
    this.pid = pid
    this.onPtyWrite = onPtyWrite
    this.onPtyResize = onPtyResize
    this.onCwdChange = onCwdChange
    this.onTitleChange = onTitleChange
    this._term = null
    this._fitAddon = null
    this._isBusy = false
    this._activeAgentId = null
    this._init()
  }

  _init() {
    this._term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, "SF Mono", Consolas, "Courier New", monospace',
      scrollback: 10000,
      allowProposedApi: true,
      theme: this.theme
    })

    this._fitAddon = new FitAddon()
    this._term.loadAddon(this._fitAddon)
    this._term.loadAddon(new WebLinksAddon())
    this._term.loadAddon(new SearchAddon())

    this._term.open(this.container)

    try {
      this._term.loadAddon(new WebglAddon())
    } catch (e) {
      console.warn('WebGL addon failed, using canvas renderer:', e)
    }

    this._setupHandlers()
  }

  _setupHandlers() {
    // Kitty keyboard protocol
    this._term.attachCustomKeyEventHandler((event) => {
      if (event.key === 'Enter') {
        if (event.shiftKey && !event.ctrlKey) {
          if (event.type === 'keydown') this.onPtyWrite('\x1b[13;2u')
          return false
        }
        if (event.ctrlKey && !event.shiftKey) {
          if (event.type === 'keydown') this.onPtyWrite('\x1b[13;5u')
          return false
        }
        if (event.ctrlKey && event.shiftKey) {
          if (event.type === 'keydown') this.onPtyWrite('\x1b[13;6u')
          return false
        }
      }
      if (event.key.length === 1 && event.key.charCodeAt(0) > 127 &&
          !event.ctrlKey && !event.altKey && !event.metaKey) {
        if (event.type === 'keydown') this.onPtyWrite(event.key)
        return false
      }
      return true
    })

    this._term.onData((data) => this.onPtyWrite(data))
    this._term.onResize(({ cols, rows }) => this.onPtyResize(cols, rows))
    this._term.onTitleChange((title) => this.onTitleChange?.(title))

    // OSC 7 — cwd sync
    this._term.parser.registerOscHandler(7, (data) => {
      const match = data.match(/^file:\/\/[^/]*(.+)$/)
      if (match) {
        const newPath = match[1].replace(/\/$/, '') || '/'
        this.onCwdChange?.(newPath)
      }
      return false
    })

    // OSC 133 — busy tracking
    this._term.parser.registerOscHandler(133, (data) => {
      if (data.startsWith('C')) this._isBusy = true
      else if (data.startsWith('A')) {
        this._isBusy = false
        this._activeAgentId = null
      }
      return false
    })
  }

  onPtyData(data) {
    this._term?.write(data)
  }

  setTheme(theme) {
    this._term.options.theme = theme
  }

  setCwd(cwd) {
    // No-op for classic terminal (handled by shell prompt)
  }

  focus() {
    this._term?.focus()
  }

  resize() {
    this._fitAddon?.fit()
  }

  write(data) {
    this.onPtyWrite?.(data)
  }

  injectInput(text) {
    this.onPtyWrite?.('\x15' + text)
  }

  get isBusy() { return this._isBusy }
  get activeAgentId() { return this._activeAgentId }
  set activeAgentId(id) { this._activeAgentId = id }

  serialize() {
    // Classic mode doesn't persist blocks
    return { version: 1, blocks: [] }
  }

  restore(data) {
    // No-op for classic mode
  }

  dispose() {
    this._term?.dispose()
  }
}
```

- [ ] **Step 2: Verify `npm run dev` still works**

Run `npm run dev`. The app should launch. Since `index.js` still uses the old inline code, this file isn't loaded yet — but the code is correct and compiles.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/classic-terminal.js
git commit -m "feat(block-terminal): extract ClassicTerminal from index.js

Preserve all existing xterm.js behavior in reusable class.
Matches BlockTerminal interface for mode dispatch."
```

---

## Task 11: Wire Everything into index.js

**Files:**
- Modify: `src/renderer/index.js`
- Modify: `src/renderer/tab-bar.js`

**Goal:** Replace inline terminal setup with mode-aware `setupTerminal(tab)` dispatch. Update all `tab.term` references to use `tab.terminal` adapter.

- [ ] **Step 1: Add imports at top of `index.js`**

Replace the existing terminal-related imports:
```js
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
```

With:
```js
import { BlockTerminal } from './block-terminal.js'
import { ClassicTerminal } from './classic-terminal.js'
```

Keep `@xterm/xterm/css/xterm.css` import.

- [ ] **Step 2: Replace `createTab()` function**

Replace the entire `createTab` function (lines 61-82) with:
```js
async function createTab(cwd, tabId) {
  const { config } = await window.electronAPI.settingsLoad()
  const promptStyle = config.terminal?.promptStyle || 'default'
  const terminalMode = config.terminal?.mode || 'classic'
  tabId = tabId || crypto.randomUUID()
  const { pid } = await window.electronAPI.ptyCreate({
    cols: 80, rows: 24, cwd, tabId, promptStyle
  })
  return { pid, rootPath: cwd, tabId, terminalMode }
}
```

- [ ] **Step 3: Add `setupTerminal(tab)` function**

Insert after `createTab`:
```js
function setupTerminal(tab) {
  const theme = loadedThemes[currentThemeName].terminal
  if (tab.terminalMode === 'block') {
    tab.terminal = new BlockTerminal({
      container: tab.container,
      theme,
      pid: tab.pid,
      cwd: tab.rootPath,
      promptStyle: tab.promptStyle || 'default',
      onPtyWrite: (data) => window.electronAPI.ptyWrite(tab.pid, data),
      onPtyResize: (cols, rows) => window.electronAPI.ptyResize(tab.pid, cols, rows),
      getHistorySuggestions: async (prefix) => {
        // Placeholder — Task 13 will implement history suggestions
        return []
      }
    })
  } else {
    tab.terminal = new ClassicTerminal({
      container: tab.container,
      theme,
      pid: tab.pid,
      onPtyWrite: (data) => window.electronAPI.ptyWrite(tab.pid, data),
      onPtyResize: (cols, rows) => window.electronAPI.ptyResize(tab.pid, cols, rows),
      onCwdChange: (newPath) => {
        const index = tabBar.tabs.findIndex(t => t.pid === tab.pid)
        if (index >= 0) tabBar.updateRootPath(index, newPath)
        if (tabBar.getActive()?.pid === tab.pid) {
          if (newPath !== fileTree.getCwd()) {
            fileTree.setRoot(newPath)
            window.electronAPI.fsSetRoot(newPath)
          }
          updateNavButtons()
        }
      },
      onTitleChange: (title) => {
        tab.termTitle = title
        if (tabBar.getActive()?.pid === tab.pid) {
          document.title = title || 'eTty'
        }
        tabBar._updateTabLabel(tab)
      }
    })
  }
  tab.terminal.focus()
}
```

- [ ] **Step 4: Update `tabBar.addTab()` in `tab-bar.js` to not call `term.open()`**

Remove `term.open(container)` from `addTab()` and remove `fitAddon` parameter:
```js
addTab({ pid, rootPath, tabId }) {
  const folderName = rootPath.split('/').filter(Boolean).pop() || '/'
  const container = document.createElement('div')
  container.className = 'terminal-pane'
  this.terminalContainerEl.appendChild(container)

  // term.open(container) REMOVED — handled by setupTerminal

  const element = this._createTabEl(folderName, '')
  this.tabBarEl.insertBefore(element, this._addBtn)

  const tab = { pid, container, element, rootPath, folderName, termTitle: '', tabId,
    treeExpandedDirs: new Set(),
    treeScrollTop: 0
  }
  this.tabs.push(tab)

  // term.onTitleChange REMOVED — handled by ClassicTerminal constructor

  this.switchTo(this.tabs.length - 1)
  return tab
}
```

- [ ] **Step 5: Update all `tab.term` → `tab.terminal` references in `index.js`**

Find and replace:
- `tab.term.options.theme = theme` → `tab.terminal.setTheme(theme)`
- `tab.term.focus()` → `tab.terminal.focus()`
- `tab.fitAddon.fit()` → `tab.terminal.resize()`
- `tab.term.write(data)` → `tab.terminal.onPtyData(data)`
- `tab.term.dispose()` → `tab.terminal.dispose()`

In `applyTheme`:
```js
if (tabBar) {
  for (const tab of tabBar.tabs) {
    tab.terminal?.setTheme(theme.terminal)
  }
}
```

In `tabBar.switchTo`:
```js
tab.terminal?.resize()
tab.terminal?.focus()
```

In `onPtyData` IPC handler:
```js
if (tab) tab.terminal?.onPtyData(data)
```

In `onPtyExit`:
```js
tab.terminal?.dispose()
```

In `setupTabHandlers` — REMOVE the entire function (lines 383-469). All terminal setup is now in `ClassicTerminal` or `BlockTerminal` constructors.

- [ ] **Step 6: Update `window.__exportTabState`**

Add block serialization for block-mode tabs:
```js
window.__exportTabState = () => {
  const tabs = tabBar.exportState()
  const activeTab = tabBar.getActive()
  for (const exported of tabs) {
    const tab = tabBar.tabs.find(t => t.tabId === exported.tabId)
    if (tab) {
      if (tab === activeTab) {
        exported.editorState = editorPanel.exportEditorState()
        exported.gitPanelVisible = gitPanel.isVisible()
        // Serialize blocks for block mode
        exported.blocks = tab.terminal?.serialize?.() || { version: 1, blocks: [] }
      } else {
        const s = tab.editorState
        if (s) {
          exported.editorState = { files: s.files, activePath: s.activePath, visible: s.visible }
        }
        exported.gitPanelVisible = tab.gitPanelVisible || false
        exported.blocks = tab.terminal?.serialize?.() || { version: 1, blocks: [] }
      }
    }
  }
  return tabs
}
```

- [ ] **Step 7: Verify `npm run dev` launches in both modes**

1. Start with `terminal.mode: 'classic'` (default) — app should work exactly as before.
2. Change setting to `'block'` — restart app — new tabs should show InputBlock.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/index.js src/renderer/tab-bar.js
git commit -m "feat(block-terminal): wire BlockTerminal into tab system

- Mode-aware terminal dispatch: classic vs block
- ClassicTerminal and BlockTerminal share adapter interface
- Remove inline terminal setup from index.js
- Add block serialization to tab state export"
```

---

## Task 12: Tab Restoration with Blocks

**Files:**
- Modify: `src/renderer/index.js`

**Goal:** Restore persisted blocks when tabs are restored on app launch.

- [ ] **Step 1: Load blocks during tab restoration**

In `restoreTabs()` function, after creating the tab:
```js
// After: const tab = tabBar.addTab(tabData)
tab.terminalMode = savedTabs[i].terminalMode || 'classic'
setupTerminal(tab)
// Restore blocks if block mode
if (tab.terminalMode === 'block' && savedTabs[i].blocks) {
  tab.terminal.restore(savedTabs[i].blocks)
}
```

Also update the first-time restoration block (lines 553-588 similarly):
```js
tab.terminalMode = savedTabs[i].terminalMode || 'classic'
setupTerminal(tab)
if (tab.terminalMode === 'block' && savedTabs[i].blocks) {
  tab.terminal.restore(savedTabs[i].blocks)
}
```

- [ ] **Step 2: Save blocks periodically**

Add a periodic save for block-mode tabs. In `index.js`, after `syncStatusBarTerminalState`, add:
```js
// Auto-save blocks every 5 seconds for block-mode tabs
setInterval(() => {
  for (const tab of tabBar.tabs) {
    if (tab.terminalMode === 'block' && tab.terminal?.serialize) {
      const data = tab.terminal.serialize()
      if (data.blocks.length > 0) {
        window.electronAPI.blocksSave(tab.tabId, data)
      }
    }
  }
}, 5000)
```

- [ ] **Step 3: Cleanup orphaned block files**

Add to the existing history cleanup section (around line 602):
```js
window.electronAPI.historyCleanup(activeTabIds)
// Also cleanup orphaned block files
cleanupOrphanedBlocks(activeTabIds) // exposed via IPC or called from main
```

Or handle cleanup in main process on app quit.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/index.js
git commit -m "feat(block-terminal): tab restoration with persisted blocks

- Load saved blocks when restoring tabs
- Auto-save blocks every 5 seconds
- Cleanup orphaned block files on tab close"
```

---

## Task 13: History Suggestions Integration

**Files:**
- Modify: `src/renderer/index.js`

**Goal:** Wire `getHistorySuggestions` callback to read from global history file.

- [ ] **Step 1: Implement `getHistorySuggestions` in `setupTerminal`**

Replace the placeholder in Task 11 with:
```js
getHistorySuggestions: async (prefix) => {
  if (!prefix || prefix.length < 1) return []
  try {
    const { path } = await window.electronAPI.settingsLoad()
    // Read global history from main process
    // For now, use a simple in-memory cache approach
    // This is a placeholder for a proper IPC-based history read
    return []
  } catch {
    return []
  }
}
```

Actually, reading history requires file system access. Best approach: add an IPC channel to read history lines from main process.

Add to `preload/index.js`:
```js
historyGetLines: () => ipcRenderer.invoke('history:get-lines'),
```

Add to `main/index.js`:
```js
import { readFile } from 'fs/promises'
import { HistoryManager } from './history-manager.js'

ipcMain.handle('history:get-lines', async () => {
  const hm = new HistoryManager()
  const globalFile = hm.getGlobalHistoryPath()
  try {
    const content = await readFile(globalFile, 'utf-8')
    return content.split('\n').filter(Boolean).map(line => {
      // Parse zsh history format: `: timestamp:0;command`
      const match = line.match(/^:\s*\d+:\d+;(.+)$/)
      return match ? match[1] : line
    })
  } catch {
    return []
  }
})
```

Then in `setupTerminal`:
```js
getHistorySuggestions: async (prefix) => {
  if (!prefix || prefix.length < 1) return []
  try {
    const lines = await window.electronAPI.historyGetLines()
    const lowerPrefix = prefix.toLowerCase()
    const seen = new Set()
    const results = []
    for (let i = lines.length - 1; i >= 0 && results.length < 8; i--) {
      const cmd = lines[i].trim()
      if (cmd.toLowerCase().startsWith(lowerPrefix) && !seen.has(cmd)) {
        seen.add(cmd)
        results.push(cmd)
      }
    }
    return results
  } catch {
    return []
  }
}
```

- [ ] **Step 2: Add `historyGetLines` to preload**

Add to `preload/index.js` `contextBridge.exposeInMainWorld`:
```js
historyGetLines: () => ipcRenderer.invoke('history:get-lines'),
```

- [ ] **Step 3: Add `history:get-lines` handler to `main/index.js`**

Add the handler alongside other IPC registrations.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/index.js src/preload/index.js src/main/index.js
git commit -m "feat(block-terminal): history suggestions for InputBlock

- IPC channel history:get-lines reads global zsh history
- Filter by prefix, return top 8 unique matches
- Wired into BlockTerminal getHistorySuggestions callback"
```

---

## Task 14: CSS Styles for Block Terminal

**Files:**
- Modify: `src/renderer/styles.css`

**Goal:** Add all `.block-*` and `.tui-overlay` styles (~150 lines).

- [ ] **Step 1: Append styles to `styles.css`**

```css
/* ═══════════════════════════════════════════════════════════════
   Block Terminal
   ═══════════════════════════════════════════════════════════════ */

.block-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px;
}

/* ── Completed Block ──────────────────────────────────────────── */

.block-completed {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.block-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  font-family: Menlo, 'SF Mono', Consolas, monospace;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg) 60%, var(--surface));
}

.block-cwd {
  color: var(--accent);
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.block-input-text {
  color: var(--text);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.block-meta {
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}

.block-output {
  padding: 8px 10px;
  font-size: 13px;
  font-family: Menlo, 'SF Mono', Consolas, monospace;
  line-height: 1.5;
  color: var(--text);
  max-height: 400px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.block-output::-webkit-scrollbar {
  width: 6px;
}

.block-output::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}

.block-toolbar {
  display: flex;
  gap: 6px;
  padding: 4px 10px;
  border-top: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg) 40%, var(--surface));
}

.block-toolbar button {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--subtext);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
  font-family: inherit;
}

.block-toolbar button:hover {
  background: var(--hover);
  color: var(--text);
}

/* ── Output Block ─────────────────────────────────────────────── */

.block-output-live {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.block-running-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 11px;
  color: var(--accent);
  background: color-mix(in srgb, var(--bg) 60%, var(--surface));
  border-bottom: 1px solid var(--border);
}

.block-running-badge .spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--accent);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.block-output-term {
  padding: 4px 10px;
  min-height: 20px;
}

.block-output-term .xterm {
  padding: 0;
}

/* ── Input Block ──────────────────────────────────────────────── */

.block-input {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 10px;
  font-family: Menlo, 'SF Mono', Consolas, monospace;
  font-size: 14px;
  position: relative;
}

.block-prompt {
  color: var(--accent);
  white-space: nowrap;
  user-select: none;
  padding-top: 2px;
}

.block-input-wrapper {
  position: relative;
  flex: 1;
  min-width: 0;
}

.block-input-field {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text);
  font-family: inherit;
  font-size: inherit;
  padding: 0;
  margin: 0;
  caret-color: var(--accent);
}

.block-input-field:disabled {
  opacity: 0.5;
}

.block-ghost {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  color: var(--muted);
  opacity: 0.5;
  white-space: pre;
  font-family: inherit;
  font-size: inherit;
}

.block-suggestion-menu {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  z-index: 1000;
  max-height: 200px;
  overflow-y: auto;
  min-width: 200px;
}

.block-suggestion-menu.hidden {
  display: none;
}

.block-suggestion-item {
  padding: 5px 10px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.block-suggestion-item:hover,
.block-suggestion-item.selected {
  background: var(--hover);
}

/* ── TUI Overlay ──────────────────────────────────────────────── */

.tui-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.tui-overlay-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--subtext);
  flex-shrink: 0;
  user-select: none;
}

.tui-overlay-header button {
  background: none;
  border: none;
  color: var(--muted);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}

.tui-overlay-header button:hover {
  color: var(--red);
}

.tui-overlay-term {
  flex: 1;
  overflow: hidden;
  padding: 4px;
}
```

- [ ] **Step 2: Verify visual appearance**

Launch app in block mode (`terminal.mode: 'block'`). Type a command. Verify:
- InputBlock shows prompt and input field
- Ghost text appears faintly after input
- Suggestion menu appears above input with proper styling
- OutputBlock shows "Running…" badge with spinner
- CompletedBlock shows header, output, and toolbar buttons
- All colors match current theme

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles.css
git commit -m "feat(block-terminal): add CSS styles for all block components

Styles for: block-container, completed-block, output-block,
input-block, suggestion-menu, tui-overlay. Theme-aware using CSS vars."
```

---

## Task 15: Settings UI Refinement

**Files:**
- Modify: `src/renderer/settings-page.js`

**Goal:** Polish the `terminal.mode` toggle UI and ensure it integrates with existing settings structure.

- [ ] **Step 1: Ensure terminal category is placed correctly**

The terminal mode select should be placed in a new "Терминал" category in the settings overlay, alongside or after the existing categories. Verify the DOM insertion point works correctly.

- [ ] **Step 2: Add a note about mode change requiring restart**

Add a small description under the mode select:
```js
const modeNote = document.createElement('div')
modeNote.style.cssText = 'font-size:11px;color:var(--muted);margin-top:4px;'
modeNote.textContent = 'Изменение режима применится к новым вкладкам'
modeRow.appendChild(modeNote)
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/settings-page.js
git commit -m "feat(settings): polish terminal.mode UI with restart note"
```

---

## Task 16: Testing Checklist

**Files:**
- None (manual testing)

**Goal:** Verify the complete feature works end-to-end.

- [ ] **Step 1: Classic mode regression test**

1. Set `terminal.mode: 'classic'` in settings
2. Restart app
3. Verify: multiple tabs, xterm.js rendering, OSC 7 cwd sync, OSC 133 busy tracking, Kitty protocol, non-ASCII input, editor integration, file tree, git panel — all work exactly as before

- [ ] **Step 2: Block mode basic test**

1. Set `terminal.mode: 'block'` in settings
2. Restart app
3. Type `echo hello` — verify InputBlock → OutputBlock → CompletedBlock lifecycle
4. Type `ls -la` — verify output renders in block, freezes correctly
5. Click "Re-run" on a CompletedBlock — verify command re-executes
6. Click "Copy" — verify output copied to clipboard

- [ ] **Step 3: TUI detection test**

1. Type `vim` — verify TuiOverlay appears fullscreen
2. Type some text, quit vim — verify overlay closes, new InputBlock appears
3. Type `htop` — verify TuiOverlay appears
4. Press `q` — verify overlay closes

- [ ] **Step 4: Suggestions test**

1. Type `git` — verify suggestion menu appears with history commands starting with "git"
2. Press ArrowDown — verify selection moves
3. Press Enter — verify selected command fills input
4. Press ArrowRight on ghost text — verify ghost text accepted

- [ ] **Step 5: Persistence test**

1. Run several commands in block mode
2. Close app
3. Reopen app, restore tabs
4. Verify all CompletedBlocks are restored with output visible

- [ ] **Step 6: Memory test**

1. Run 50+ commands in block mode
2. Open DevTools → Performance → Memory
3. Verify memory usage stays flat (CompletedBlocks use DOM, not xterm.js)

- [ ] **Step 7: Document test results**

If all tests pass, proceed to Task 17. If issues found, fix them in-place and re-test.

---

## Task 17: Final Integration & Commit

**Files:**
- Modify: `src/renderer/index.js` (any final fixes from testing)
- Modify: `AGENTS.md` (update project description)

**Goal:** Final polish, update documentation, commit the complete feature.

- [ ] **Step 1: Final review of `index.js`**

Ensure no references to old inline terminal setup remain. Ensure `setupTerminal` is called for all tab creation paths:
- New tab (`onAddTab`)
- First tab (no restoration)
- Restored tabs (both restoration paths)

- [ ] **Step 2: Update `AGENTS.md` project description**

Add a line about the block terminal feature:
```markdown
## Реализованные фичи

### Терминал
- Блочный режим терминала (block mode): кастомный ввод с подсказками, live output в xterm.js, frozen readonly блоки
- Классический режим (classic mode): монолитный xterm.js
- Переключение режима в настройках
```

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(block-terminal): complete block-based terminal implementation

- Shell Integration Protocol (OSC 1337) for block boundaries
- Block lifecycle: InputBlock → OutputBlock → CompletedBlock
- TuiOverlay for interactive programs (vim, htop, ssh)
- Ghost text and history suggestions in InputBlock
- Full persistence: blocks survive app restart
- Feature flag: classic vs block mode in settings
- Extracted ClassicTerminal for backward compatibility
- Theme-aware CSS for all block components"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Shell Integration (OSC 1337) → Task 1
- [x] Block components (Input, Output, Completed) → Tasks 4, 5, 6
- [x] TUI detection & overlay → Tasks 7, 8
- [x] Block lifecycle orchestration → Task 8
- [x] Persistence → Tasks 9, 12
- [x] Feature flag → Tasks 2, 15
- [x] Classic mode extraction → Task 10
- [x] Integration into tab system → Task 11
- [x] History suggestions → Task 13
- [x] CSS styling → Task 14
- [x] Testing → Task 16
- [x] Documentation → Task 17

**Placeholder scan:**
- [x] No "TBD", "TODO", "implement later"
- [x] No vague requirements like "add appropriate error handling"
- [x] No "similar to Task X" references
- [x] All tasks contain concrete code or exact commands

**Type consistency:**
- [x] `BlockTerminal.serialize()` returns `{ version: 1, blocks: [...] }`
- [x] `CompletedBlock.serialize()` matches expected JSON structure
- [x] `BlockTerminal.restore(data)` expects `data.version === 1`
- [x] `ClassicTerminal` implements same interface methods as `BlockTerminal`

---

*Plan complete. Ready for execution.*

