/**
 * Proxy-обёртка над `ElectronApiAdapter`, которая незаметно дописывает `ctx` (см.
 * `fs-provider-registry.js`) последним аргументом ко всем `fs*`/`getCwd`-методам. Позволяет
 * `FileTree`/`EditorPanel`/`ProjectSearchDialog` продолжать вызывать `this._api.fsReadDir(...)`
 * без единой правки на местах вызова — контекст (локальный/SSH-сессия конкретной вкладки)
 * подставляется централизованно, читается из живого источника (`getContext()`), а не
 * захватывается один раз при создании.
 */
const FS_SCOPED_METHODS = new Set([
  'fsReadDir', 'fsReadFile', 'fsWriteFile', 'fsStatFile', 'fsCreateFile', 'fsCreateDir',
  'fsRename', 'fsDelete', 'fsDeleteMany', 'fsCopy', 'fsCopyMany', 'fsMove',
  'fsSetRoot', 'fsWatchDir', 'fsUnwatchDir', 'getCwd'
])

/**
 * @param {import('./electron-api.js').ElectronApiAdapter} api
 * @param {() => {kind:'local'}|{kind:'ssh', sessionId:number}} getContext
 */
export function createScopedFsApi(api, getContext) {
  return new Proxy(api, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && FS_SCOPED_METHODS.has(prop)) {
        return (...args) => target[prop](...args, getContext())
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}
