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
    this._wasBusy = false
    this._cwdDisposable = null
    this._busyDisposable = null
  }

  /**
   * Attach handlers to a terminal instance.
   * @param {import('@xterm/xterm').Terminal} term
   * @param {number|string} pid
   */
  attach(term, pid) {
    this._cwdDisposable = term.parser.registerOscHandler(7, (data) => this._handleCwd(data, pid))
    this._busyDisposable = term.parser.registerOscHandler(133, (data) => this._handleBusy(data, pid))
  }

  detach() {
    this._cwdDisposable?.dispose()
    this._busyDisposable?.dispose()
    this._cwdDisposable = null
    this._busyDisposable = null
    this._onCwdChange = null
    this._onBusyChange = null
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

    if (isBusy || isDone) {
      const newBusy = isBusy
      if (this._wasBusy !== newBusy) {
        this._onBusyChange?.(newBusy, pid, this._wasBusy)
        this._wasBusy = newBusy
      }
    }

    return false
  }
}
