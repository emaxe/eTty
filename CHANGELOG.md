# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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
