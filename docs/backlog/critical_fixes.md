### [x] Fix File Tree Auto-update Reliability
- **Description:** The file tree in the sidebar does not always automatically refresh after creating or deleting files in the project directory.
- **Status:** Fixed via `fs-watch-recursive` feature. `fs.watch` is now used with proper debounce (300ms) and recursive watching across the tree. IPC channels `fs:watch-dir` and `fs:unwatch-dir` handle watcher lifecycle.
- **Task:** Investigate `fs.watch` usage in `file-tree.js` and the `fs:watch-dir`/`fs:unwatch-dir` IPC flow. Ensure the debounce logic and event handling correctly trigger UI updates for all file system mutations.
