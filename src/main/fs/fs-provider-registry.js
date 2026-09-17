import { LocalFsProvider } from './local-fs-provider.js'

/**
 * Резолвит `ctx` из IPC-payload (`{kind:'local'}` | `{kind:'ssh', sessionId}` | `undefined`)
 * в конкретный `FsProvider` (см. `fs-provider.js`). Обратная совместимость: отсутствие `ctx`
 * (любой не обновлённый на новый параметр вызов) = локальный провайдер — существующее
 * поведение не меняется без явного контекста.
 */
export class FsProviderRegistry {
  /**
   * @param {{ fileManager: import('../file-manager.js').FileManager,
   *   sshSessionRegistry: import('../ssh/ssh-session-registry.js').SshSessionRegistry }} deps
   */
  constructor({ fileManager, sshSessionRegistry }) {
    this._local = new LocalFsProvider(fileManager)
    this._sshSessionRegistry = sshSessionRegistry
  }

  /**
   * @param {{kind: 'ssh', sessionId: number}|{kind:'local'}|undefined|null} ctx
   * @returns {import('./fs-provider.js').FsProvider}
   */
  resolve(ctx) {
    if (ctx?.kind === 'ssh' && ctx.sessionId != null) {
      const provider = this._sshSessionRegistry.getFsProvider(ctx.sessionId)
      if (provider) return provider
      // Сессия ещё не готова (probe не завершён) либо уже закрылась — деградация до
      // предсказуемой ошибки вместо падения на undefined; UI должен ориентироваться на
      // ssh:fs-ready и не дёргать fs:* раньше available:true (см. Этап 4 в index.js).
      return NOT_READY_PROVIDER
    }
    return this._local
  }
}

const notReadyError = { success: false, error: 'SSH remote FS session is not ready' }
/** @type {import('./fs-provider.js').FsProvider} */
const NOT_READY_PROVIDER = {
  readDir: async () => notReadyError,
  createFile: async () => notReadyError,
  createDir: async () => notReadyError,
  rename: async () => notReadyError,
  delete: async () => notReadyError,
  deleteMany: async () => notReadyError,
  copy: async () => notReadyError,
  copyMany: async () => ({ results: [] }),
  move: async () => ({ results: [] }),
  readFile: async () => notReadyError,
  writeFile: async () => notReadyError,
  statFile: async () => notReadyError,
  getCwd: () => ({ cwd: null }),
  setRoot: () => {},
  watchDir: () => null,
  unwatchDir: () => {},
  unwatchAll: () => {}
}
