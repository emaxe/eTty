/**
 * Handles OSC sequences from the terminal:
 * - OSC 7: directory change synchronization
 * - OSC 52: clipboard copy/sync
 * - OSC 133: busy state tracking (shell integration)
 * - OSC 6973: путь к node текущего шелла (`node=/abs/path`, пусто — node не в PATH)
 */
export class TerminalOscHandler {
  /**
   * @param {Object} callbacks
   * @param {Function} callbacks.onCwdChange — (newPath, pid) => void
   * @param {Function} callbacks.onBusyChange — (isBusy, pid, wasBusy) => void
   * @param {Function} [callbacks.onNodeChange] — (nodePath|null, pid) => void
   */
  constructor({ onCwdChange, onBusyChange, onNodeChange }) {
    this._onCwdChange = onCwdChange
    this._onBusyChange = onBusyChange
    this._onNodeChange = onNodeChange
    this._wasBusy = false
    this._cwdDisposable = null
    this._busyDisposable = null
    this._clipboardDisposable = null
    this._nodeDisposable = null
  }

  /**
   * Attach handlers to a terminal instance.
   * @param {import('@xterm/xterm').Terminal} term
   * @param {number|string} pid
   */
  attach(term, pid) {
    this._cwdDisposable = term.parser.registerOscHandler(7, (data) => this._handleCwd(data, pid))
    this._busyDisposable = term.parser.registerOscHandler(133, (data) => this._handleBusy(data, pid))
    this._clipboardDisposable = term.parser.registerOscHandler(52, (data) => this._handleClipboard(data))
    this._nodeDisposable = term.parser.registerOscHandler(6973, (data) => this._handleNode(data, pid))
  }

  detach() {
    this._cwdDisposable?.dispose()
    this._busyDisposable?.dispose()
    this._clipboardDisposable?.dispose()
    this._nodeDisposable?.dispose()
    this._nodeDisposable = null
    this._cwdDisposable = null
    this._busyDisposable = null
    this._clipboardDisposable = null
    this._onCwdChange = null
    this._onBusyChange = null
    this._onNodeChange = null
  }

  _handleCwd(data, pid) {
    const match = data.match(/^file:\/\/[^/]*(.+)$/)
    if (match) {
      const newPath = match[1].replace(/\/$/, '') || '/'
      this._onCwdChange?.(newPath, pid)
    }
    return false
  }

  _handleNode(data, pid) {
    const match = data.match(/^node=(.*)$/)
    if (match) this._onNodeChange?.(match[1] || null, pid)
    return true
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

  _handleClipboard(data) {
    // OSC 52 format: [clipboard-spec];<base64-payload>
    const firstSemicolon = data.indexOf(';')
    if (firstSemicolon === -1) return false
    const b64 = data.slice(firstSemicolon + 1)
    if (b64 === '?') {
      // Query clipboard request: do not expose local clipboard content
      return false
    }
    if (!b64) {
      navigator.clipboard?.writeText?.('').catch((e) => console.warn('[terminal] OSC 52 clipboard clear failed:', e))
      return true
    }
    try {
      const binary = atob(b64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      const text = new TextDecoder('utf-8').decode(bytes)
      navigator.clipboard?.writeText?.(text).catch((e) => console.warn('[terminal] OSC 52 clipboard write failed:', e))
    } catch {
      // Ignore malformed base64
    }
    return true
  }
}
