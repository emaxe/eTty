# eTty

[🇷🇺 Русский](README.ru.md)

Modern terminal emulator built with Electron. Lightweight, fast, and feature-rich.

<p align="center">
  <img src="build/icon.png" width="128" alt="eTty icon" />
</p>

## Features

### Terminal

- **Multiple tabs** with independent shell sessions (zsh on macOS/Linux, `cmd.exe` on Windows)
- **WebGL-accelerated** rendering (canvas fallback)
- **Kitty keyboard protocol** — Shift+Enter, Ctrl+Enter, Ctrl+Shift+Enter sequences
- **Full Unicode support** — Cyrillic, accented characters, emoji
- **Shell directory tracking** via OSC 7 — file tree syncs automatically
- **Command busy indicator** via OSC 133 — navigation buttons reflect shell state
- **Tab drag-and-drop** — reorder tabs by dragging the grip handle
- **Configurable new tab placement** — choose whether new tabs open adjacent to the active tab or at the end; hold Cmd/Ctrl while clicking "+" to toggle the behavior (configurable in Settings)
- **Keyboard shortcut to switch tabs** — bind `Cmd+Option+←/→` or `Cmd+Shift+←/→` to jump to the adjacent tab (wraps around at the ends); off by default, configurable in Settings → Terminal
- **Confirmation before closing a busy tab** — closing a tab (× button or context menu) while an AI agent/process is still running shows a confirmation dialog instead of silently killing it
- **Auto-open tab for busy terminal** — triggering a run-script or cd from the file tree while the active tab is occupied by an agent automatically opens a new tab for the command
- **2,500 lines** scrollback buffer (performance-optimized)
- **Scroll-to-bottom button** — floating button appears when you scroll up into history; click to jump back to the latest output

### Command History

- **Shared global history** (5,000 lines) across all tabs
- **Per-tab history files** — each tab gets its own `HISTFILE`
- **Smart merging** — new commands merge back to global on tab close
- **Session restore** — history survives app restarts
- **Automatic cleanup** of orphaned history files

### File Tree (Sidebar)

- **Lazy-loaded** directory tree with expand/collapse
- **Hidden files** toggle
- **Quick navigation** — `cd ..` and `cd ~` buttons
- **Live sync** — filesystem watcher with 500ms debounce
- **Context menus** — new file/folder, rename, delete, copy, paste, open external, copy relative path
- **Hover overlay** — quick-action buttons appear on hover: cd into directory, copy path, and run script (▶) to execute the file in the active terminal
- **Multi-select** — Ctrl/Cmd+Click, Shift+Click range, Ctrl+A select all
- **Bulk operations** — copy (`Ctrl+C` / `Cmd+C`), paste (`Ctrl+V` / `Cmd+V`), and delete (`Delete`) on the current selection
- **Drag-and-drop** — move files/folders within the tree
- **Undo** — Ctrl+Z to undo last move operation
- **Binary file handling** — images, videos, executables (.dmg, .exe, etc.) open with the OS default application instead of the code editor
- **Resizable** sidebar (150–600px)
- **Path traversal protection** — all paths validated against CWD

### Code Editor

- **CodeMirror 6** with syntax highlighting for 20+ languages:
  JavaScript/TypeScript, Python, Go, Rust, HTML, CSS/SCSS, JSON, YAML, Markdown, Vue, C#
- **Send to terminal** — select code and send it to the active shell (Cmd+Enter)
- **Unsaved changes** indicator
- **Auto-features** — bracket closing, fold gutter, active line highlight, search
- **Clickable file paths** — Cmd/Ctrl+Click a path in the editor (backtick-wrapped, markdown link, `./relative`, or absolute) to open it
- **Resizable** editor panel
- **Scroll position preserved** — switching between open file tabs, or between terminal tabs, restores each file's exact scroll position (CodeMirror scroll snapshot)

### Git Integration

- **Status bar** showing `± +N -N` diff stats, updated every 5 seconds
  - **Click on stats** to toggle Git panel
- **Branch management** — switch, create, delete branches
- **Inline diff viewer** with colored additions/deletions
- **Commit, push, discard** — all from the GUI
- **Per-file stats** — additions and deletions count for each changed file

### Git Diff Highlighting

- **File tree indicators** — new files (green), modified (blue), deleted (red + strikethrough)
- **Folder dot markers** — nested changes bubble up to parent directories (deleted > modified > new)
- **Editor gutter bars** — 3px color strips left of line numbers for added (green) and modified (blue) lines
- **Auto-refresh** — polling every 5 seconds + immediate update on file save (`Cmd+S`)
- **Repository-aware** — only active when the working directory is inside a git repo

### Project Search

- **Modal search dialog** — `Cmd+F` (macOS) / `Ctrl+F` (Windows/Linux), or double-tap `Shift`
- **File names + contents** — searches both simultaneously; file-name matches shown first
- **Search options** — case sensitive, whole word, regex toggles; include/exclude glob patterns
- **Live preview** — click a result to preview file contents with highlighted matches
- **Quick open** — double-click or `Enter` opens the file in the editor and closes the dialog
- **Cancellable** — long searches abort automatically when the query changes

### AI Agents

- **Status-bar launcher** — one-click launch of detected CLI agents
- **Auto-detection** — Claude, Codex, Copilot, Cursor Agent, OpenCode, Qwen, Agento
- **Custom agents** — add your own CLI agent (label, launch command, optional detect command) alongside the built-ins; available in quick replies too
- **Busy lock** — agent buttons disabled while terminal is busy
- **Active agent highlight** — launched agent button glows while running
- **Force-disable** — toggle agents on/off in Settings
- **Proxy support** — configure HTTP proxy for all agent commands
- **Customizable quick replies** — define agent-specific quick commands (e.g., `/clear`, `Ok`, `Продолжай`) via Settings; drag-and-drop to reorder
- **Double-click to select active agent** — when the terminal is busy but the active agent wasn't auto-detected (e.g., launched manually or via another app), double-click any agent button in the status bar to manually assign it as active. This enables that agent's quick-reply buttons.
- **Per-agent Shift+Enter mode** — configure how Shift+Enter behaves for each AI agent (Kitty protocol, newline, or Ctrl+J). Qwen and Agento default to Ctrl+J mode; others default to Kitty protocol.

### Settings

- **7 built-in themes:** Catppuccin Mocha (default), Monokai, Dracula, One Dark, Nord, Solarized Dark, Gruvbox Dark
- **Focus indicator** — glow, border, top-line, or none
- **File tree behavior** — collapse children on close, single/double-click to open
- **Prompt style** — default (from `~/.zshrc`), short, minimal, arrow (for new tabs)
- **Status bar size** — compact, standard, or large; adjustable in Settings → Appearance
- **New tab placement** — `modifierAdjacent` (Cmd/Ctrl opens next to active tab) or `modifierEnd` (Cmd/Ctrl appends to end); configurable in Settings → Terminal
- **Tab switch hotkey** — off, `Cmd+Option+←/→`, or `Cmd+Shift+←/→`; configurable in Settings → Terminal
- **AI agent quick replies** — CRUD editor with per-agent toggles; drag-and-drop reordering
- **Auto-persisted** to disk with debounced saves

### Session Persistence

- **Tab state** saved on quit, restored on next launch (with confirmation dialog)
- **Per-tab tree state** — expanded directories and scroll position remembered when switching tabs
- **Menu option** to manually restore tabs

### Node Version Manager

- **Detects nvm, fnm, and asdf** — reads the manager already installed on your system
- **Switch, install, uninstall** Node.js versions from a dialog, no manual shell commands
- **Current version** shown per-project, respecting `.nvmrc` where present
- **Status bar indicator** — click to open the version dialog

### Cross-Platform

- **macOS, Windows, Linux** — native window controls and shell resolution per platform
- **Shell auto-detection** — resolves the login shell and its `PATH` correctly even when launched from a GUI (Dock/Start Menu), not just from a terminal

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+F` / `Ctrl+F` | Open project search dialog |
| `Cmd+E` / `Ctrl+E` | Toggle editor panel |
| `Cmd+S` / `Ctrl+S` | Save file in editor |
| `Cmd+Enter` | Send selection from editor to terminal |
| `Shift+Enter` | Kitty protocol: `\x1b[13;2u` |
| `Ctrl+Enter` | Kitty protocol: `\x1b[13;5u` |
| `Ctrl+Shift+Enter` | Kitty protocol: `\x1b[13;6u` |
| `Cmd+ArrowLeft` (macOS) | Home — `\x1b[H` |
| `Cmd+ArrowRight` (macOS) | End — `\x1b[F` |
| `Cmd+Option+←/→` or `Cmd+Shift+←/→` (configurable, off by default) | Switch to adjacent tab (wraps around) |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Desktop shell | Electron 33 |
| Build tooling | electron-vite (Vite-based) |
| Terminal UI | xterm.js 5.5 + WebGL, Fit, WebLinks, Search addons |
| PTY backend | node-pty 1.0 (native module) |
| Code editor | CodeMirror 6 with 13 language packages (JS/TS, Python, Go, Rust, HTML, CSS, JSON, YAML, Markdown, Vue, C#) |
| Git operations | simple-git |
| UI font | Roboto (global application font) |
| Packaging | electron-builder |
| Logging | electron-log |
| Auto-update | electron-updater (stub) |

## Getting Started

### Prerequisites

- **Node.js 18+**
- Native module toolchain for `node-pty` (rebuilt automatically via `postinstall`):
  - **macOS**: Xcode Command Line Tools — `xcode-select --install`
  - **Windows**: Visual Studio Build Tools with the "Desktop development with C++" workload, plus Python 3
  - **Linux**: `build-essential`, `python3`

### Development

```bash
npm install
npm run dev
```

### Building

```bash
# 1. Compile with electron-vite
npm run build

# 2. Package distributable
npm run dist          # macOS .dmg (arm64 + x64)
npm run dist:win      # Windows NSIS installer
npm run dist:linux    # Linux AppImage + .deb
```

Output goes to `dist/`.

### Code Signing (macOS)

Without certificates the app is signed ad-hoc — fine for local testing.
For a signed and notarized release:

```bash
export CSC_LINK=/path/to/certificate.p12
export CSC_KEY_PASSWORD=...
export APPLE_ID=you@example.com
export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
export APPLE_TEAM_ID=XXXXXXXXXX
npm run build && npm run dist
```

### Verify Signing

```bash
codesign -dv --verbose=4 dist/mac-arm64/eTty.app
spctl -a -vvv -t install dist/mac-arm64/eTty.app
```

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                         Main Process                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────────────┐              │
│  │PtyManager│ │FileManager│ │   HistoryManager        │              │
│  │ node-pty │ │ fs ops   │ │   global + per-tab      │              │
│  └──────────┘ └──────────┘ └──────────────────────────┘              │
│  ┌──────────┐ ┌──────────────┐ ┌────────────┐                       │
│  │ TabState │ │SettingsStore │ │AgentService│                       │
│  │ persist  │ │ = ConfigLoader│ │detect CLI │                       │
│  │          │ │ + ThemeLoader │ │            │                       │
│  └──────────┘ └──────────────┘ └────────────┘                       │
│  ┌────────────────────┐ ┌──────────────────────────────────────┐    │
│  │ShellPathResolver    │ │ NodeVersionManager                    │    │
│  │login shell + PATH   │ │ nvm / fnm / asdf detect, switch       │    │
│  │(GUI-launch fix)     │ │                                        │    │
│  └────────────────────┘ └──────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ AppService — window, menu, auto-updater, state save on quit       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐┌──────┐│
│  │pty     ││fs      ││git     ││tabs    ││settings││agents  ││...   ││
│  │-handl. ││-handl. ││-handl. ││-handl. ││-handl. ││-handl. ││search││
│  └────────┘└────────┘└────────┘└────────┘└────────┘└────────┘└──────┘│
└──────────────────────────┬───────────────────────────────────────────┘
                           │ IPC (70+ channels, constants in shared/)
┌──────────────────────────┴───────────────────────────────────────────┐
│                    Preload (contextBridge)                             │
│              ~90 methods on window.electronAPI                       │
└──────────────────────────┴───────────────────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────────────────┐
│                       Renderer Process                                 │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ Core Infrastructure                                              │  │
│  │  EventBus  │  StateStore  │  DI Container  │  ElectronApiAdapter │  │
│  │  GitStatusService (polling)                                      │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│  ┌────────┐ ┌────────┐ ┌──────────┐ ┌──────────────────┐ ┌────────┐  │
│  │Terminal│ │FileTree│ │EditorPanel│ │ GitPanel (master/ │ │Settings│  │
│  │xterm.js│ │ lazy   │ │CodeMirror │ │ detail, features/ │ │Page    │  │
│  │ tabs   │ │ DnD    │ │ 20+ langs │ │ git/*)            │ │overlay │  │
│  └────────┘ └────────┘ └──────────┘ └──────────────────┘ └────────┘  │
│  ┌────────┐ ┌────────────────┐ ┌────────────────┐ ┌─────────────┐   │
│  │ TabBar │ │ ProjectSearch  │ │NodeVersionDialog│ │  StatusBar  │   │
│  │reorder │ │  dialog        │ │ nvm/fnm/asdf UI │ │git±│cwd│AI  │   │
│  └────────┘ └────────────────┘ └────────────────┘ └─────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

## Architecture Patterns

The codebase follows a layered architecture after a 4-block refactoring:

- **DI Container** (`renderer/core/container.js`) — components receive dependencies via constructor injection, not global variables
- **EventBus** (`renderer/core/event-bus.js`) — pub/sub communication between decoupled components
- **StateStore** (`renderer/core/state-store.js`) — centralized reactive state with subscriptions (`ui.theme`, `ui.sidebarVisible`, etc.)
- **IPC_CHANNEL constants** (`shared/ipc-channels.js`) — single source of truth for all IPC channel names, no string literals
- **IPC handler modules** (`main/ipc-handlers/*.js`) — each domain group in its own file with `register*Handlers(ipcMain, deps)` signature
- **AppService** (`main/services/app-service.js`) — application lifecycle in main process (window, menu, updater, state save)

## Data Storage

All user data is stored in `~/.config/eTty/` (Electron `userData`):

| File | Purpose |
|------|---------|
| `config.json` | App settings (theme, focus indicator, file tree behavior, prompt style, agent proxy, force-disabled agents, custom agents, quick replies); versioned, deep-merged with defaults on load |
| `themes/*.json` | User-defined custom themes, loaded alongside the 7 built-ins |
| `tabs-state.json` | Saved tab state for session restore |
| `history/global.zsh_history` | Shared command history (5000 lines) |
| `history/tabs/<id>.zsh_history` | Per-tab command history |

## Notes

- `node-pty` is a **native module**. electron-builder rebuilds it automatically via `npmRebuild: true`.
- `build/entitlements.mac.plist` contains macOS entitlements required for node-pty under hardened runtime (JIT, unsigned memory, library validation).
- Auto-update is **stubbed** — logs only, no update server configured yet.
- Settings overlay blocks tab switching to prevent focus leaking to hidden terminals.

## License

Private
