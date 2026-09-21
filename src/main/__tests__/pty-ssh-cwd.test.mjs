import fs from 'fs'
import os from 'os'
import { PtyManager } from '../pty-manager.js'

// Регрессия: у подключённой SSH-вкладки tab.rootPath — УДАЛЁННЫЙ путь (OSC 7 / remoteCwd), и
// renderer отдавал его в pty:create как cwd для локального процесса `ssh`. Такого каталога на
// локальной машине нет — node-pty падал за ~20 мс с exitCode 1 и пустым выводом (новая
// SSH-вкладка от активной SSH-вкладки и любой реконнект после первого OSC 7).
// Тест на реальном node-pty: подменять spawn нечем — баг именно в его поведении при chdir.

const SSH = ['/usr/bin/ssh', '/bin/ssh', '/opt/homebrew/bin/ssh', '/usr/local/bin/ssh'].find((p) => fs.existsSync(p))

let failed = false
const results = []

if (!SSH) {
  console.log('⏭️  ssh не найден — пропуск')
  process.exit(0)
}

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

/** Запускает `ssh -V` через PtyManager.create() с заданным cwd и ждёт выхода. */
function runSsh(cwd) {
  return new Promise((resolve) => {
    let out = ''
    const webContents = {
      isDestroyed: () => false,
      send: (channel, payload) => {
        if (payload?.data) out += payload.data
        if (payload?.exitCode !== undefined) resolve({ exitCode: payload.exitCode, out })
      }
    }
    const manager = new PtyManager({
      shellPathResolver: {},
      sshSessionRegistry: { register() {}, dispose() {} }
    })
    manager.create({
      cols: 80,
      rows: 24,
      cwd,
      tabId: 't1',
      webContents,
      ssh: { connectionId: 'c1' },
      sshLaunch: { file: SSH, args: ['-V'], env: { ...process.env }, tmpDir: null, control: null }
    })
  })
}

async function check(label, fn) {
  try {
    await fn()
    console.log(`✅ ${label}`)
  } catch (e) {
    console.error(`❌ ${label}: ${e.message}`)
    failed = true
  }
  results.push(label)
}

await check('SSH PTY стартует с существующим локальным cwd', async () => {
  const { exitCode, out } = await runSsh(os.tmpdir())
  assert(exitCode === 0, `exitCode=${exitCode}, вывод=${JSON.stringify(out)}`)
})

await check('SSH PTY стартует, даже если cwd — удалённый путь, которого нет локально', async () => {
  const { exitCode, out } = await runSsh('/home/nonexistent-remote-user/projects/work/datafiller')
  assert(exitCode === 0, `exitCode=${exitCode}, вывод=${JSON.stringify(out)}`)
})

if (failed) {
  console.error('\n❌ Some tests failed')
  process.exit(1)
} else {
  console.log('\n✅ All tests passed')
}
