/**
 * Application-wide configuration: intervals, debounce delays, panel sizes.
 */

export const APP_CONFIG = Object.freeze({
  // Polling intervals (ms)
  STATUS_POLL_INTERVAL_MS: 5000,
  GIT_STATUS_POLL_INTERVAL_MS: 5000,

  // Debounce / batch delays (ms)
  PTY_DATA_BATCH_MS: 8,
  RESIZE_OBSERVER_DEBOUNCE_MS: 150,
  FS_WATCH_DEBOUNCE_MS: 500,
  TAB_STATE_AUTO_SAVE_DEBOUNCE_MS: 500,

  // Auto-save intervals (ms)
  TAB_STATE_AUTO_SAVE_INTERVAL_MS: 30000,

  // Sidebar resize constraints (px)
  SIDEBAR_MIN_WIDTH: 150,
  SIDEBAR_MAX_WIDTH: 600,

  // Editor panel resize constraints
  EDITOR_MIN_WIDTH: 250,
  EDITOR_MAX_WIDTH_RATIO: 0.8,

  // Interaction thresholds
  DOUBLE_CLICK_THRESHOLD_MS: 500,
  DRAG_START_THRESHOLD_PX: 5,
  TITLEBAR_DRAG_THRESHOLD_PX: 3,

  // Search
  SEARCH_DEBOUNCE_MS: 200,
  SEARCH_MAX_FILE_SIZE: 1024 * 1024,
  SEARCH_MAX_CONTENT_RESULTS: 500,
  SEARCH_DOUBLE_SHIFT_TIMEOUT_MS: 300,

  // Git panel sidebar resize constraints (px)
  GIT_SIDEBAR_DEFAULT_WIDTH: 280,
  GIT_SIDEBAR_MIN_WIDTH: 200,
  GIT_SIDEBAR_MAX_WIDTH: 560,

  // Git diff rendering limits (line count)
  GIT_DIFF_MAX_HIGHLIGHT_LINES: 2000,
  GIT_DIFF_MAX_RENDER_LINES: 20000,
})
