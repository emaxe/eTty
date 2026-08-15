# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.1.10] - 2026-07-06

### Fixed

- **Scroll position lost when switching tabs** — the code editor now restores the exact scroll position of each open file when switching between editor tabs or between terminal tabs, instead of jumping back to the top. Uses CodeMirror's `scrollSnapshot()` API so the restore survives the DOM re-measure that happens when a view is re-attached

## [0.1.9] - 2026-07-06

### Added

- **Keyboard shortcut to switch between adjacent tabs** — bind `Cmd+Option+←/→` or `Cmd+Shift+←/→` in Settings → Terminal to jump to the previous/next tab, wrapping around at the ends. Off by default
- **Confirmation dialog when closing a busy tab** — closing a tab via the × button or context menu while an AI agent/process is still running now shows a confirmation dialog (`ConfirmDialog`) instead of silently killing the PTY
- **Node version selector dialog** — status bar's Node version indicator is now a clickable button opening a dialog to list/install/switch/uninstall Node versions. Detects the active manager (nvm, fnm, asdf) via `NodeVersionManager`; polls and updates the current version for the active folder
- **`.nvmrc`** added to the repo (Node 20.17.0) for consistent dev environment

### Fixed

- **Manual AI agent toggles reset by detection checks** — force-enabled/disabled agent state in settings no longer gets overwritten by the next auto-detection poll
- **Quick reply label/command split** — settings UI now edits quick-reply label and command as separate fields instead of one combined string
- `run.sh` rebuild step now uses `--ignore-scripts` on install with an explicit manual `node-pty` rebuild; `node-pty` bumped to `^1.1.0` with `node-addon-api ^8.8.0`
- Simplified status-bar Node version display (dropped the manager-name label)

## [0.1.8] - 2026-05-31

### Added

- **Cross-platform support (Windows, Linux)** — packaged builds now run on Windows and Linux, not just macOS
  - `ShellPathResolver` resolves the default shell and PATH per platform (zsh/bash on macOS/Linux, `cmd.exe` on Windows), with fallback PATHs when launched outside a terminal (Dock/Start Menu)
  - `PtyManager` skips zsh-only setup (`ZDOTDIR`, `LC_CTYPE`) on Windows and uses the resolved shell instead
  - Command history merging (`HistoryManager`) is disabled on non-Unix platforms (zsh-specific)
  - Native window controls (minimize/maximize/close) on Windows/Linux instead of the macOS-only frameless titlebar; new `window:minimize`/`window:maximize`/`window:close`/`window:maximized-change` IPC channels
  - Editor "open file" action uses Electron's `shell.openExternal` instead of shelling out to macOS's `open` command

## [0.1.7] - 2026-05-31

### Added

- **Configurable new tab placement** — control where a new tab opens relative to the active one, with modifier-key support
  - `modifierAdjacent` (default) — Cmd/Ctrl+click on "+" inserts the new tab right after the active tab; plain click appends to the end
  - `modifierEnd` — plain click inserts next to the active tab; Cmd/Ctrl+click appends to the end
  - Configurable in Settings → Terminal → "Новая вкладка рядом"

- **Auto-open tab when terminal is busy** — if a shell command is triggered from the file tree hover overlay (run script, cd) while the active terminal is occupied by an AI agent, a new tab is automatically created and the command runs there instead of being dropped

## [0.1.6] - 2026-05-22

### Added

- **Run-script button in file tree hover overlay** — hovering over a file row now shows a quick-action overlay with a "Run" (▶) button alongside the existing "cd" and "Copy path" buttons; clicking it executes the file in the active terminal using an appropriate command based on the file extension

- **Binary files open with OS default application** — clicking images, videos, and executables in the file tree now opens them with the system default application (Preview, VLC, Finder, etc.) instead of attempting to load binary content into the code editor
  - Covers: images (jpg, png, gif, bmp, webp, ico), audio (mp3, wav, ogg, flac), video (mp4, avi, mov, mkv, webm), archives (zip, tar, gz, 7z, rar), documents (pdf, doc, docx, xls, xlsx, ppt, pptx), executables and installers (exe, dmg, msi, dll, so, dylib), fonts (ttf, otf, woff, woff2), compiled/DB artifacts (sqlite, db, wasm, node, class, pyc)
  - SVG and other XML-based formats are intentionally left as text files (editable in the code editor)
  - Binary extension list extracted to `src/shared/binary-extensions.js` — reused by both renderer and project search

## [0.1.5] - 2026-05-21

### Added

- **New AI agents: Qwen and Agento** — added to the built-in supported agents list with auto-detection and default Shift+Enter mode set to Ctrl+J (instead of Kitty protocol)

- **Per-agent Shift+Enter mode** — configure how Shift+Enter behaves for each AI agent individually:
  - **Kitty protocol** (default) — sends `\x1b[13;2u` sequence
  - **Newline** — sends plain `\n` character
  - **Ctrl+J** — sends `\x0A` (ASCII LF, equivalent to Ctrl+J)
  - Useful for agents that don't understand Kitty keyboard sequences (e.g., Qwen)
  - Supports both built-in and custom agents; settings persisted to config

### Fixed

- **Agent edit dialog label contrast** — labels in the custom agent edit dialog now use `var(--text)` for proper contrast on both light and dark themes. Previously labels were rendered in a low-contrast gray that was hard to read.
- **Agent launch buttons not working for Qwen and Agento** — added `qwen` and `agento` to `SUPPORTED_AGENTS` in `agent-service.js`, enabling auto-detection, `launchCommand` resolution, and button functionality.
- **Custom agent keyboardModes not persisted** — `config-loader.js` now preserves unknown keys in `agents.keyboardModes`, `agents.forceDisabled`, and `agents.lastDetected` objects. Previously custom agent IDs (UUIDs) were treated as invalid fields and discarded during config merge.
- **Keyboard mode changes not applied without restart** — `index.js` now subscribes to `settings.changed` for `agents.keyboardModes` and immediately updates the in-memory config.

### Changed

- **Git diff highlighting performance overhaul** — switched from per-file `git diff` + line-count parsing to bulk `git diff --numstat` for tracked and staged files
  - Untracked files now use streaming line-count with hard caps: 50 MB per file, 200 files max, preventing OOM/hang on large repos
  - Added stale-poll guard in `GitStatusService`: discards results if `rootPath` changes while awaiting IPC response
  - `StateStore` now keeps `git.branch`, `git.totalAdditions`, and `git.totalDeletions` for status-bar consumption without re-polling

## [0.1.4] - 2026-05-13

### Added

- **Terminal scroll-to-bottom button** — floating button that appears when the user scrolls up into the terminal history; click to jump back to the latest output
  - Listens to xterm.js `onScroll` and mouse `wheel` events to detect when the viewport leaves the bottom of the buffer
  - Circular accent-colored button with shadow, positioned at the bottom-right of the terminal area
  - Auto-hides when the buffer is scrolled back to the bottom or when a new tab is switched

- **Bulk file operations in file tree** — copy, paste, and delete multiple selected items at once
  - `Ctrl+C` / `Cmd+C` — copy all selected paths to internal clipboard
  - `Ctrl+V` / `Cmd+V` — paste copied items into the current or selected directory
  - `Delete` / `Backspace` — delete all selected items with a confirmation dialog
  - Context menus updated for multi-select: "Delete" operates on selection, "Rename" hidden when multiple items selected, "Paste" enabled when clipboard is non-empty
  - New IPC channels: `fs:copy-many`, `fs:delete-many`; renderer `_clipboard` changed from single object to array of paths

## [0.1.3]

### Security

- **Fixed symlink attack vulnerability in `FileManager.validatePath()`** — `path.resolve()` was replaced with `fs.realpath()` to properly resolve symbolic links before checking path boundaries. This prevents attackers from bypassing path traversal protection via symlinks pointing outside the CWD.

### Added

- **Git diff highlighting** — live visual indicators for git status in the file tree and editor gutter
  - File tree: new files (green), modified (blue), deleted (red strikethrough); folders show colored dot markers for nested changes
  - Editor gutter: 3px color bars next to line numbers for added (green) and modified (blue) lines
  - Auto-refreshes every 5 seconds and on file save (`Cmd+S`); only active inside git repositories
  - Powered by new `GitStatusService` (renderer) with 5-second polling via existing `git:get-status` IPC channel

- **Project search dialog** — full-text and filename search inside the current working directory
  - Open with `Cmd+F` / `Ctrl+F` or double-tap `Shift`
  - Searches file names and file contents simultaneously; name matches shown first
  - Options: case sensitive, whole word, regex; include/exclude glob patterns
  - Live preview with highlighted matches; double-click or `Enter` opens file in editor
  - Cancellable backend search via `AbortController` in `FileManager.searchFiles()`

- **Roboto font** — applied globally across the application for consistent typography

- **Status bar size setting** — three selectable sizes (compact / standard / large) in Settings → Appearance
  - Compact: 22px height, 11px font (current default)
  - Standard: 28px height, 13px font
  - Large: 34px height, 15px font
  - Applied instantly via `data-size` attribute on the status bar element

### Fixed

- **Terminal Home/End on macOS** — `Cmd+ArrowLeft` and `Cmd+ArrowRight` now send `\x1b[H` / `\x1b[F` (Home / End) escape sequences to the PTY in TUI applications (Vim, Emacs, readline, fzf, etc.). Previously xterm.js consumed these events for DOM text selection and never forwarded them to the shell.
- **App quit cleanup** — graceful shutdown sequence for main and renderer processes
  - `beforeQuit` handler saves tab state, kills all PTY sessions, and unwatches all file system watchers before app exits
  - Main-process diagnostics interval now properly cleared on `window-all-closed`
  - Temporary `zdotdir` folders created for PTY sessions cleaned up on process exit, kill, and bulk `killAll`
- **Renderer cleanup** — global event listeners and observers properly disposed on window unload
  - `ResizeObserver` disconnected and debounce timer cleared
  - Global `focusin`, `mousedown`, `blur`, `keydown`, `mousemove`, `mouseup` listeners removed
  - Terminal container `destroy()` called to prevent memory leaks
- **PTY init protection** — `init()` now wrapped in try/catch to prevent PTY spawn errors from cascading into UI failures (e.g., shell not found, permission denied). Error is logged and the terminal remains in a clean error state instead of freezing the app.

## [0.1.2]

### Added

- **Double-click to select active AI agent** — when terminal is busy but no agent was auto-detected, double-click any agent button to manually assign it as active
  - Enables quick-reply buttons for agents launched manually or via other applications
  - Click-based detection (500ms threshold) for reliable cross-platform behavior
  - Busy-state buttons use `status-agent-busy` CSS class instead of `disabled` attribute to allow click events
- **Configurable quick replies for AI agents** — replace hardcoded agent command buttons with fully customizable quick replies
  - Define command text, enable/disable per item, assign to specific agents (Claude, Codex, Copilot, Cursor Agent, OpenCode)
  - Compact Settings UI: list view with inline agent tags, click pencil icon to open edit dialog
  - Drag-and-drop reordering via grip handle with visual drop indicator (accent line)
  - Default quick replies migrated from previous hardcoded values: `Ok`, `Продолжай`, `/clear`, `/model`, `/exit`, `/new`
  - New items automatically inherit in config (`quickReplies.items` array in `settings.json`)

### Changed

- Settings page "Быстрые ответы" (Quick Replies) category redesigned for compactness:
  - Single text field drives both label and command (displayed together)
  - Edit dialog replaced inline editing clutter
  - Pencil SVG icon replaces text "Редактировать" button
- Agent command buttons in status bar now generated dynamically from config instead of hardcoded HTML

## Notes

- No breaking changes: existing `settings.json` without `quickReplies` section auto-populated with defaults on next load
- No migration required: previous hardcoded values become the new defaults
