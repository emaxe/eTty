/**
 * Application-wide configuration: intervals, debounce delays, panel sizes.
 */

export const APP_CONFIG = Object.freeze({
  // Polling intervals (ms)
  STATUS_POLL_INTERVAL_MS: 5000,
  GIT_PANEL_POLL_INTERVAL_MS: 3000,
  GIT_STATUS_POLL_INTERVAL_MS: 5000,

  // Debounce / batch delays (ms)
  PTY_DATA_BATCH_MS: 8,
  RESIZE_OBSERVER_DEBOUNCE_MS: 150,
  FS_WATCH_DEBOUNCE_MS: 500,

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
})
