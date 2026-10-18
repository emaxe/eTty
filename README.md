# eTty

[🇷🇺 Русский](README.ru.md)

<p align="center">
  <a href="https://github.com/emaxe/eTty/releases/latest"><img src="https://img.shields.io/github/v/release/emaxe/eTty?label=release" alt="Latest release" /></a>
  <a href="https://github.com/emaxe/eTty/releases"><img src="https://img.shields.io/github/downloads/emaxe/eTty/total" alt="Downloads" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="Platforms: macOS, Windows, Linux" />
  <img src="https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white" alt="Electron 33" />
  <a href="https://github.com/emaxe/eTty/commits"><img src="https://img.shields.io/github/last-commit/emaxe/eTty" alt="Last commit" /></a>
</p>

Modern terminal emulator built with Electron — file tree, code editor, Git integration and AI agents. Lightweight, fast, and feature-rich.

<p align="center">
  <img src="build/icon.png" width="128" alt="eTty icon" />
</p>

## Features

### Terminal

- **Multiple tabs** with independent shell sessions (zsh on macOS/Linux; PowerShell 7 / Windows PowerShell 5.1 / Git Bash / `cmd.exe` on Windows, selectable in Settings → Terminal)
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

### SSH Connections

- **SSH panel** — dedicated sidebar for saved connections; position configurable in Settings → SSH Panel (left, right, or off — off by default). The toolbar toggle button is hidden entirely when the panel is off
- **SSH / tmux switch** — a segmented control in the panel header decides what a click on a connection does: open a regular SSH tab, or (tmux mode) expand the row into the list of tmux sessions on the server; the choice is remembered
- **Add/edit/delete/reorder** — host, port, user, auth type (ssh-agent, private key, or password), private key path, extra `ssh` arguments; drag-and-drop to reorder
- **Encrypted password storage** — saved passwords/passphrases are encrypted at rest via Electron `safeStorage` (OS keychain); on Windows it uses DPAPI
- **Click to connect** — opens a regular terminal tab (color-accented, SSH icon) running the system `ssh` binary — full support for `~/.ssh/config`, ssh-agent, `ProxyJump`, 2FA
- **"+" clones the active connection** — pressing "+" while an SSH tab is active opens another tab to the same host
- **Connection overlay** — spinner while connecting; on a dropped session, an error with exit code and a reconnect button, without closing the tab
- **Export / import (`.ettyx`)** — move saved connections between machines or to the mobile app: an encrypted file (PBKDF2-SHA256 + AES-256-GCM) protected by a passphrase; private keys are included only if you tick the checkbox
- **Session restore** — SSH tabs are saved and restored like local tabs; only the tab that was active reconnects automatically on launch, others reconnect lazily when you switch to them

#### Remote file system and agents

- **File tree and editor over SSH** — browse, create, rename, delete, copy, move, read and write remote files; operations run as short-lived non-interactive calls multiplexed over the system `ssh` (ControlMaster), so there's no extra authentication and nothing to install on the server
- **Change detection** — polling of expanded directories (`fs.watch` isn't available over SSH) with an immediate refresh after your own changes
- **Git over SSH** — branch, file statuses, editor gutter and the Git panel work for remote repositories (git runs on the server through the tab's SSH channel)
- **Image paste** — `Cmd+V` / `Ctrl+V` with an image in the clipboard uploads it to the server (`/tmp/etty-paste/`) and pastes the remote path, so claude/opencode/agy can attach it
- **CLI agents work remotely** — remote shell hooks (zsh and bash) report the working directory and busy state, so quick replies, Shift+Enter and the busy indicator behave as in local tabs; falls back to an optimistic busy state if the server blocks hooks (`RemoteCommand`/`ForceCommand`)

#### Persistent sessions (tmux)

- **Sessions survive disconnects** — a tab attaches to a named tmux session, so a network drop, laptop sleep or app restart doesn't kill what's running on the server; closing a tab detaches instead of killing, and restoring tabs re-attaches the same session
- **Session list without an open tab** — in tmux mode, expand a connection to see all its tmux sessions (not only eTty's own); connect, rename (inline) or kill (with confirmation) from the context menu; the list refreshes automatically
- **Several independent sessions per connection** — new ones are named `etty-<id>`, `-2`, `-3`…; clicking a session that's already open just switches to its tab
- **tmux badge** — persistent tabs get a "tmux" badge and their own accent color
- **Taken over from elsewhere** — if another client attaches to the session, the tab shows a "detached" overlay rather than a generic error
- **tmux not installed?** — eTty detects the server's package manager and offers to type the install command into the tab's own terminal; nothing runs without your confirmation, and any `sudo` password is entered by you
- **Configurable socket** — per-connection tmux socket (`-L`, default `etty`; empty uses the server's default)
- **Running agent restored** — a restored tmux tab whose session still has a CLI agent running (claude, opencode, …) brings back that agent's quick-reply panel by inspecting the full process command line (recognizing versioned native binaries like Claude Code); tab switching resyncs active agent detection

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
- **Quick reply groups** — bundle related replies under a named group; the group collapses into a single status-bar button that opens a dropdown menu with the matching replies
- **Double-click or right-click to select active agent** — when the terminal is busy but the active agent wasn't auto-detected (e.g., launched manually or via another app), double-click any agent button in the status bar to manually assign it as active. Right-clicking an agent button opens a context menu to launch the agent or select it as already running (especially useful in remote/SSH tabs where busy state may not be reported).
- **Per-agent Shift+Enter mode** — configure how Shift+Enter behaves for each AI agent (Kitty protocol, newline, or Ctrl+J). Qwen and Agento default to Ctrl+J mode; others fall back to the default mode below.

### Settings

- **7 built-in themes:** Catppuccin Mocha (default), Monokai, Dracula, One Dark, Nord, Solarized Dark, Gruvbox Dark
- **Focus indicator** — glow, border, top-line, or none
- **File tree behavior** — collapse children on close, single/double-click to open
- **Prompt style** — default (from `~/.zshrc`), short, minimal, arrow (for new tabs)
- **Status bar size** — compact, standard, or large; adjustable in Settings → Appearance
- **New tab placement** — `modifierAdjacent` (Cmd/Ctrl opens next to active tab) or `modifierEnd` (Cmd/Ctrl appends to end); configurable in Settings → Terminal
- **Tab switch hotkey** — off, `Cmd+Option+←/→`, or `Cmd+Shift+←/→`; configurable in Settings → Terminal
- **Default Shift+Enter mode** — Kitty protocol, newline, or Ctrl+J; the fallback for agents without a per-agent override, configurable in Settings → Terminal
- **SSH panel position** — off (default), left, or right; configurable in Settings → SSH Panel
- **SSH panel mode** — SSH (regular tabs) or tmux (persistent sessions); switched right in the panel header
- **AI agent quick replies** — CRUD editor with per-agent toggles; drag-and-drop reordering and grouping into a tree
- **Auto-persisted** to disk with debounced saves

### Session Persistence

- **Tab state** saved on quit, restored on next launch (with confirmation dialog)
- **Per-tab tree state** — expanded directories and scroll position remembered when switching tabs
- **Menu option** to manually restore tabs

### Node Version Manager

- **Detects nvm, fnm, and asdf** — reads the manager already installed on your system
- **Switch, install, uninstall** Node.js versions from a dialog, no manual shell commands
- **Current version** shown per-project, respecting `.nvmrc` where present
- **Status bar indicator** — shows the version actually running in the active tab (local or SSH), reported by the shell hook; click to open the version dialog

### Cross-Platform

- **macOS, Windows, Linux** — native window controls and shell resolution per platform
- **Shell auto-detection** — resolves the login shell and its `PATH` correctly even when launched from a GUI (Dock/Start Menu), not just from a terminal

## Mobile app (iOS / Android)

**eTty Mobile** (`mobile/`, Flutter) is the phone-sized sibling of the desktop app — an SSH terminal with persistent tmux sessions.

- **SSH + tmux** — pure-Dart client (`dartssh2`), several tabs per connection, sessions survive app restarts and are shared with the desktop app (same protocol and tmux socket)
- **Session picker** — list and open the server's tmux sessions, or start a new one in a folder chosen in the file tree
- **Remote file tree and editor** — browse (including hidden files), edit and share files over SFTP
- **Touch gestures in the terminal** — one-finger scroll (tmux history, mouse wheel for TUI apps — Page Up/Down on full-screen TUIs, local scrollback), two-finger swipe sends an arrow key, tap clicks in mouse-aware TUIs (htop, mc, vim), long-press selects text, three-finger tap opens a quick-action wheel (Ctrl+C, Esc, Shift+Tab, Ctrl+O, Ctrl+D, Ctrl+L, attach a photo/file), two-finger double-tap opens a two-level wheel of your own commands (Settings → Quick commands); a key row above the keyboard has Esc, Tab, arrows, modifiers and Shift+Enter
- **Security** — biometric lock (Android `FlutterFragmentActivity` / iOS Face ID/Touch ID); secrets in the OS secure storage; import of desktop connections via `.ettyx`

Build and run instructions: [mobile/README.md](mobile/README.md).

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
| `Cmd+Shift+T` | New local tab (even when the active tab is SSH); right-click on `+` also offers local / SSH connections |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Desktop shell | Electron 33 |
| Build tooling | electron-vite (Vite-based) |
| Terminal UI | xterm.js 5.5 + WebGL, Fit, WebLinks, Search addons |
| PTY backend | node-pty 1.1 (native module) |
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
| `config.json` | App settings (theme, focus indicator, file tree behavior, prompt style, agent proxy, force-disabled agents, custom agents, quick replies, SSH panel position and mode); versioned, deep-merged with defaults on load |
| `themes/*.json` | User-defined custom themes, loaded alongside the 7 built-ins |
| `ssh-connections.json` | Saved SSH connections; passwords/passphrases encrypted via `safeStorage` |
| `tabs-state.json` | Saved tab state for session restore |
| `history/global.zsh_history` | Shared command history (5000 lines) |
| `history/tabs/<id>.zsh_history` | Per-tab command history |

## Notes

- `node-pty` is a **native module**. electron-builder rebuilds it automatically via `npmRebuild: true`.
- `build/entitlements.mac.plist` contains macOS entitlements required for node-pty under hardened runtime (JIT, unsigned memory, library validation).
- Auto-update is **stubbed** — logs only, no update server configured yet.
- Settings overlay blocks tab switching to prevent focus leaking to hidden terminals.
- Saved SSH passwords are auto-filled via `SSH_ASKPASS` on macOS/Linux (OpenSSH ≥ 8.4); on Windows the same works via an `askpass.cmd` helper when OpenSSH ≥ 8.4 is installed (otherwise the terminal prompts for the password).
- The remote file tree, remote agent tracking and the tmux session list use a second service connection. On macOS/Linux it multiplexes over SSH ControlMaster; OpenSSH for Windows has no ControlMaster, so there eTty opens a separate long-lived `ssh -T … /bin/sh` channel. It authenticates non-interactively (key / `ssh-agent`, or a saved password via `askpass`), so on Windows an SSH tab without either stays terminal-only.
- Passing the working directory and busy state through tmux needs tmux ≥ 3.3 on the server (DCS passthrough); on older versions persistent sessions still work, with the optimistic busy fallback.

## License

Private
