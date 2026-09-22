/**
 * Terminal configuration constants.
 */

export const TERMINAL_CONFIG = Object.freeze({
  CURSOR_BLINK: true,
  FONT_SIZE: 14,
  FONT_FAMILY: 'Menlo, "SF Mono", Consolas, "Courier New", monospace',
  SCROLLBACK: 2500,
  ALLOW_PROPOSED_API: true,
  DEFAULT_COLS: 80,
  DEFAULT_ROWS: 24,
  // TerminalWheelHandler (мост колеса в tmux-историю при `mouse off`, см. remote-shell-hooks.js):
  // сколько «пиксельных» единиц deltaY считать одним тиком прокрутки (посылкой WHEEL_SCROLL_*_SEQ,
  // каждая скроллит 3 строки — см. `-N 3` в generated tmux.conf), и во что переводить строчный/
  // постраничный deltaMode колеса перед накоплением.
  WHEEL_PX_PER_TICK: 50,
  WHEEL_PX_PER_LINE: 34,
})
