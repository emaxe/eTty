# Block-Based Terminal — Design Specification

**Date:** 2026-04-26
**Feature:** Block Terminal (Shell Integration Protocol)
**Status:** Draft (pending review)

---

## 1. Goal

Replace the current monolithic xterm.js terminal with a **block-based interface**: each shell command becomes a distinct visual block with custom input (ghost text, suggestions, rich UI) before execution, live xterm.js output during execution, and a frozen readonly block after completion. Interactive TUI programs (vim, htop, ssh) run in a fullscreen xterm.js overlay.

All blocks and their outputs are **persisted** across application restorations.

---

## 2. Background & Context

eTty is an Electron terminal wrapper using:
- **xterm.js** + **WebGL addon** for terminal rendering
- **node-pty** for PTY sessions (zsh)
- **Electron 33** + **electron-vite**
- Multiple tabs with per-tab state persistence (tabs-state.json)
- OSC 133 for shell busy tracking (preexec/precmd hooks already in place)
- History manager with global + per-tab zsh history files

Current architecture: one PTY per tab, raw xterm.js in a `<div>`, all interaction goes through xterm.js canvas.

---

## 3. Architecture Overview

### 3.1 Two-Layer Model

| Layer | Responsibility |
|-------|---------------|
| **Shell Layer** | zsh hooks inject OSC sequences to mark block boundaries |
| **App Layer** | Renderer parses OSC, builds DOM blocks, routes PTY output |

### 3.2 Block Lifecycle

```
[Input Block]  → Enter  →  [Output Block]  →  Command ends  →  [Completed Block]
   (DOM input)              (live xterm.js)                   (frozen DOM)
        ↑                                                        |
        └────────────────  New Input Block appears below ──────────┘
```

### 3.3 TUI Mode (Fullscreen Overlay)

When an interactive program starts, the renderer detects it and opens a **fullscreen xterm.js overlay** on top of the block stack. When the program exits, the overlay closes and control returns to block mode.

---

## 4. Shell Integration (zsh Hooks)

### 4.1 Existing: OSC 133

Already implemented in `pty-manager.js` via `PROMPT_COMMAND` injection:
- `OSC 133; A` — prompt start (precmd)
- `OSC 133; C` — command start (preexec)
- `OSC 133; D` — command finish with exit code (precmd)

### 4.2 New: OSC 1337 (eTty Block Protocol)

We introduce a private OSC sequence (`1337`) for block metadata. These sequences are **never displayed** — they carry data.

```
OSC 1337;Start=<json> ST
```

JSON payload (URL-encoded):
```json
{
  "blockId": "<uuid>",
  "input": "git status",
  "cwd": "/Users/maksim/Projects/eTty"
}
```

```
OSC 1337;End=<json> ST
```

JSON payload:
```json
{
  "blockId": "<uuid>",
  "exitCode": 0,
  "durationMs": 1250
}
```

### 4.3 Hook Script Injection

`pty-manager.js` injects the following into every new zsh session (via `ZDOTDIR` or env var pointing to a temp dir with `.zshrc`):

```zsh
# Block boundary tracking
preexec() {
  local input="${1//%/%%}"  # Escape % for printf
  printf '\033]133;C\007'
  printf '\033]1337;Start=%s\007' "$(printf '%s' "$input" | base64)"
}

precmd() {
  local last_status=$?
  printf '\033]133;D;%s\007' "$last_status"
  printf '\033]1337;End=%s\007' "$(printf '%s' "$last_status" | base64)"
}

# Keep existing eTty hooks (OSC 7, OSC 133 A)
```

**Note:** The renderer generates `blockId` and passes it to the shell via an env var (`ETTY_BLOCK_ID`), so the shell hook echoes it back in `Start`.

---

## 5. Renderer Components

### 5.1 `BlockTerminal` (`src/renderer/block-terminal.js`)

Orchestrator per tab. Owns:
- A scrollable DOM container (replaces `#terminal-container` children)
- The PTY session reference
- The list of blocks
- State: `idle` | `running` | `tui`

**Key methods:**
- `onPtyData(data)` — routes output to active Output Block or TUI overlay
- `onOscStart(blockId, input, cwd)` — creates Output Block
- `onOscEnd(blockId, exitCode)` — freezes Output → Completed, creates new Input Block
- `onTuiDetected()` — opens TuiOverlay, hides block container
- `onTuiClosed()` — closes TuiOverlay, shows block container
- `serialize()` → JSON for persistence
- `restore(json)` → rebuilds blocks from JSON

### 5.2 `InputBlock` (`src/renderer/input-block.js`)

Custom DOM component for command entry:

```html
<div class="block-input">
  <span class="block-prompt">~/Projects/eTty $</span>
  <input class="block-input-field" type="text" />
  <span class="block-ghost">git status</span>  <!-- ghost text overlay -->
</div>
```

**Features:**
- Prompt string synced from shell (via `OSC 133; A` parsing or cached)
- `<input>` for user typing
- Ghost text: semi-transparent suffix showing top suggestion
- Suggestion menu: absolutely-positioned dropdown above the input line
- `ArrowRight` — accept ghost text (fill to end)
- `ArrowUp/Down` — navigate suggestion menu
- `Enter` — submit command to PTY, create Output Block
- `Ctrl+C` — send SIGINT to PTY (cancel current input)
- History suggestions sourced from `HistoryManager` via IPC

**Positioning:** Input Block is always the last child in the scroll container.

### 5.3 `OutputBlock` (`src/renderer/output-block.js`)

Live terminal output during command execution:
- Owns an **xterm.js Terminal instance** in a `<div>`
- Receives all PTY `onData` while command is running
- Shows a small status badge: "Running…" + spinner
- Height auto-grows up to `maxOutputHeight` (e.g., 400px), then scrollable internally

**Lifecycle:**
1. Created on `OSC 1337;Start`
2. Receives PTY data via `write(data)`
3. On `OSC 1337;End` — triggers freeze

### 5.4 `CompletedBlock` (`src/renderer/completed-block.js`)

Frozen, readonly DOM block after command finishes:

```html
<div class="block-completed">
  <div class="block-header">
    <span class="block-cwd">~/Projects/eTty</span>
    <span class="block-input-text">git status</span>
    <span class="block-meta">0.8s · exit 0</span>
  </div>
  <div class="block-output">
    <!-- Rendered output: ANSI → HTML -->
  </div>
  <div class="block-toolbar">
    <button>Copy</button>
    <button>Re-run</button>
    <button>Clear Output</button>
  </div>
</div>
```

**Output rendering:**
- On freeze: serialize xterm.js buffer to **plain text + ANSI escape sequences**
- Render via lightweight `ansi-to-html` parser (no full xterm.js needed)
- Supports colors, bold, underline — enough for 95% of CLI output
- For complex output (tables, progress bars that overwrite lines), store raw text representation

### 5.5 `TuiOverlay` (`src/renderer/tui-overlay.js`)

Fullscreen xterm.js overlay for interactive programs:
- `<div class="tui-overlay">` positioned `fixed; inset: 0; z-index: 1000`
- Contains one xterm.js Terminal instance
- Receives all PTY data while active
- **Close button** in top-right corner (or `Escape` when not in raw mode)
- On close: sends `Ctrl+D` or `q` or `SIGINT` depending on program (heuristic)

**Lifecycle:**
1. TUI detected → overlay fades in (200ms)
2. Program exits (OSC 133 D with exit code, no alternate screen) → overlay fades out
3. Control returns to BlockTerminal, new Input Block appears

---

## 6. TUI Detection (Variant E)

Three-tier detection, evaluated in order:

### Tier 1: Alternate Screen Buffer (Primary)

Monitor PTY output for:
- `ESC [ ? 1049 h` — enter alternate screen
- `ESC [ ? 1049 l` — leave alternate screen

On enter: immediately switch to TUI overlay.
On leave: return to block mode.

**Implementation:** xterm.js parser hook or raw string scan in `BlockTerminal.onPtyData()`.

### Tier 2: Cursor Hide + No Prompt (Secondary)

If Tier 1 not triggered within 500ms after `OSC 133; C`:
- Check for `ESC [ ? 25 l` (hide cursor)
- AND no `OSC 133; D` received within 500ms
- → Switch to TUI overlay

### Tier 3: Whitelist (Fallback)

If command input matches whitelist (case-insensitive prefix match):
- `vim`, `nvim`, `vi`
- `nano`, `emacs`, `micro`
- `htop`, `btop`, `top`
- `less`, `more`
- `ssh` (if no args, or any args)
- `git rebase -i`, `git add -p`
- `tmux`, `screen`

→ Proactively switch to TUI overlay on `Enter`, before output starts.

**Return from TUI:** When `ESC [ ? 1049 l` is seen, OR when `OSC 133; D` arrives, close overlay.

---

## 7. Data Flow

### 7.1 Normal Command

```
User types in InputBlock
        ↓ Enter
InputBlock sends command + newline to PTY via IPC
        ↓
preexec hook runs → OSC 133 C + OSC 1337 Start
        ↓
BlockTerminal.onOscStart():
  - Disables InputBlock (readonly)
  - Creates OutputBlock with xterm.js
  - Sets state = 'running'
        ↓
PTY data flows to OutputBlock.xterm.write()
        ↓
Command finishes
        ↓
precmd hook runs → OSC 133 D + OSC 1337 End
        ↓
BlockTerminal.onOscEnd():
  - Freezes OutputBlock:
    - Serialize xterm buffer → text+ANSI
    - Destroy xterm instance
    - Replace with CompletedBlock DOM
  - Creates new InputBlock at bottom
  - Sets state = 'idle'
  - Saves block snapshot to persistence
```

### 7.2 TUI Program

```
User types 'vim' in InputBlock
        ↓ Enter
InputBlock sends 'vim\n' to PTY
        ↓
Whitelist match OR alternate screen detected
        ↓
BlockTerminal.onTuiDetected():
  - Creates TuiOverlay (fullscreen xterm.js)
  - Sets state = 'tui'
  - Hides block container (or dims it)
        ↓
All PTY data → TuiOverlay.xterm.write()
        ↓
User quits vim → ESC [ ? 1049 l
        ↓
BlockTerminal.onTuiClosed():
  - Closes TuiOverlay
  - Shows block container
  - Creates new InputBlock at bottom
  - Sets state = 'idle'
```

---

## 8. Persistence

### 8.1 Storage Format

File: `~/.config/eTty/blocks/<tabId>.json`

```json
{
  "version": 1,
  "blocks": [
    {
      "id": "<uuid>",
      "type": "completed",
      "timestamp": 1714123456789,
      "cwd": "/Users/maksim/Projects/eTty",
      "input": "git status",
      "exitCode": 0,
      "durationMs": 820,
      "outputText": "On branch main...",
      "outputHtml": "<span style='color:#a6e3a1'>On branch main</span>..."
    }
  ]
}
```

### 8.2 Save Strategy

- **Incremental:** After each `OSC 1337;End`, append block to JSON file
- **Debounce:** 100ms debounce on write to avoid disk thrashing
- **Cleanup:** On tab close, file is merged to global history (existing flow), then block file deleted
- **Migration:** If `version` mismatches on load, discard blocks (graceful degradation — show empty terminal)

### 8.3 Restore Flow

```
App starts → load tabs-state.json
        ↓
For each restored tab:
  - Create PTY session
  - Load <tabId>.json blocks
  - Render CompletedBlocks in order
  - Create empty InputBlock at bottom
  - PTY starts, shell hooks inject, user sees preserved history
```

---

## 9. Component Files

### New Files

| File | Lines Estimate | Purpose |
|------|---------------|---------|
| `src/renderer/block-terminal.js` | ~300 | Orchestrator per tab |
| `src/renderer/input-block.js` | ~250 | Custom input with suggestions |
| `src/renderer/output-block.js` | ~120 | Live xterm.js wrapper |
| `src/renderer/completed-block.js` | ~180 | Frozen readonly block |
| `src/renderer/tui-overlay.js` | ~150 | Fullscreen TUI overlay |
| `src/renderer/ansi-to-html.js` | ~100 | Lightweight ANSI parser |
| `src/main/block-persistence.js` | ~150 | Save/load blocks |
| `src/main/shell-integration.js` | ~80 | Hook script generation |

### Modified Files

| File | Changes |
|------|---------|
| `src/renderer/index.js` | Replace xterm.js-per-tab with BlockTerminal per tab; update `createTab()`; wire IPC |
| `src/renderer/tab-bar.js` | Minor: `term` reference becomes `blockTerminal` |
| `src/renderer/styles.css` | Add `.block-*` styles, `.tui-overlay` styles |
| `src/main/pty-manager.js` | Inject shell integration hooks; expose blockId env var |
| `src/main/index.js` | Wire block persistence IPC handlers |
| `src/preload/index.js` | Add `blocks:*` IPC channels |

---

## 10. Key Decisions & Trade-offs

### 10.1 Why OSC 1337 instead of parsing prompt/output?

- **Parsing:** Would require regex heuristics for prompt detection, fragile across zsh themes
- **OSC:** Shell explicitly declares boundaries, 100% reliable, standard in VS Code/iTerm2/Warp
- **Trade-off:** Requires hook injection, but we already inject `PROMPT_COMMAND` for OSC 133

### 10.2 Why xterm.js for OutputBlock (not custom renderer)?

- **xterm.js:** Handles ANSI, colors, cursor movements, progress bars automatically
- **Custom renderer:** Would need to reimplement escape sequence parsing
- **Trade-off:** Slightly heavier memory per running command, but commands are short-lived

### 10.3 Why lightweight ANSI-to-HTML for CompletedBlock (not xterm.js)?

- **Performance:** xterm.js per completed block = O(n) memory per block, bad for long sessions
- **HTML:** Lightweight, fast rendering, copy-paste friendly
- **Trade-off:** Some complex ANSI (overwriting lines, animations) flatten to final text state

### 10.4 Why one PTY per tab (not per command)?

- **Shell state:** Environment variables, aliases, functions, `cd` history — all persist across commands
- **Job control:** `&`, `fg`, `bg`, `disown` work naturally
- **Trade-off:** TUI detection complexity, but manageable with 3-tier approach

---

## 11. Error Handling

| Scenario | Behavior |
|----------|----------|
| Hook injection fails | Fallback: raw xterm.js mode (current behavior) |
| OSC sequence corrupted | Discard block metadata, treat as raw terminal output |
| TUI not detected | User can manually toggle TUI mode via button (F12?) |
| Block persistence file corrupted | Ignore, start fresh |
| xterm.js in OutputBlock crashes | Log error, freeze block with error message |
| PTY dies while running | Mark OutputBlock with "PTY disconnected", freeze |

---

## 12. Testing Strategy

| Test | Method |
|------|--------|
| Hook injection | Unit test: verify hook script contains OSC 1337 sequences |
| Block lifecycle | Integration: simulate PTY data with OSC sequences, verify DOM structure |
| TUI detection | Unit test: feed `ESC[?1049h` → assert TuiOverlay visible |
| Persistence | Unit test: serialize → deserialize → assert block equality |
| ANSI-to-HTML | Unit test: feed common ANSI sequences, assert HTML output |
| Long session | Manual: run 100 commands, verify memory stays flat (CompletedBlocks use DOM, not xterm.js) |

---

## 13. Migration Plan

This is a **major architectural change**. To avoid breaking existing users:

1. **Feature flag:** Add `config.terminal.mode = 'block' | 'classic'` (default: `'classic'` initially)
2. **Settings page:** Toggle between block and classic terminal
3. **Gradual rollout:** Default to `'block'` after 2–3 releases once stable
4. **Classic mode preserved:** `src/renderer/classic-terminal.js` keeps current xterm.js-per-tab code (extracted from `index.js`)

---

## 14. Open Questions (resolved during design)

| Question | Decision |
|----------|----------|
| How detect TUI? | 3-tier: alternate screen → cursor hide+timeout → whitelist |
| Persist output? | Yes, full persistence in `~/.config/eTty/blocks/` |
| One PTY or per-command? | One PTY per tab (preserves shell state) |
| How render completed output? | Lightweight ANSI-to-HTML, not xterm.js (memory) |
| Feature flag? | Yes, `terminal.mode` setting, default classic initially |

---

## 15. UI Mockup (Text)

```
┌──────────────────────────────────────────────┐
│  eTty  [~/Projects/eTty] [main]       [+]  ✕ │  ← Tab bar
├──────────────────────────────────────────────┤
│                                              │
│  ~/Projects/eTty $ git status                │  ← Completed Block #1
│  0.8s · exit 0                               │
│  ┌────────────────────────────────────────┐  │
│  │ On branch main                         │  │
│  │ Your branch is up to date.            │  │
│  │                                        │  │
│  │ nothing to commit, working tree clean  │  │
│  └────────────────────────────────────────┘  │
│  [Copy] [Re-run]                             │
│                                              │
│  ~/Projects/eTty $ ls -la                    │  ← Completed Block #2
│  0.2s · exit 0                               │
│  ┌────────────────────────────────────────┐  │
│  │ drwxr-xr-x  12 maksim  staff  ...      │  │
│  │ ...                                    │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ~/Projects/eTty $ npm run █                 │  ← Input Block (active)
│              ┌─────────────────────┐         │
│              │ npm run dev         │         │  ← Suggestion menu
│              │ npm run build       │         │
│              │ npm run dist          │         │
│              └─────────────────────┘         │
│              dev  ← ghost text                 │
│                                              │
└──────────────────────────────────────────────┘
│  ± 0  ~/Projects/eTty  v22.22.2  [agent]  ⚙ │  ← Status bar
└──────────────────────────────────────────────┘
```

---

## 16. Success Criteria

- [ ] Block UI renders for every shell command
- [ ] Ghost text and suggestion menu work with Arrow keys
- [ ] TUI programs (vim, htop) open in fullscreen overlay
- [ ] Blocks persist across app restart (with tab restoration)
- [ ] Classic mode still works (feature flag)
- [ ] Memory usage stays flat after 100+ commands
- [ ] Copy-paste works within and across blocks

---

*End of specification*
