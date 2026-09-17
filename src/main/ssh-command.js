import fs from 'fs'
import os from 'os'
import path from 'path'
import log from 'electron-log'
import { buildRemoteInitCommand } from './ssh/remote-shell-hooks.js'
import { createControlSocket } from './ssh/ssh-control-channel.js'

const IS_WIN = process.platform === 'win32'

const SSH_CANDIDATES = IS_WIN
  ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe')]
  : ['/usr/bin/ssh', '/bin/ssh', '/opt/homebrew/bin/ssh', '/usr/local/bin/ssh']

/** Ищет исполняемый `ssh` в resolvedPath (PATH), иначе — в типовых системных путях. */
function findSshBinary(resolvedPath) {
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

/** Создаёт временный SSH_ASKPASS-скрипт, печатающий пароль из переменной окружения. */
function createAskpassScript() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etty-ssh-'))
  const scriptPath = path.join(tmpDir, 'askpass.sh')
  fs.writeFileSync(scriptPath, '#!/bin/sh\nprintf \'%s\' "$ETTY_SSH_PASS"\n', { mode: 0o700 })
  fs.chmodSync(scriptPath, 0o700)
  return { tmpDir, scriptPath }
}

/**
 * Собирает параметры запуска `ssh` для node-pty. Побочный эффект: при наличии
 * сохранённого пароля/passphrase на macOS/Linux создаёт временный SSH_ASKPASS-скрипт
 * (вызывающий код обязан очистить `tmpDir`, как и обычный ZDOTDIR).
 *
 * @param {{ connection: object, resolvedPath: string|null, skipShellIntegration?: boolean }} params
 *   `connection` — результат `ssh-store.getConnectionForLaunch()` (с расшифрованным `secret`).
 *   `skipShellIntegration` — форсированно отключить инжект хуков для ОДНОЙ попытки подключения
 *   (используется при авто-реконнекте после быстрого падения PTY, см. `connectSshTab` в renderer) —
 *   не путать с `connection.injectShellIntegration`, постоянной настройкой самого подключения.
 * @returns {{ file: string, args: string[], env: object, tmpDir: string|null,
 *   control: { dir: string, path: string, target: string, port: number } | null }}
 *   `control` — параметры ControlMaster-сокета для `SshControlChannel` (Этап 4, удалённая ФС),
 *   `null` на Windows (OpenSSH для Windows не поддерживает мультиплексирование) либо когда путь
 *   к сокету не влезает в лимит `sun_path` даже с фолбэком на `/tmp` (см. `createControlSocket`).
 */
export function buildSshLaunch({ connection, resolvedPath, skipShellIntegration = false }) {
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
  if (connection.injectShellIntegration !== false && !skipShellIntegration) {
    args.push(buildRemoteInitCommand())
  }

  const env = {
    ...process.env,
    PATH: resolvedPath || process.env.PATH || (IS_WIN ? '' : '/usr/bin:/bin:/usr/sbin:/sbin'),
    LANG: process.env.LANG || 'en_US.UTF-8',
    LC_CTYPE: process.env.LC_CTYPE || 'en_US.UTF-8'
  }

  let tmpDir = null
  // Секрет используется и для пароля пользователя, и для passphrase приватного ключа —
  // SSH_ASKPASS перехватывает оба типа запросов одинаково.
  const wantsAskpass = !IS_WIN && connection.secret && (connection.authType === 'password' || connection.authType === 'key')

  if (wantsAskpass) {
    try {
      const askpass = createAskpassScript()
      tmpDir = askpass.tmpDir
      env.ETTY_SSH_PASS = connection.secret
      env.SSH_ASKPASS = askpass.scriptPath
      env.SSH_ASKPASS_REQUIRE = 'force'
      // DISPLAY гарантирует, что старые версии ssh не откажутся вызывать askpass
      if (!env.DISPLAY) env.DISPLAY = ':0'
    } catch (e) {
      log.warn('ssh-command: failed to create askpass script, password won\'t be auto-filled', e.message)
    }
  }

  return { file, args, env, tmpDir, control }
}
