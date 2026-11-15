import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { ShellPathResolver } from '../shell-path-resolver.js'
import { findExecutable } from '../env-utils.js'

const unix = { skip: process.platform === 'win32' }
const nodeBin = '/test-user/.nvm/versions/node/v22.22.2/bin'
const baseEnv = { PATH: '/usr/bin:/bin' }

function markedOutput(args, value) {
  const delimiter = args.at(-1).match(/'(_SHELL_PATH_DELIMITER_[^']+)'/)[1]
  return `shell startup noise\n${delimiter}${value}${delimiter}\nshell exit noise`
}

test('ShellPathResolver: slow initialization retains the NVM-selected executable', unix, async () => {
  const resolver = new ShellPathResolver({
    env: baseEnv,
    execFile: async (_, args, { timeout }) => {
      if (timeout < 4000) throw Object.assign(new Error('timeout'), { killed: true, signal: 'SIGTERM' })
      return { stdout: markedOutput(args, `${nodeBin}:/usr/bin:/bin`) }
    }
  })
  const resolved = await resolver.resolve()
  assert.equal(findExecutable('codex', resolved, {
    exists: file => file === `${nodeBin}/codex`
  }), `${nodeBin}/codex`)
})

test('ShellPathResolver: complete PATH survives nonzero shell exit', unix, async () => {
  const resolver = new ShellPathResolver({
    env: baseEnv,
    execFile: async (_, args) => {
      throw Object.assign(new Error('logout failed'), {
        code: 1, killed: false, signal: null,
        stdout: markedOutput(args, `${nodeBin}:/usr/bin`), stderr: 'logout failure'
      })
    }
  })
  assert.equal((await resolver.resolve()).split(':')[0], nodeBin)
})

test('ShellPathResolver: startup chatter without complete markers is not PATH', unix, async () => {
  for (const partial of [false, true]) {
    const resolver = new ShellPathResolver({
      env: baseEnv,
      execFile: async (_, args) => ({
        stdout: partial
          ? markedOutput(args, '/untrusted/startup-chatter').split('/untrusted')[0] + '/untrusted/startup-chatter'
          : '/untrusted/startup-chatter'
      })
    })
    const resolved = (await resolver.resolve()).split(':')
    assert.equal(resolved.includes('/untrusted/startup-chatter'), false)
    assert.ok(resolved.includes('/usr/bin'))
  }
})

test('ShellPathResolver: stale eTty ZDOTDIR does not hide user shell initialization', unix, async () => {
  const env = { ...baseEnv, ZDOTDIR: path.join(os.tmpdir(), 'etty-a1B2c3') }
  const resolver = new ShellPathResolver({
    env,
    execFile: async (_, args, { env: childEnv }) => ({
      stdout: markedOutput(args, childEnv.ZDOTDIR ? '/usr/bin:/bin' : `${nodeBin}:/usr/bin:/bin`)
    })
  })
  assert.equal((await resolver.resolve()).split(':')[0], nodeBin)
  assert.equal(env.ZDOTDIR, path.join(os.tmpdir(), 'etty-a1B2c3'), 'parent environment must not change')
})

test('ShellPathResolver: eTty wrapper restores original custom ZDOTDIR', unix, async () => {
  const resolver = new ShellPathResolver({
    env: { ...baseEnv, ZDOTDIR: path.join(os.tmpdir(), 'etty-a1B2c3'), ETTY_ORIG_ZDOTDIR: '/custom-zsh' },
    execFile: async (_, args, { env }) => ({
      stdout: markedOutput(args, env.ZDOTDIR === '/custom-zsh' && !env.ETTY_ORIG_ZDOTDIR
        ? '/custom-zsh/bin:/usr/bin' : '/usr/bin')
    })
  })
  assert.equal((await resolver.resolve()).split(':')[0], '/custom-zsh/bin')
})

test('ShellPathResolver: legitimate custom ZDOTDIR is preserved', unix, async () => {
  const resolver = new ShellPathResolver({
    env: { ...baseEnv, ZDOTDIR: '/custom-zsh' },
    execFile: async (_, args, { env }) => ({
      stdout: markedOutput(args, env.ZDOTDIR === '/custom-zsh' ? '/custom-zsh/bin:/usr/bin' : '/usr/bin')
    })
  })
  assert.equal((await resolver.resolve()).split(':')[0], '/custom-zsh/bin')
})

test('ShellPathResolver: cache is shared and refresh discovers a new shell PATH', unix, async () => {
  let selected = '/first-node/bin'
  let probes = 0
  const resolver = new ShellPathResolver({
    env: baseEnv,
    execFile: async (_, args) => {
      probes++
      return { stdout: markedOutput(args, `${selected}:/usr/bin`) }
    }
  })
  const initial = await Promise.all([resolver.resolve(), resolver.resolve()])
  assert.equal(initial[0].split(':')[0], '/first-node/bin')
  assert.equal(initial[1], initial[0])
  assert.equal(probes, 1, 'concurrent resolve must share one probe')
  selected = '/second-node/bin'
  assert.equal(await resolver.resolve(), initial[0])
  assert.equal(probes, 1)
  assert.equal((await resolver.refresh()).split(':')[0], '/second-node/bin')
  assert.equal(probes, 2)
})

test('ShellPathResolver: failed refresh keeps the last good PATH', unix, async () => {
  let healthy = true
  const resolver = new ShellPathResolver({
    env: baseEnv,
    execFile: async (_, args) => {
      if (healthy) return { stdout: markedOutput(args, `${nodeBin}:/usr/bin`) }
      throw Object.assign(new Error('timeout'), { killed: true, signal: 'SIGTERM' })
    }
  })
  const good = await resolver.resolve()
  assert.equal(good.split(':')[0], nodeBin)
  healthy = false
  assert.equal(await resolver.refresh(), good, 'degraded probe must not replace a working PATH')
  assert.equal(resolver.getResolvedPath(), good)
})

test('ShellPathResolver: invalidate keeps the last good PATH available to PTY', unix, async () => {
  let probes = 0
  let release
  const resolver = new ShellPathResolver({
    env: baseEnv,
    execFile: async (_, args) => {
      probes++
      if (probes === 1) return { stdout: markedOutput(args, `${nodeBin}:/usr/bin`) }
      return new Promise((resolve) => {
        release = () => resolve({ stdout: markedOutput(args, '/new-node/bin:/usr/bin') })
      })
    }
  })
  const good = await resolver.resolve()
  resolver.invalidate()
  assert.equal(resolver.getResolvedPath(), good, 'synchronous PTY path must keep the previous value')
  const pending = resolver.resolve()
  assert.equal(resolver.getResolvedPath(), good)
  release()
  assert.equal((await pending).split(':')[0], '/new-node/bin')
})
