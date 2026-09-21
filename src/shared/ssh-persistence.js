/**
 * Режим запуска SSH-вкладки (обычная сессия / tmux) — теперь свойство КОНКРЕТНОГО запуска
 * (переключатель SSH/tmux в боковой панели, см. renderer/features/ssh/ssh-panel.js), не
 * свойство сохранённого подключения. `connection.persistence` остаётся в ssh-store.js только
 * как fallback обратной совместимости — для вкладок, восстановленных из tabs-state.json без
 * явного persistence (сохранены до этой фичи) и для connectSshTab() без явного выбора режима.
 */

/**
 * @param {{ persistence?: 'off'|'tmux' }|null|undefined} sshOptions — то, что пришло с pty:create
 *   (options.ssh); `persistence` не задан (undefined) — источник не указал режим явно.
 * @param {{ persistence?: string }|null|undefined} connection — запись подключения из ssh-store.js
 * @returns {'off'|'tmux'}
 */
export function resolveSshPersistence(sshOptions, connection) {
  if (sshOptions?.persistence === 'tmux' || sshOptions?.persistence === 'off') {
    return sshOptions.persistence
  }
  return connection?.persistence === 'tmux' ? 'tmux' : 'off'
}
