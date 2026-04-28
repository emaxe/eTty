/**
 * AppContainer — lightweight DI container.
 *
 * @example
 * const c = new AppContainer()
 * c.register('store', () => new StateStore({ ui: { theme: 'dark' } }))
 * c.register('tabBar', (r) => new TabBar({ store: r('store'), bus: r('bus') }))
 *
 * const tabBar = c.resolve('tabBar')
 */
export class AppContainer {
  constructor() {
    this._registrations = new Map()
    this._singletons = new Map()
  }

  /**
   * Register a dependency.
   * @param {string} key
   * @param {Function} factory — (resolver) => instance
   * @param {boolean} [singleton=true]
   */
  register(key, factory, singleton = true) {
    this._registrations.set(key, { factory, singleton })
  }

  /**
   * Resolve a dependency.
   * @param {string} key
   */
  resolve(key) {
    if (this._singletons.has(key)) return this._singletons.get(key)

    const reg = this._registrations.get(key)
    if (!reg) throw new Error(`AppContainer: "${key}" not registered`)

    const instance = reg.factory((k) => this.resolve(k))
    if (reg.singleton) this._singletons.set(key, instance)
    return instance
  }

  /**
   * Check if key is registered.
   * @param {string} key
   */
  has(key) {
    return this._registrations.has(key)
  }

  destroy() {
    for (const [, instance] of this._singletons) {
      if (typeof instance.destroy === 'function') instance.destroy()
    }
    this._singletons.clear()
    this._registrations.clear()
  }
}
