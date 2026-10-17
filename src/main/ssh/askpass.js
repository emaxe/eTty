import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'

const IS_WIN = process.platform === 'win32'

/** SSH_ASKPASS_REQUIRE=force появился в OpenSSH 8.4. */
const MIN_ASKPASS_REQUIRE_VERSION = [8, 4]

/**
 * `OpenSSH_9.6p1 ...` / `OpenSSH_for_Windows_9.5p2, LibreSSL ...` → [9, 6]; иначе null.
 * @param {string} text — вывод `ssh -V` (идёт в stderr)
 */
export function parseSshVersion(text) {
  const m = /OpenSSH_(?:for_Windows_)?(\d+)\.(\d+)/.exec(String(text || ''))
  return m ? [Number(m[1]), Number(m[2])] : null
}

export function isAskpassCapable(version) {
  if (!version) return false
  const [maj, min] = version
  const [needMaj, needMin] = MIN_ASKPASS_REQUIRE_VERSION
  return maj > needMaj || (maj === needMaj && min >= needMin)
}

const versionCache = new Map()

/** Версия ssh-клиента (кэшируется по пути к бинарю; один синхронный запуск `ssh -V`). */
function getSshVersion(sshFile) {
  if (!versionCache.has(sshFile)) {
    let version = null
    try {
      const r = spawnSync(sshFile, ['-V'], { encoding: 'utf-8', timeout: 3000, windowsHide: true })
      version = parseSshVersion(`${r.stderr || ''}${r.stdout || ''}`)
    } catch {
      // не удалось запустить ssh — считаем askpass недоступным
    }
    versionCache.set(sshFile, version)
  }
  return versionCache.get(sshFile)
}

/**
 * Содержимое askpass-скрипта. Windows: отложенное раскрытие `!VAR!` не пере-парсит значение, так что
 * `& | ^ %` в пароле безопасны (с обычным `echo %VAR%` они бы исполнились как команды cmd).
 */
export function askpassScriptContent(win = IS_WIN) {
  return win
    ? '@echo off\r\nsetlocal EnableDelayedExpansion\r\n<nul set /p "=!ETTY_SSH_PASS!"\r\n'
    : '#!/bin/sh\nprintf \'%s\' "$ETTY_SSH_PASS"\n'
}

/** Создаёт временный SSH_ASKPASS-скрипт, печатающий пароль из переменной окружения. */
export function createAskpassScript() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etty-ssh-'))
  const scriptPath = path.join(tmpDir, IS_WIN ? 'askpass.cmd' : 'askpass.sh')
  fs.writeFileSync(scriptPath, askpassScriptContent(), { mode: 0o700 })
  if (!IS_WIN) fs.chmodSync(scriptPath, 0o700)
  return { tmpDir, scriptPath }
}

/**
 * Ставит в `env` переменные, под которыми `ssh` вызовет askpass-скрипт вместо запроса пароля
 * на tty. Общий код для интерактивного PTY-соединения (`ssh-command.js`) и неинтерактивного
 * служебного мастера панели (`ssh-connection-master.js`) — в обоих местах пароль/passphrase
 * подставляется одинаково.
 * @param {NodeJS.ProcessEnv} env — мутируется на месте
 * @param {string} secret — расшифрованный пароль/passphrase
 * @param {{ sshFile?: string }} [opts] — на Windows нужен для проверки версии OpenSSH (≥ 8.4);
 *   со старым клиентом пароль не подставляется — ssh спросит его в терминале
 * @returns {{ tmpDir: string|null }} — `tmpDir` нужно удалить вызывающей стороне при завершении
 */
export function applyAskpassEnv(env, secret, { sshFile = 'ssh' } = {}) {
  if (!secret) return { tmpDir: null }
  if (IS_WIN && !isAskpassCapable(getSshVersion(sshFile))) return { tmpDir: null }
  try {
    const askpass = createAskpassScript()
    env.ETTY_SSH_PASS = secret
    env.SSH_ASKPASS = askpass.scriptPath
    env.SSH_ASKPASS_REQUIRE = 'force'
    // DISPLAY гарантирует, что старые версии ssh не откажутся вызывать askpass (на Windows не нужен)
    if (!IS_WIN && !env.DISPLAY) env.DISPLAY = ':0'
    return { tmpDir: askpass.tmpDir }
  } catch (e) {
    return { tmpDir: null }
  }
}
