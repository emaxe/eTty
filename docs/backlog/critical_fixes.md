### [ ] Fix File Tree Auto-update Reliability
- **Description:** The file tree in the sidebar does not always automatically refresh after creating or deleting files in the project directory.
- **Task:** Investigate `fs.watch` usage in `file-tree.js` and the `fs:watch-dir`/`fs:unwatch-dir` IPC flow. Ensure the debounce logic and event handling correctly trigger UI updates for all file system mutations.
