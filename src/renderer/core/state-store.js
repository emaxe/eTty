/**
 * Deep immutable set by dot-path.
 * @param {object} obj
 * @param {string} path — dot-separated, e.g. 'ui.sidebarVisible'
 * @param {*} value
 * @returns {object} new object (shallow copies along the path)
 */
function setPath(obj, path, value) {
  const keys = path.split('.')
  const root = { ...obj }
  let target = root
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    target[key] = target[key] ? { ...target[key] } : {}
    target = target[key]
  }
  target[keys[keys.length - 1]] = value
  return root
}

/**
 * StateStore — centralized reactive state with path-based updates.
 *
 * @example
 * const store = new StateStore({ ui: { theme: 'dark' } })
 * const unsub = store.subscribe((state, changedPath) => {
 *   if (changedPath === 'ui.theme') applyTheme(state.ui.theme)
 * })
 * store.set('ui.theme', 'light')
 */
export class StateStore {
  constructor(initialState = {}) {
    this._state = Object.freeze(initialState)
    this._listeners = new Set()
  }

  /**
   * Get current state (read-only).
   * @param {string} [path] — optional dot-path to get nested value
   * @returns {Readonly<object>}
   */
  get(path) {
    if (!path) return this._state
    const keys = path.split('.')
    let value = this._state
    for (const key of keys) {
      if (value == null) return undefined
      value = value[key]
    }
    return value
  }

  /**
   * Set value at a dot-path. Notifies subscribers.
   * @param {string} path
   * @param {*} value
   */
  set(path, value) {
    const newState = setPath(this._state, path, value)
    this._state = Object.freeze(newState)
    for (const fn of this._listeners) {
      try {
        fn(this._state, path)
      } catch (e) {
        console.error(`[StateStore] Error in subscriber for "${path}":`, e)
      }
    }
  }

  /**
   * Subscribe to all state changes.
   * @param {Function} fn — (state, changedPath) => void
   * @returns {Function} unsubscribe
   */
  subscribe(fn) {
    this._listeners.add(fn)
    return () => this._listeners.delete(fn)
  }

  destroy() {
    this._listeners.clear()
  }
}
