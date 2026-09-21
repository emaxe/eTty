import log from 'electron-log'
import { SshConnectionMaster } from './ssh-connection-master.js'
import { findSshBinary } from '../ssh-command.js'

const IS_WIN = process.platform === 'win32'

/**
 * Реестр `SshConnectionMaster` по `connectionId` — держатель панельных мастеров для листинга/
 * kill/rename tmux-сессий (см. модуль-докстринг `ssh-connection-master.js`). Перед подъёмом
 * СОБСТВЕННОГО мастера всегда пробует «одолжить» уже живой канал открытой вкладки этого
 * подключения (`sshSessionRegistry.findLiveChannelFor()`) — при открытой вкладке список сессий
 * обходится вообще без нового SSH-соединения.
 */
export class SshConnectionMasterRegistry {
  /** @param {{ sshSessionRegistry: import('./ssh-session-registry.js').SshSessionRegistry, shellPathResolver: import('../shell-path-resolver.js').ShellPathResolver }} deps */
  constructor({ sshSessionRegistry, shellPathResolver }) {
    this._sshSessionRegistry = sshSessionRegistry
    this._shellPathResolver = shellPathResolver
    /** @type {Map<string, SshConnectionMaster>} */
    this._masters = new Map()
  }

  /**
   * Держит мастер (или одолженный канал вкладки) живым, пока панель не вызовет `release()`.
   * @param {string} connectionId
   * @param {object} connection — результат `sshStore.getConnectionForLaunch()` (расшифрованный `secret`)
   * @returns {Promise<{ ok: true }|{ ok: false, reason: string }>}
   */
  async acquire(connectionId, connection) {
    if (IS_WIN) return { ok: false, reason: 'no-controlmaster' }

    const borrowed = this._sshSessionRegistry.findLiveChannelFor(connectionId)
    if (borrowed) return { ok: true }

    const master = this._ensureMaster(connectionId, connection)
    const result = await master.ensure()
    if (result.ok) master.acquire()
    return result
  }

  /** Парная к `acquire()` — панель вызывает при сворачивании строки подключения. */
  release(connectionId) {
    // Одолженный канал вкладки release() не требует (панель им не владеет, см. acquire()) —
    // если мастера для этого connectionId нет, вызов просто ничего не делает.
    this._masters.get(connectionId)?.release()
  }

  /**
   * Короткоживущий вызов по каналу подключения — сперва одолженный канал вкладки, иначе свой
   * мастер (поднимает при необходимости). НЕ требует предварительного `acquire()` — сама решает,
   * какой канал использовать на этот один вызов. `opts.force` (не идёт в сам exec() канала,
   * только в `master.ensure()`) сбрасывает cooldown после провала auth — ручное «Обновить»
   * в панели должно суметь повторить попытку сразу, не дожидаясь `MASTER_FAILURE_COOLDOWN_MS`.
   * @returns {Promise<{ code: number|null, signal: string|null, stdout: Buffer, stderr: Buffer, timedOut: boolean }|{ error: string }>}
   */
  async exec(connectionId, connection, script, args = [], { force, ...opts } = {}) {
    if (IS_WIN) return { error: 'no-controlmaster' }

    const borrowed = this._sshSessionRegistry.findLiveChannelFor(connectionId)
    if (borrowed) {
      const result = await borrowed.exec(script, args, opts)
      // Одолженный канал развалился (мастер вкладки умер между findLiveChannelFor и exec —
      // маловероятно, но возможно) — фолбэк на собственный мастер панели, не отказ целиком.
      if (result.code !== 255) return result
    }

    const master = this._ensureMaster(connectionId, connection)
    const ready = await master.ensure({ force })
    if (!ready.ok) return { error: ready.reason }
    return master.exec(script, args, opts)
  }

  _ensureMaster(connectionId, connection) {
    let master = this._masters.get(connectionId)
    if (!master) {
      master = new SshConnectionMaster({
        connectionId,
        sshFile: findSshBinary(this._shellPathResolver.getResolvedPath()),
        target: `${connection.user}@${connection.host}`,
        port: connection.port || 22,
        privateKeyPath: connection.authType === 'key' ? connection.privateKeyPath : '',
        extraArgs: connection.extraArgs,
        secret: connection.secret
      })
      this._masters.set(connectionId, master)
    }
    return master
  }

  /** Страховка от утечки при закрытии/reload renderer, не дождавшегося парного `release()`. */
  releaseAllFor(connectionIds) {
    for (const id of connectionIds) this.release(id)
  }

  /** Гасит все панельные мастера — вызывается из `AppService.beforeQuit()`/`quit()`. */
  disposeAll() {
    for (const master of this._masters.values()) {
      try {
        master.dispose()
      } catch (e) {
        log.warn('[SshConnectionMasterRegistry] failed to dispose master', e.message)
      }
    }
    this._masters.clear()
  }
}
