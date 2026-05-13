/**
 * Floating scroll-to-bottom button for the active terminal.
 * Appears when the user scrolls up into history; hides when at the
 * bottom of the buffer or when clicked.
 */
import { Icons } from '../../icons.js'
import { UI_DIMENSIONS } from '../../core/config/ui-dimensions.js'

export class TerminalScrollButton {
  /**
   * @param {Object} opts
   * @param {import('../../core/event-bus.js').EventBus} opts.eventBus
   * @param {HTMLElement} opts.container — #terminal-container
   */
  constructor({ eventBus, container }) {
    this._bus = eventBus
    this._container = container
    this._currentTab = null
    this._scrollDispose = null

    this._btn = document.createElement('button')
    this._btn.id = 'terminal-scroll-btn'
    this._btn.title = 'Прокрутить к актуальному тексту'
    this._btn.innerHTML = Icons.chevronDown
    this._btn.style.display = 'none'
    this._btn.addEventListener('click', () => this._onClick())

    this._container.appendChild(this._btn)

    this._onTabSwitch = ({ tab }) => this._attachToTab(tab)
    this._bus.on('tab.switch', this._onTabSwitch)
  }

  _attachToTab(tab) {
    this._detach()

    if (!tab || !tab.term) {
      this._currentTab = null
      this._hide()
      return
    }

    this._currentTab = tab

    // xterm.js onScroll — fires on programmatic scroll (new output)
    this._scrollDispose = tab.term.onScroll((position) => {
      this._onScroll(position, tab.term)
    })

    // wheel listener — xterm.js onScroll does NOT fire on manual scroll (mouse/trackpad)
    this._wheelHandler = () => {
      const position = tab.term.buffer.active.viewportY
      this._onScroll(position, tab.term)
    }
    tab.container.addEventListener('wheel', this._wheelHandler, { passive: true })

    // Evaluate current scroll position immediately
    const initialPosition = tab.term.buffer.active.viewportY
    this._onScroll(initialPosition, tab.term)
  }

  _detach() {
    if (this._scrollDispose) {
      this._scrollDispose.dispose()
      this._scrollDispose = null
    }
    if (this._currentTab?.container && this._wheelHandler) {
      this._currentTab.container.removeEventListener('wheel', this._wheelHandler)
    }
    this._wheelHandler = null
    this._currentTab = null
  }

  _onScroll(position, term) {
    const bufferLength = term.buffer.active.length
    const rows = term.rows || 1
    const atBottom = position >= bufferLength - rows
    if (atBottom) {
      this._hide()
    } else {
      this._show()
    }
  }

  _show() {
    if (this._btn.style.display !== 'flex') {
      this._btn.style.display = 'flex'
    }
  }

  _hide() {
    if (this._btn.style.display !== 'none') {
      this._btn.style.display = 'none'
    }
  }

  _onClick() {
    if (this._currentTab?.term) {
      this._currentTab.term.scrollToBottom()
    }
    this._hide()
  }

  destroy() {
    this._detach()
    this._bus.off('tab.switch', this._onTabSwitch)
    this._btn.remove()
    this._btn = null
    this._container = null
    this._bus = null
  }
}
