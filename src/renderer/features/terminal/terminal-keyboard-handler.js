import { IS_MAC } from '../../core/platform.js'

/**
 * Handles custom keyboard events for a terminal:
 * - Kitty keyboard protocol (modifier+Enter)
 * - macOS Cmd+ArrowLeft / Cmd+ArrowRight → Home / End
 * - Non-ASCII printable characters (Cyrillic, accented, etc.)
 */
export class TerminalKeyboardHandler {
  /**
   * @param {Object} ptyApi — object with `write(pid, data)` method
   * @param {Function} getKeyboardMode — (pid) => 'kitty' | 'newline' | 'ctrl-j'
   * @param {Function} [onCtrlV] — () => boolean; true, если Ctrl+V обработан (вставка картинки в SSH)
   */
  constructor(ptyApi, getKeyboardMode, onCtrlV) {
    this._ptyApi = ptyApi
    this._onCtrlV = onCtrlV || null
    this._getKeyboardMode = getKeyboardMode || (() => 'kitty')
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
    this._onCtrlV = null
  }

  _handleKeyEvent(event, pid) {
    // Kitty keyboard protocol: intercept modifier+Enter before xterm.js
    if (event.key === 'Enter') {
      if (event.shiftKey && !event.ctrlKey) {
        if (event.type === 'keydown') {
          const mode = this._getKeyboardMode(pid)
          if (mode === 'newline') {
            this._ptyApi.write(pid, '\n')
          } else if (mode === 'ctrl-j') {
            this._ptyApi.write(pid, '\x0A')
          } else {
            this._ptyApi.write(pid, '\x1b[13;2u')
          }
        }
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

    // Copy selection when text is selected in terminal:
    // - macOS: Cmd+C (if term has selection)
    // - All platforms: Ctrl+Shift+C
    // - Windows/Linux: Ctrl+C (if term has selection, avoids SIGINT)
    if (event.key === 'c' || event.key === 'C') {
      const isCopyCombo =
        (IS_MAC && event.metaKey && !event.ctrlKey && !event.altKey) ||
        (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey) ||
        (!IS_MAC && event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && this._term?.hasSelection())

      if (isCopyCombo && this._term?.hasSelection()) {
        if (event.type === 'keydown') {
          const text = this._term.getSelection()
          if (text) {
            navigator.clipboard?.writeText?.(text).catch((e) => console.warn('[terminal] copy to clipboard failed:', e))
          }
        }
        return false
      }
    }

    // Ctrl+V с картинкой в буфере (SSH-вкладка): xterm.js отправил бы голый ^V, а удалённый агент
    // не видит буфер Mac — обработчик сам загрузит картинку и вставит путь (иначе вернёт false)
    if (
      (event.key === 'v' || event.key === 'V') &&
      event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey &&
      this._onCtrlV
    ) {
      if (event.type === 'keydown' && this._onCtrlV()) {
        event.preventDefault()
        return false
      }
    }

    // macOS: Cmd+ArrowLeft / Cmd+ArrowRight → Home / End
    if (
      IS_MAC &&
      event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      if (event.key === 'ArrowLeft') {
        if (event.type === 'keydown') this._ptyApi.write(pid, '\x1b[H')
        return false
      }
      if (event.key === 'ArrowRight') {
        if (event.type === 'keydown') this._ptyApi.write(pid, '\x1b[F')
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
