/**
 * IPC channel names — shared between main and renderer processes.
 * Single source of truth for all inter-process communication.
 */

export const IPC_CHANNELS = Object.freeze({
  // PTY
  PTY_CREATE: 'pty:create',
  PTY_WRITE: 'pty:write',
  PTY_RESIZE: 'pty:resize',
  PTY_KILL: 'pty:kill',
  PTY_DATA: 'pty:data',
  PTY_EXIT: 'pty:exit',

  // File system
  FS_READ_DIR: 'fs:read-dir',
  FS_CREATE_FILE: 'fs:create-file',
  FS_CREATE_DIR: 'fs:create-dir',
  FS_RENAME: 'fs:rename',
  FS_DELETE: 'fs:delete',
  FS_DELETE_MANY: 'fs:delete-many',
  FS_COPY: 'fs:copy',
  FS_COPY_MANY: 'fs:copy-many',
  FS_MOVE: 'fs:move',
  FS_READ_FILE: 'fs:read-file',
  FS_WRITE_FILE: 'fs:write-file',
  FS_STAT_FILE: 'fs:stat-file',
  FS_GET_CWD: 'fs:get-cwd',
  FS_SET_ROOT: 'fs:set-root',
  FS_WATCH_DIR: 'fs:watch-dir',
  FS_UNWATCH_DIR: 'fs:unwatch-dir',
  FS_DIR_CHANGED: 'fs:dir-changed',

  // Window
  WINDOW_GET_POSITION: 'window:get-position',
  WINDOW_MOVE: 'window:move',
  WINDOW_FULLSCREEN_CHANGE: 'window:fullscreen-change',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',
  WINDOW_MAXIMIZED_CHANGE: 'window:maximized-change',

  // Tabs / state
  TABS_EXPORT_STATE: 'tabs:export-state',
  TABS_HAS_SAVED_STATE: 'tabs:has-saved-state',
  TABS_LOAD_SAVED_STATE: 'tabs:load-saved-state',
  TABS_DELETE_SAVED_STATE: 'tabs:delete-saved-state',
  TABS_SHOW_RESTORE_DIALOG: 'tabs:show-restore-dialog',
  TABS_STATE_CHANGED: 'tabs:state-changed',
  TABS_TRIGGER_RESTORE: 'tabs:trigger-restore',
  TABS_AUTO_SAVE: 'tabs:auto-save',

  // History
  HISTORY_CLEANUP: 'history:cleanup',

  // Settings
  SETTINGS_LOAD: 'settings:load',
  SETTINGS_SAVE: 'settings:save',

  // Agents
  AGENTS_GET_STATUS: 'agents:get-status',
  AGENTS_REFRESH: 'agents:refresh',
  AGENTS_SETTINGS_UPDATED: 'agents:settings-updated',

  // Git
  GIT_GET_ROOT: 'git:get-root',
  GIT_GET_STATUS: 'git:get-status',
  GIT_GET_DIFF: 'git:get-diff',
  GIT_GET_BRANCHES: 'git:get-branches',
  GIT_CHECKOUT: 'git:checkout',
  GIT_CREATE_BRANCH: 'git:create-branch',
  GIT_DELETE_BRANCH: 'git:delete-branch',
  GIT_COMMIT: 'git:commit',
  GIT_PUSH: 'git:push',
  GIT_DISCARD: 'git:discard',

  // App
  APP_HOMEDIR: 'app:homedir',
  APP_OPEN_EXTERNAL: 'app:open-external',

  // Search
  SEARCH_QUERY: 'search:query',
  SEARCH_CANCEL: 'search:cancel',
})
