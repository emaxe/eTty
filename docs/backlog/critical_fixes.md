### [x] Fix File Tree Auto-update Reliability
- **Description:** The file tree in the sidebar does not always automatically refresh after creating or deleting files in the project directory.
- **Status:** Fixed via `fs-watch-recursive` feature. `fs.watch` is now used with proper debounce (**500ms**, was 300ms) and recursive watching across the tree. IPC channels `fs:watch-dir` and `fs:unwatch-dir` handle watcher lifecycle.
- **Note:** Debounce increased from 300ms to 500ms as part of performance fixes (see `docs/backlog/croductivity_fixes.md`).
