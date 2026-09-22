import { SSH_SESSION_CONFIG } from '../../../shared/ssh-session-config.js'
import { TERMINAL_CONFIG } from '../../core/config/terminal-config.js'

/**
 * Мост «колесо мыши → прокрутка истории tmux» для SSH-вкладок в режиме tmux.
 *
 * Там tmux работает с `mouse off` (см. remote-shell-hooks.js — выделение мышью отдано
 * нативному xterm.js, как в локальной вкладке), поэтому обычное wheel-событие tmux не видит
 * и без моста прокрутка реальной истории не работала бы. Хендлер накапливает deltaY и по
 * достижении порога шлёт в PTY синтетическую CSI-u последовательность несуществующей
 * комбинации клавиш (Ctrl+Alt+Shift+Up/Down, `SSH_SESSION_CONFIG.WHEEL_SCROLL_*_SEQ`) — её
 * распознают `-n`-биндинги в generated tmux.conf и входят в copy-mode/скроллят историю.
 *
 * Не вмешивается (возвращает true — xterm.js обрабатывает колесо сам):
 * - на локальных и не-tmux SSH вкладках;
 * - когда приложение В ПАНЕЛИ само запросило mouse-tracking (`term.modes.mouseTrackingMode`) —
 *   тогда колесо должно уйти этому приложению как есть, ровно как в локальной вкладке.
 */
export class TerminalWheelHandler {
  constructor({ write }) {
    this._write = write
    this._term = null
    this._pid = null
    this._isTmux = false
    this._accumPx = 0
  }

  /**
   * @param {import('@xterm/xterm').Terminal} term
   * @param {number|string} pid
   * @param {{ isTmux: boolean }} opts
   */
  attach(term, pid, { isTmux }) {
    this._term = term
    this._pid = pid
    this._isTmux = isTmux
    this._accumPx = 0
    term.attachCustomWheelEventHandler((event) => this._handleWheel(event))
  }

  detach() {
    this._term?.attachCustomWheelEventHandler(null)
    this._term = null
    this._pid = null
  }

  _handleWheel(event) {
    if (!this._isTmux) return true
    // Приложение в панели уже владеет мышью (vim/htop/агент с собственным UI) — не мешаем,
    // xterm.js перешлёт колесо ему как обычному mouse-report, ровно как в локальной вкладке.
    if (this._term?.modes?.mouseTrackingMode && this._term.modes.mouseTrackingMode !== 'none') return true

    // deltaMode: 0 = пиксели (трекпад/большинство мышей в Electron), 1 = строки, 2 = страницы —
    // переводим всё в те же «пиксельные» единицы, что и WHEEL_PX_PER_TICK.
    if (event.deltaMode === 1) {
      this._accumPx += event.deltaY * TERMINAL_CONFIG.WHEEL_PX_PER_LINE
    } else if (event.deltaMode === 2) {
      const pageHeight = this._term?.element?.clientHeight || TERMINAL_CONFIG.WHEEL_PX_PER_LINE * TERMINAL_CONFIG.DEFAULT_ROWS
      this._accumPx += event.deltaY * pageHeight
    } else {
      this._accumPx += event.deltaY
    }

    const step = TERMINAL_CONFIG.WHEEL_PX_PER_TICK
    while (this._accumPx >= step) {
      this._write(this._pid, SSH_SESSION_CONFIG.WHEEL_SCROLL_DOWN_SEQ)
      this._accumPx -= step
    }
    while (this._accumPx <= -step) {
      this._write(this._pid, SSH_SESSION_CONFIG.WHEEL_SCROLL_UP_SEQ)
      this._accumPx += step
    }

    return false
  }
}
