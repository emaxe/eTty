/**
 * Реестр SshControlChannel по pid PTY-сессии. Канал живёт ровно столько же, сколько сама
 * SSH-вкладка: создаётся вместе с PTY (см. `PtyManager.create`), уничтожается вместе с ней
 * (см. `PtyManager.kill`/`onExit`/`killAll`). `caps`/`rootPath` заполняются позже (Этап 4,
 * удалённая ФС) — сюда попадёт результат одноразового probe (`uname`, `$HOME`, флавор `stat`...).
 */
export class SshSessionRegistry {
  constructor() {
    /** @type {Map<number, { channel: import('./ssh-control-channel.js').SshControlChannel,
     *   caps: object|null, fsProvider: import('../fs/ssh-fs-provider.js').SshFsProvider|null }>} */
    this._sessions = new Map()
  }

  register(pid, channel) {
    this._sessions.set(pid, { channel, caps: null, fsProvider: null })
  }

  get(pid) {
    return this._sessions.get(pid) || null
  }

  setCaps(pid, caps) {
    const session = this._sessions.get(pid)
    if (session) session.caps = caps
  }

  /** Вызывается после успешного probe (см. pty-handlers.js) — делает readDir/etc доступными по этому pid. */
  setFsProvider(pid, fsProvider) {
    const session = this._sessions.get(pid)
    if (session) session.fsProvider = fsProvider
  }

  getFsProvider(pid) {
    return this._sessions.get(pid)?.fsProvider || null
  }

  /** Гасит канал (`ssh -O exit`) и снимает с учёта. Безопасно вызывать для незарегистрированного pid. */
  dispose(pid) {
    const session = this._sessions.get(pid)
    if (!session) return
    this._sessions.delete(pid)
    try {
      // Останавливает polling-watcher (иначе таймер продолжит дёргать уже мёртвый канал)
      session.fsProvider?.unwatchAll()
    } catch (e) {
      // best effort
    }
    try {
      session.channel.dispose()
    } catch (e) {
      // best effort — сокет мог быть уже мёртв
    }
  }

  get size() {
    return this._sessions.size
  }
}
