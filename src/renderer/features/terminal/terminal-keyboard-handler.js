/**
 * Handles custom keyboard events for a terminal:
 * - Kitty keyboard protocol (modifier+Enter)
 * - Non-ASCII printable characters (Cyrillic, accented, etc.)
 */
export class TerminalKeyboardHandler {
  /**
   * @param {Object} ptyApi — object with `write(pid, data)` method
   */
  constructor(ptyApi) {
    this._ptyApi = ptyApi
    this._term = null
  }

  /**
   * Attach handler to a terminal instance.
   * @param {import('@xterm/xterm').Terminal} term
   * @param {number|string} pid
   */
  attach(term, pid) {
    this._term = term
    term.attachCustomKeyEventHandler((event) => {
      return this._handleKeyEvent(event, pid)
    })
  }

  detach() {
    if (this._term) {
      this._term.attachCustomKeyEventHandler(null)
      this._term = null
    }
    this._ptyApi = null
  }

  _handleKeyEvent(event, pid) {
    // Kitty keyboard protocol: intercept modifier+Enter before xterm.js
    if (event.key === 'Enter') {
      if (event.shiftKey && !event.ctrlKey) {
        if (event.type === 'keydown') this._ptyApi.write(pid, '\x1b[13;2u')
        return false
      }
      if (event.ctrlKey && !event.shiftKey) {
        if (event.type === 'keydown') this._ptyApi.write(pid, '\x1b[13;5u')
        return false
      }
      if (event.ctrlKey && event.shiftKey) {
        if (event.type === 'keydown') this._ptyApi.write(pid, '\x1b[13;6u')
        return false
      }
    }

    // Non-ASCII printable characters: xterm.js doesn't set _keyDownHandled
    // correctly in non-screenReader mode, so _keyPress re-processes the event
    // with wrong charCode on macOS. We send the character manually and block
    // xterm.js handling.
    if (
      event.key.length === 1 &&
      event.key.charCodeAt(0) > 127 &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      if (event.type === 'keydown') this._ptyApi.write(pid, event.key)
      return false
    }

    return true
  }
}
