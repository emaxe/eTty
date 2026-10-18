# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.7.0] - 2026-10-18

### Added

- **Локальная вкладка из SSH-режима** — ПКМ по «+» открывает меню «Локальная вкладка / SSH: <подключение>»,
  `Cmd+Shift+T` (`Ctrl+Shift+T`) сразу создаёт локальную вкладку. Раньше при единственной SSH-вкладке «+»
  всегда наследовал подключение и обычную вкладку открыть было нельзя.
- **Windows: PowerShell и Git Bash с интеграцией** — локальная вкладка запускает PowerShell 7 (иначе Windows PowerShell 5.1)
  с синхронизацией cwd (OSC 7), индикатором выполнения (OSC 133), версией node и историей по вкладкам;
  оболочка выбирается в Настройки → Терминал (`terminal.shell`: авто / pwsh / powershell / Git Bash / cmd).
- **Windows: пути** — сервис путей в renderer (`C:\`, UNC, регистронезависимое сравнение), разбор OSC 7 `file:///C:/…`,
  git-пути, ссылки на файлы в редакторе.
- **Windows: агенты и версии Node** — CLI-агенты определяются по PATH/PATHEXT без `sh` (включая `.cmd`-шимы npm);
  менеджеры версий Node — fnm, nvm-windows и Volta (список, установка, удаление; переключение в терминале
  через диалект оболочки вкладки).
- **Windows: удалённое дерево, git, tmux-панель и трекинг агентов по SSH** — служебный канал `SshStdioChannel`
  (одно долгоживущее `ssh -T … /bin/sh` вместо ControlMaster, которого в OpenSSH для Windows нет); тот же канал
  выручает на macOS/Linux, когда путь к ControlMaster-сокету не влезает в лимит `sun_path`.
- **Windows: пароль SSH** — сохранённый пароль/passphrase подставляется через `askpass.cmd` (OpenSSH ≥ 8.4).
- **Windows/Linux: оверлейные скроллбары** — ползунок виден только при прокрутке, нативные контролы следуют теме.

### Changed

- Команды, которые приложение пишет в терминал (cd, открыть, запустить файл, запуск агента с прокси), строятся
  диалектом оболочки вкладки (POSIX / PowerShell / cmd / Git Bash); SSH-вкладки всегда POSIX.
- **Mobile:** колесо быстрых действий открывается обычным тапом тремя пальцами вместо долгого тапа двумя;
  выбор сектора — тапом по нему.

## [0.6.1] - 2026-10-16

### Fixed

- **SSH/tmux: быстрые команды при уже запущенном агенте** — после восстановления вкладки или attach к tmux-сессии
  с работающим `claude` панель быстрых команд не появлялась, а выбрать агента было нельзя. Теперь агент
  опознаётся по полному argv foreground-процесса панели (нативный Claude Code с номером версии вместо имени,
  `node …/claude-code/cli.js` и т.п.), состояние панели перезапрашивается при переключении на вкладку,
  а ПКМ по кнопке агента даёт явный пункт «уже запущен — быстрые команды» независимо от busy.
- **Mobile: биометрическая блокировка на Android** — `MainActivity` теперь `FlutterFragmentActivity`
  (требование `local_auth`); раньше диалог отпечатка не открывался и войти в приложение было нельзя.

## [0.6.0] - 2026-10-13

### Added

- **Mobile: редактор колеса быстрых действий** — Настройки → «Быстрые действия»: выбор клавиш из каталога
  (`^C`, `Esc`, `Tab`, стрелки, `^Z`, `^R` и др.), свои клавиши (подпись + последовательность вида
  `^C`, `\e[A`, `\x1b`), порядок перетаскиванием, удаление, сброс к стандартным. До 8 секторов.
- **Mobile: колесо быстрых действий** — долгий тап двумя пальцами открывает круг из секторов:
  `^C`, `Esc`, `Shift+Tab`, `^O`, `^D`, `^L` и «📎 Файл» (выбор фото/файла на телефоне,
  загрузка на сервер в `$TMPDIR/etty-paste/` и вставка пути в терминал). Выбор протяжкой (довёл пальцы до сектора и отпустил)
  или тапом: если отпустить в центре, колесо остаётся открытым.
- **Mobile: колесо своих команд** — двойной тап двумя пальцами открывает двухуровневое круговое меню
  (группы → команды), текст вставляется без Enter. Группы и команды редактируются в
  Настройки → «Быстрые команды»; по умолчанию — примеры для Claude Code («Ответы», «Команды», «Промпты»).
- **Mobile: кнопка Shift+Enter в панели клавиш** — шлёт kitty-последовательность `\x1b[13;2u`
  (перенос строки в Claude Code и подобных TUI).

### Fixed

- **Mobile: выделение в TUI с мышью** — долгий тап в приложениях с включённым режимом мыши (Claude Code)
  теперь шлёт двойной клик и протяжку, выделение рисует само приложение.
- **Mobile: прокрутка на alternate screen** — на полноэкранных TUI (Claude Code) истории tmux нет,
  поэтому жест прокрутки/колесо транслируются в `PgUp`/`PgDn` (шаг 8 строк), а не в стрелки,
  которые приложение трактовало как историю ввода.

## [0.5.0] - 2026-10-12

### Added

- **eTty Mobile (iOS / Android)** — Flutter-приложение `mobile/`, мобильный аналог десктопного eTty:
  SSH-терминал на `dartssh2` с персистентными tmux-сессиями, удалённой файловой системой,
  редактором файлов, панелью tmux-сессий сервера, биометрической блокировкой и импортом
  профилей `.ettyx` с десктопа (общий крипто-формат). Протокол (`lib/remote/`, `lib/core/config/`) —
  чистый Dart, сверяется golden-тестами с десктопным (`scripts/gen-remote-fixtures.mjs`).
  Спецификация и план — `docs/plans/mob/`.
- **Mobile: выбор tmux-сессий** — панель сессий сервера в терминале и в списке подключений, запуск
  новой tmux-сессии в папке из дерева файлов, показ скрытых файлов в дереве.
- **Mobile: жесты терминала** — скролл одним пальцем (история tmux, колесо мыши для TUI,
  локальный scrollback), свайп двумя пальцами = стрелки влево/вправо/вверх/вниз (с подсказкой-стрелкой
  на экране), тап = клик мышью в TUI-приложениях (htop, mc, vim), long-press выделяет текст,
  кнопка показа/скрытия клавиатуры в верхней панели.

### Fixed

- **Mobile: ввод в терминале** — слово больше не «висит» в composing-режиме клавиатуры: символы уходят
  на сервер сразу, курсор двигается при наборе.
- **Mobile: терминал схлопывался до одной колонки** после подключения.

## [0.4.0] - 2026-10-05

### Added

- **Git in SSH tabs** — branch, file statuses, editor gutter and the Git panel now work for remote repositories (git runs on the server over the tab's SSH channel)
- **Image paste in SSH tabs** — Cmd+V / Ctrl+V with an image in the clipboard uploads it to the server (`/tmp/etty-paste/`) and pastes the remote path, so claude/opencode/agy attach it
- **Node version of the tab's shell** — the status bar shows the version actually running in the active tab (local or SSH), reported by the shell hook instead of polling
- **SSH profile export/import (`.ettyx`)** — buttons in the SSH panel header save connections to an encrypted file (PBKDF2-SHA256 + AES-256-GCM, passphrase-protected; private keys are included only on explicit opt-in) and load them back; the format is shared with the mobile app

### Fixed

- Git branch/status no longer stays on the old repository after `cd` in a tab
- Node version dialog: "Use" now runs `nvm use` / `fnm use` / `asdf shell` in the tab's terminal; `.nvmrc` is written by a separate "В .nvmrc" button; fixed `nvm ls` parsing (alias rows), shell-escape garbage in output, version validation, and repeated shell spawns every 5 s
- Restored SSH/tmux tabs bring back a running CLI agent (e.g. claude) and its quick-reply panel: the agent state is saved with the tab and, on re-attach, verified against the tmux pane's current command

## [0.3.1] - 2026-09-22

### Added

- **Default Shift+Enter mode setting** — Settings → Terminal now has a "Default Shift+Enter mode" selector (Kitty protocol / newline / Ctrl+J) that controls the fallback used for agents without a specific per-agent override, instead of always defaulting to Kitty

### Fixed

- **Mouse selection/copy in tmux SSH tabs** — dragging over text no longer opens tmux's copy-mode indicator and losing the selection on mouse-up: the generated remote `tmux.conf` now runs with `mouse off`, so selection and Cmd+C behave exactly as in a local tab. Scrollback via the mouse wheel is preserved through a synthetic key-sequence bridge (`TerminalWheelHandler`) that still drives tmux's history scroll. The updated config is also applied to already-running tmux servers on attach (previously `-f` only took effect when the server first started, so long-lived sessions never picked it up)

## [0.3.0] - 2026-09-21

### Added

- **Remote file system for SSH tabs** — the file tree and code editor now work over SSH, not just the terminal:
  - Browse, create, rename, delete, copy, move, read and write remote files through short-lived non-interactive calls multiplexed over the system `ssh` (ControlMaster) — no extra authentication and no agent installed on the server
  - Path-traversal protection is enforced on the remote side; file-tree watching falls back to polling expanded directories (`fs.watch` isn't available over SSH), with an immediate refresh after your own changes
  - On Windows, where OpenSSH has no ControlMaster, the tree is explicitly not synced instead of silently showing local files
- **CLI-agent tracking over SSH** — remote shell hooks (zsh and bash) emit real OSC 7/133 on the server, so the working directory, busy indicator, quick replies and Shift+Enter behave as in local tabs; falls back automatically to an optimistic busy state (with manual reset) when the server blocks hooks (`RemoteCommand`/`ForceCommand`)
- **Persistent SSH sessions via tmux** — an SSH tab can attach to a named tmux session on the server, so a network drop, laptop sleep or app restart no longer kills what's running:
  - Closing a tab detaches instead of killing the session, with no busy-close confirmation for persistent tabs; restoring tabs after a restart re-attaches the same session
  - If another client takes over the session, the tab shows a "detached" overlay instead of a generic connection error
  - Working directory and busy state pass through tmux (DCS passthrough, tmux ≥ 3.3) and are resynced right after attach
  - If tmux isn't installed on the server, eTty detects the package manager and offers to type the install command into the tab's own terminal — nothing runs without confirmation, and any `sudo` password is entered by you as usual
  - Configurable tmux socket per connection (`-L`, default `etty`; empty uses the server's default socket)
- **SSH / tmux mode switch in the SSH panel** — a segmented control in the panel header selects what a click on a connection does; the choice is remembered (`ssh.panelMode`):
  - **SSH** — a regular tab, drag-and-drop reordering as before
  - **tmux** — the row expands into the list of tmux sessions on the server, including ones not created by eTty
  - Several independent sessions per connection (`etty-<id>`, `-2`, `-3`…); clicking a session that's already open switches to its tab instead of connecting twice
  - Session context menu: Connect / Rename / Kill (with confirmation); auto-refresh while the panel is open, plus an immediate refresh when a tmux tab opens, closes or drops
  - Sessions are listed without an open tab through a per-connection background ControlMaster that reuses a live tab's channel when there is one; clear states for Windows, tmux not installed, and "connect to see sessions" when a password prompt is needed
- **tmux badge on tabs** — persistent tabs get a "tmux" badge and a separate accent color

### Changed

- The persistence mode is no longer a connection field in the edit form — it's chosen with the SSH / tmux switch in the panel; connections saved earlier keep working through a backward-compatible fallback
- Native delete-confirmation dialogs moved from the main process to the renderer's `ConfirmDialog`, since main doesn't know whether the target is local or remote
- A tmux tab that drops right after start while another tab of the same connection is open is retried with a growing delay instead of showing an error immediately

## [0.2.0] - 2026-09-10

### Added

- **SSH connections** — a new sidebar panel for managing and launching SSH sessions:
  - Add/edit/delete/reorder saved connections (host, port, user, auth type — ssh-agent / private key / password, extra `ssh` arguments) via a dedicated panel with drag-and-drop
  - Panel position configurable in Settings → SSH Panel: left, right, or off (off by default) — the toolbar toggle button is hidden entirely when off
  - Clicking a saved connection opens a regular terminal tab (color-accented, SSH icon) that spawns the system `ssh` binary through the existing PTY channel — full support for `~/.ssh/config`, ssh-agent, `ProxyJump`, and 2FA
  - Pressing "+" while an SSH tab is active opens another tab to the same connection
  - Saved passwords/passphrases are encrypted at rest via Electron `safeStorage` (OS keychain) and injected through `SSH_ASKPASS`, so a saved password isn't retyped on each connect; not supported on Windows, where the terminal prompts for it instead
  - A connection overlay shows a spinner while connecting and an error (with exit code) plus a reconnect button if the session drops — the tab stays open instead of closing
  - SSH tabs are saved and restored like local tabs across app restarts; only the tab that was active reconnects automatically, others reconnect lazily on first switch

## [0.1.12] - 2026-08-30

### Fixed

- **Git status update performance on tab switch and large repositories** — eliminated UI freezes and delayed status updates when switching tabs in repositories with large numbers of changed or ignored files:
  - Switched git status `--ignored=matching` to `--ignored=traditional` to avoid recursive traversal into massive ignored directories (`node_modules`, `dist`, `.cache`)
  - Batch `diff --numstat` calls for staged and unstaged changes, with unified rename parsing directly from numstat output without spawning individual child processes
  - Removed disk stream reading for untracked files during status polling
  - Replaced $O(D \times F \times I)$ nested file-tree directory status calculation with single-pass $O(F + D)$ bottom-up status aggregation, using fast prefix lookups for ignored paths
  - Made `StatusBar` reactive via `StateStore` (`git.branch`, `git.totalAdditions`, `git.totalDeletions`) and eliminated redundant parallel `git:get-status` IPC calls

## [0.1.11] - 2026-08-15

### Added

- **Quick reply groups** — bundle related quick replies under a named group in Settings → Быстрые ответы, editable as a drag-and-drop tree (replies can be dragged into/out of/between groups, groups collapse/expand and can be reordered as a block). In the status bar, a group collapses into a single button that opens an upward dropdown menu listing only the replies matching the active agent — the group itself is only shown when it has at least one matching reply, and its position follows its first reply in the flat list

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
