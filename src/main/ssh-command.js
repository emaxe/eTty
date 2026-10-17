import fs from 'fs'
import { buildChildEnv } from './env-utils.js'
import path from 'path'
import { buildRemoteInitCommand } from './ssh/remote-shell-hooks.js'
import { createControlSocket } from './ssh/ssh-control-channel.js'
import { applyAskpassEnv } from './ssh/askpass.js'
import { resolveSshPersistence } from '../shared/ssh-persistence.js'
import { SSH_SESSION_CONFIG } from '../shared/ssh-session-config.js'

const IS_WIN = process.platform === 'win32'

const SSH_CANDIDATES = IS_WIN
  ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe')]
  : ['/usr/bin/ssh', '/bin/ssh', '/opt/homebrew/bin/ssh', '/usr/local/bin/ssh']

/**
 * Ищет исполняемый `ssh` в resolvedPath (PATH), иначе — в типовых системных путях. Экспортируется
 * — переиспользуется `SshConnectionMaster` (ssh/ssh-connection-master.js) для панельного мастера.
 */
export function findSshBinary(resolvedPath) {
  const dirs = (resolvedPath || '').split(path.delimiter).filter(Boolean)
  const name = IS_WIN ? 'ssh.exe' : 'ssh'
  for (const dir of dirs) {
    const candidate = path.join(dir, name)
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      // не найден в этой директории — пробуем следующую
    }
  }
  for (const candidate of SSH_CANDIDATES) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      // пропускаем
    }
  }
  return IS_WIN ? 'ssh.exe' : 'ssh'
}

/**
 * Собирает параметры запуска `ssh` для node-pty. Побочный эффект: при наличии
 * сохранённого пароля/passphrase на macOS/Linux создаёт временный SSH_ASKPASS-скрипт
 * (вызывающий код обязан очистить `tmpDir`, как и обычный ZDOTDIR).
 *
 * @param {{ connection: object, resolvedPath: string|null, skipShellIntegration?: boolean,
 *   sessionName?: string|null, persistence?: 'off'|'tmux' }} params
 *   `connection` — результат `ssh-store.getConnectionForLaunch()` (с расшифрованным `secret`).
 *   `skipShellIntegration` — форсированно отключить инжект хуков для ОДНОЙ попытки подключения
 *   (используется при авто-реконнекте после быстрого падения PTY, см. `connectSshTab` в renderer) —
 *   не путать с `connection.injectShellIntegration`, постоянной настройкой самого подключения.
 *   `persistence` — режим ЭТОГО запуска (панель SSH/tmux в renderer передаёт его явно с каждым
 *   pty:create); не задан — используется `connection.persistence` как fallback обратной
 *   совместимости, см. `ssh/ssh-persistence.js`. При `'tmux'` remote-команда (и, значит, сама
 *   tmux-сессия) нужна ВСЕГДА, даже если `skipShellIntegration` отключает именно OSC/ZDOTDIR-хуки —
 *   см. `hooksWanted` ниже; `sessionName` в этом случае обязателен (валидируется в
 *   `buildRemoteInitCommand`).
 * @returns {{ file: string, args: string[], env: object, tmpDir: string|null,
 *   control: { dir: string, path: string, target: string, port: number } | null,
 *   stdio: { sshFile: string, target: string, args: string[], env: object } | null }}
 *   `control` — параметры ControlMaster-сокета для `SshControlChannel` (Этап 4, удалённая ФС),
 *   `null` на Windows (OpenSSH для Windows не поддерживает мультиплексирование) либо когда путь
 *   к сокету не влезает в лимит `sun_path` даже с фолбэком на `/tmp` (см. `createControlSocket`) —
 *   тогда вместо него заполняется `stdio` (параметры `SshStdioChannel`).
 */
export function buildSshLaunch({ connection, resolvedPath, skipShellIntegration = false, sessionName = null, persistence = undefined }) {
  const file = findSshBinary(resolvedPath)
  const port = connection.port || 22
  const target = `${connection.user}@${connection.host}`
  const args = [
    '-tt',
    '-p', String(port),
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'NumberOfPasswordPrompts=1'
  ]

  // ControlMaster — мультиплексирование для служебных вызовов удалённой ФС (Этап 4) по тому же
  // соединению, без повторной аутентификации. ControlPersist=10 (не `no`): служебный вызов,
  // начатый в момент выхода из интерактивной сессии, успевает завершиться; ghost-мастер
  // гарантированно убивается через `ssh -O exit` (см. PtyManager.kill/onExit).
  let control = null
  const socket = createControlSocket()
  if (socket) {
    control = { dir: socket.dir, path: socket.path, target, port }
    args.push(
      '-o', 'ControlMaster=auto',
      '-o', `ControlPath=${socket.path}`,
      '-o', 'ControlPersist=10'
    )
  }

  if (connection.authType === 'key' && connection.privateKeyPath) {
    args.push('-i', connection.privateKeyPath)
  }

  const extraArgs = (connection.extraArgs || '').trim()
  if (extraArgs) {
    args.push(...extraArgs.split(/\s+/).filter(Boolean))
  }

  args.push(target)

  // Remote-команда — ПОЗИЦИОННЫЙ аргумент после user@host (не `-o RemoteCommand=`: тот
  // конфликтует с аргументом командной строки и требует RequestTTY). `-tt` уже стоит и
  // как раз нужен — с remote-командой ssh по умолчанию tty не выделяет. Один элемент argv,
  // без локального shell — node-pty вызывает ssh через execve, поэтому OpenSSH получит
  // этот текст как один-единственный «command», без собственного join/re-quoting.
  //
  // persistence:'tmux' требует remote-команду ВСЕГДА — это она поднимает саму tmux-сессию,
  // а не только хуки. Поэтому условие — «хуки ИЛИ персистентность», не только хуки (ловушка,
  // см. план: без этого выключенные хуки на подключении с включённым tmux молча ломали бы
  // персистентность).
  const resolvedPersistence = resolveSshPersistence({ persistence }, connection)
  const hooksWanted = connection.injectShellIntegration !== false && !skipShellIntegration
  if (resolvedPersistence === 'tmux' || hooksWanted) {
    args.push(buildRemoteInitCommand({
      persistence: resolvedPersistence,
      sessionName: resolvedPersistence === 'tmux' ? sessionName : null,
      hooks: hooksWanted,
      socketName: connection.tmuxSocket ?? SSH_SESSION_CONFIG.DEFAULT_SOCKET
    }))
  }

  const env = buildChildEnv(process.env, {
    PATH: resolvedPath || process.env.PATH || (IS_WIN ? '' : '/usr/bin:/bin:/usr/sbin:/sbin'),
    LANG: process.env.LANG || 'en_US.UTF-8',
    LC_CTYPE: process.env.LC_CTYPE || 'en_US.UTF-8'
  })

  // Секрет используется и для пароля пользователя, и для passphrase приватного ключа —
  // SSH_ASKPASS перехватывает оба типа запросов одинаково.
  const wantsAskpass = connection.secret && (connection.authType === 'password' || connection.authType === 'key')
  const { tmpDir } = wantsAskpass ? applyAskpassEnv(env, connection.secret, { sshFile: file }) : { tmpDir: null }

  // Без ControlMaster (Windows) служебные вызовы идут по отдельному долгоживущему `ssh -T … /bin/sh`
  // (ssh-stdio-channel.js): ему нужны те же порт/ключ/доп. аргументы и тот же askpass-env. Без
  // askpass — BatchMode, иначе ssh завис бы на невидимом запросе пароля.
  let stdio = null
  if (!control) {
    const stdioArgs = ['-p', String(port), '-o', 'NumberOfPasswordPrompts=1', '-o', 'ConnectTimeout=10']
    if (!tmpDir) stdioArgs.push('-o', 'BatchMode=yes')
    if (connection.authType === 'key' && connection.privateKeyPath) stdioArgs.push('-i', connection.privateKeyPath)
    if (extraArgs) stdioArgs.push(...extraArgs.split(/\s+/).filter(Boolean))
    stdio = { sshFile: file, target, args: stdioArgs, env }
  }

  return { file, args, env, tmpDir, control, stdio }
}
