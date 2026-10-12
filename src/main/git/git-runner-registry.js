import { LocalGitRunner, SshGitRunner } from './git-runner.js'

/**
 * Резолвит `ctx` из IPC-payload (`{kind:'ssh', sessionId}` | `{kind:'local'}` | undefined)
 * в `GitRunner` для заданного корня. Отсутствие ctx = локальный раннер (прежнее поведение).
 */
export class GitRunnerRegistry {
  /** @param {{ sshSessionRegistry: import('../ssh/ssh-session-registry.js').SshSessionRegistry }} deps */
  constructor({ sshSessionRegistry }) {
    this._sshSessionRegistry = sshSessionRegistry
  }

  resolve(rootPath, ctx) {
    if (ctx?.kind === 'ssh' && ctx.sessionId != null) {
      const session = this._sshSessionRegistry.get(ctx.sessionId)
      if (!session || !session.fsProvider) {
        // Сессия закрыта или канал ещё не готов — вызывающий handler вернёт notARepo/error
        throw new Error('SSH session is not ready')
      }
      return new SshGitRunner(session.channel, session.fsProvider, rootPath)
    }
    return new LocalGitRunner(rootPath)
  }
}
