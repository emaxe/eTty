/**
 * Handles OSC sequences from the terminal:
 * - OSC 7: directory change synchronization
 * - OSC 133: busy state tracking (shell integration)
 */
export class TerminalOscHandler {
  /**
   * @param {Object} callbacks
   * @param {Function} callbacks.onCwdChange — (newPath, pid) => void
   * @param {Function} callbacks.onBusyChange — (isBusy, pid, wasBusy) => void
   */
  constructor({ onCwdChange, onBusyChange }) {
    this._onCwdChange = onCwdChange
    this._onBusyChange = onBusyChange
  }

  /**
   * Attach handlers to a terminal instance.
   * @param {import('@xterm/xterm').Terminal} term
   * @param {number|string} pid
   */
  attach(term, pid) {
    term.parser.registerOscHandler(7, (data) => this._handleCwd(data, pid))
    term.parser.registerOscHandler(133, (data) => this._handleBusy(data, pid))
  }

  _handleCwd(data, pid) {
    const match = data.match(/^file:\/\/[^/]*(.+)$/)
    if (match) {
      const newPath = match[1].replace(/\/$/, '') || '/'
      this._onCwdChange?.(newPath, pid)
    }
    return false
  }

  _handleBusy(data, pid) {
    const isBusy = data.startsWith('C')
    const isDone = data.startsWith('A')

    if (isBusy) {
      this._onBusyChange?.(true, pid, false)
    } else if (isDone) {
      this._onBusyChange?.(false, pid, true)
    }

    return false
  }
}
