# Block 4 Starter Prompt

Execute the plan at `docs/superpowers/plans/2026-04-28-block4-main-service-layer.md` on branch `block4-main-service-layer`.

**Build command:** `npm run build`

**Context:** You are working on the eTty Electron application. The goal of Block 4 is to split the monolithic `src/main/index.js` (404 lines) into specialized IPC handler modules in `src/main/ipc-handlers/` and extract application lifecycle logic into an `AppService` class.

**Current state of `src/main/index.js`:**
- Lines 1-404 contain: window creation, all IPC handler registrations (pty, fs, window, app, tabs, settings, agents, history, git), menu builder, auto-updater, agent service refresh, tab state save on close, window fullscreen events.
- Services already exist as separate files: `pty-manager.js`, `file-manager.js`, `history-manager.js`, `tab-state.js`, `settings-store.js`, `agent-service.js`, `git-service.js`.
- `git-service.js` currently registers IPC handlers inline using string literals instead of `IPC_CHANNELS` constants.
- `IPC_CHANNELS` constants are defined in `src/shared/ipc-channels.js`.

**What to create:**
- `src/main/ipc-handlers/index.js` — barrel export
- `src/main/ipc-handlers/pty-handlers.js` — PTY create/write/resize/kill
- `src/main/ipc-handlers/fs-handlers.js` — File system operations
- `src/main/ipc-handlers/window-handlers.js` — Window position/move
- `src/main/ipc-handlers/app-handlers.js` — Homedir, open external
- `src/main/ipc-handlers/tabs-handlers.js` — Tab state save/load/restore dialog
- `src/main/ipc-handlers/settings-handlers.js` — Settings load/save
- `src/main/ipc-handlers/agents-handlers.js` — Agent status/refresh
- `src/main/ipc-handlers/history-handlers.js` — History cleanup
- `src/main/ipc-handlers/git-handlers.js` — Git operations (from git-service.js)
- `src/main/services/app-service.js` — App lifecycle: window, menu, updater, state save

**What to modify:**
- `src/main/index.js` — reduce to slim bootstrap (~50 lines): create services, instantiate AppService, register all IPC handlers, start app
- `src/main/git-service.js` — remove IPC registration, keep `countDiffLines` utility

**Commit after each task.** If build fails or you are unsure — ask before proceeding.

**Branch:** `block4-main-service-layer`
**Base commit:** Current HEAD (Block 3 merged into main)
