import fs from 'fs'
import os from 'os'
import path from 'path'

const IS_WIN = process.platform === 'win32'

/** Создаёт временный SSH_ASKPASS-скрипт, печатающий пароль из переменной окружения. */
export function createAskpassScript() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etty-ssh-'))
  const scriptPath = path.join(tmpDir, 'askpass.sh')
  fs.writeFileSync(scriptPath, '#!/bin/sh\nprintf \'%s\' "$ETTY_SSH_PASS"\n', { mode: 0o700 })
  fs.chmodSync(scriptPath, 0o700)
  return { tmpDir, scriptPath }
}

/**
 * Ставит в `env` переменные, под которыми `ssh` вызовет askpass-скрипт вместо запроса пароля
 * на tty. Общий код для интерактивного PTY-соединения (`ssh-command.js`) и неинтерактивного
 * служебного мастера панели (`ssh-connection-master.js`) — в обоих местах пароль/passphrase
 * подставляется одинаково.
 * @param {NodeJS.ProcessEnv} env — мутируется на месте
 * @param {string} secret — расшифрованный пароль/passphrase
 * @returns {{ tmpDir: string|null }} — `tmpDir` нужно удалить вызывающей стороне при завершении
 */
export function applyAskpassEnv(env, secret) {
  if (IS_WIN || !secret) return { tmpDir: null }
  try {
    const askpass = createAskpassScript()
    env.ETTY_SSH_PASS = secret
    env.SSH_ASKPASS = askpass.scriptPath
    env.SSH_ASKPASS_REQUIRE = 'force'
    // DISPLAY гарантирует, что старые версии ssh не откажутся вызывать askpass
    if (!env.DISPLAY) env.DISPLAY = ':0'
    return { tmpDir: askpass.tmpDir }
  } catch (e) {
    return { tmpDir: null }
  }
}
