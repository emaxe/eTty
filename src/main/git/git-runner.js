import simpleGit from 'simple-git'
import fs from 'fs/promises'
import path from 'path'
import { SSH_FS_CONFIG } from '../../shared/ssh-fs-config.js'

/**
 * Абстракция «где выполняется git»: локальный диск или удалённый хост по SSH.
 * Интерфейс: `run(args, opts) → stdout`, `readFile(relPath) → string`. Ошибка git (код ≠ 0) = throw.
 */

export class LocalGitRunner {
  constructor(rootPath) {
    this._rootPath = rootPath
  }

  async run(args) {
    return simpleGit(this._rootPath).raw(args)
  }

  async readFile(relPath) {
    return fs.readFile(path.join(this._rootPath, relPath), 'utf-8')
  }
}

// cd + git без интерполяции путей в строку скрипта (всё через позиционные аргументы).
// GIT_OPTIONAL_LOCKS=0 — polling статуса не должен конкурировать за index.lock с пользователем.
// GIT_TERMINAL_PROMPT=0 — push/fetch без кредов падает, а не висит в ожидании ввода.
const REMOTE_GIT_SCRIPT = 'cd -- "$1" || exit 128; shift; ' +
  'GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 LC_ALL=C exec git "$@"'

const LONG_OPS = new Set(['push', 'commit', 'checkout', 'clean'])

export class SshGitRunner {
  /**
   * @param {import('../ssh/ssh-control-channel.js').SshControlChannel} channel
   * @param {import('../fs/ssh-fs-provider.js').SshFsProvider|null} fsProvider
   * @param {string} rootPath — удалённый путь
   */
  constructor(channel, fsProvider, rootPath) {
    this._channel = channel
    this._fsProvider = fsProvider
    this._rootPath = rootPath
  }

  async run(args) {
    const timeoutMs = LONG_OPS.has(args[0]) ? SSH_FS_CONFIG.IO_TIMEOUT_MS : SSH_FS_CONFIG.OP_TIMEOUT_MS
    const result = await this._channel.exec(REMOTE_GIT_SCRIPT, [this._rootPath, ...args], { timeoutMs })
    if (result.code !== 0) {
      const msg = result.error
        || (result.timedOut ? 'git: timeout' : result.stderr.toString('utf-8').trim())
        || `git exited with code ${result.code}`
      throw new Error(msg)
    }
    return result.stdout.toString('utf-8')
  }

  async readFile(relPath) {
    if (!this._fsProvider) throw new Error('SSH remote FS session is not ready')
    const full = this._rootPath.replace(/\/+$/, '') + '/' + relPath
    const res = await this._fsProvider.readFile(full)
    if (!res?.success) throw new Error(res?.error || 'readFile failed')
    return res.content
  }
}
