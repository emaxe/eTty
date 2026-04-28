/**
 * EventBus — typed pub/sub with optional namespacing.
 *
 * @example
 * const bus = new EventBus()
 * bus.on('theme.changed', (themeName) => applyTheme(themeName))
 * bus.emit('theme.changed', 'catppuccin-mocha')
 * bus.off('theme.changed', handler)
 */
export class EventBus {
  constructor() {
    this._listeners = new Map() // event -> Set<handler>
  }

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} handler
   * @returns {Function} unsubscribe function
   */
  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set())
    }
    this._listeners.get(event).add(handler)
    return () => this.off(event, handler)
  }

  /**
   * Unsubscribe from an event.
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    const set = this._listeners.get(event)
    if (set) {
      set.delete(handler)
      if (set.size === 0) this._listeners.delete(event)
    }
  }

  /**
   * Emit an event to all subscribers.
   * @param {string} event
   * @param {*} payload
   */
  emit(event, payload) {
    const set = this._listeners.get(event)
    if (!set) return
    for (const handler of set) {
      try {
        handler(payload, event)
      } catch (e) {
        console.error(`[EventBus] Error in handler for "${event}":`, e)
      }
    }
  }

  /**
   * Subscribe once.
   * @param {string} event
   * @param {Function} handler
   * @returns {Function} unsubscribe function
   */
  once(event, handler) {
    const wrapped = (payload, ev) => {
      this.off(ev, wrapped)
      handler(payload, ev)
    }
    return this.on(event, wrapped)
  }

  /**
   * Remove all listeners for an event, or all listeners globally.
   * @param {string} [event]
   */
  clear(event) {
    if (event) {
      this._listeners.delete(event)
    } else {
      this._listeners.clear()
    }
  }

  destroy() {
    this.clear()
  }
}
