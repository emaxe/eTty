import fs from 'fs'
import os from 'os'
import path from 'path'
import log from 'electron-log'

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
 * @param {{ connection: object, resolvedPath: string|null }} params
 *   `connection` — результат `ssh-store.getConnectionForLaunch()` (с расшифрованным `secret`).
 * @returns {{ file: string, args: string[], env: object, tmpDir: string|null }}
 */
export function buildSshLaunch({ connection, resolvedPath }) {
  const file = findSshBinary(resolvedPath)
  const args = [
    '-tt',
    '-p', String(connection.port || 22),
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'NumberOfPasswordPrompts=1'
  ]

  if (connection.authType === 'key' && connection.privateKeyPath) {
    args.push('-i', connection.privateKeyPath)
  }

  const extraArgs = (connection.extraArgs || '').trim()
  if (extraArgs) {
    args.push(...extraArgs.split(/\s+/).filter(Boolean))
  }

  args.push(`${connection.user}@${connection.host}`)

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

  return { file, args, env, tmpDir }
}
