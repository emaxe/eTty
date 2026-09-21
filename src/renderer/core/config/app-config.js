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

  // SSH panel resize constraints (px)
  SSH_PANEL_DEFAULT_WIDTH: 240,
  SSH_PANEL_MIN_WIDTH: 180,
  SSH_PANEL_MAX_WIDTH: 480,

  // Сколько ждать первого OSC 7/133 от инжектированных remote-хуков, прежде чем считать
  // их не сработавшими и включить оптимистичный busy (см. connectSshTab в index.js)
  SSH_HOOK_DETECT_TIMEOUT_MS: 8000,
  // Порог «быстрого падения» PTY сразу после подключения — признак конфликта remote-команды
  // с RemoteCommand/ForceCommand на сервере, требующий реконнекта без инжекта хуков
  SSH_HOOK_FAIL_FAST_MS: 3000,
  // Персистентная (tmux) вкладка быстро падает, пока к этому же подключению открыта другая
  // вкладка (наблюдалось на практике) — повтор с растущей паузой вместо немедленного показа
  // ошибки (см. onPtyExit в index.js). MS — база задержки, умножается на номер попытки.
  SSH_TMUX_RACE_MAX_RETRIES: 3,
  SSH_TMUX_RACE_RETRY_DELAY_MS: 1000,

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

  // Quick replies settings tree (px)
  QUICK_REPLY_TREE_INDENT_PX: 26,
})
