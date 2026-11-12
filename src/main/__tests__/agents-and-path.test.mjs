import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { findExecutable, extractCommandBinary } from '../env-utils.js'
import { getCommonUserBinDirs, extractPathDirsFromShellProfiles } from '../shell-path-resolver.js'
import { PtyManager } from '../pty-manager.js'
import { StatusBar } from '../../renderer/status-bar.js'

test('extractCommandBinary: извлекает бинарник с пропуском env-переменных и кавычек', () => {
  assert.equal(extractCommandBinary('claude'), 'claude')
  assert.equal(extractCommandBinary('  claude --dangerously-skip-permissions '), 'claude')
  assert.equal(extractCommandBinary('ANTHROPIC_BASE_URL=http://localhost:11434 claude --model x'), 'claude')
  assert.equal(extractCommandBinary('FOO="bar baz" ~/.opencode/bin/opencode --help'), '~/.opencode/bin/opencode')
  assert.equal(extractCommandBinary('"/opt/custom/my-agent" --flag'), '/opt/custom/my-agent')
  assert.equal(extractCommandBinary(''), '')
})

test('findExecutable: поддерживает прямые пути и ~/ помимо поиска в PATH', () => {
  const existing = new Set([
    '/Users/test/.opencode/bin/opencode',
    '/opt/custom/bin/my-agent'
  ])
  const exists = (p) => existing.has(p)

  assert.equal(
    findExecutable('~/.opencode/bin/opencode', '/usr/bin', {
      platform: 'darwin',
      exists,
      homedir: '/Users/test'
    }),
    '/Users/test/.opencode/bin/opencode'
  )

  assert.equal(
    findExecutable('/opt/custom/bin/my-agent', '/usr/bin', {
      platform: 'darwin',
      exists,
      homedir: '/Users/test'
    }),
    '/opt/custom/bin/my-agent'
  )

  assert.equal(
    findExecutable('opencode', '/usr/bin:/Users/test/.opencode/bin', {
      platform: 'darwin',
      exists,
      homedir: '/Users/test'
    }),
    '/Users/test/.opencode/bin/opencode'
  )
})

test('getCommonUserBinDirs и extractPathDirsFromShellProfiles: находят curl-установленные пакеты', () => {
  const home = '/Users/tester'
  const common = getCommonUserBinDirs(home, 'darwin')
  assert.ok(common.includes('/Users/tester/.opencode/bin'))
  assert.ok(common.includes('/Users/tester/.local/bin'))
  assert.ok(common.includes('/Users/tester/.bun/bin'))

  const fakeFiles = {
    '/Users/tester/.bashrc': 'export PATH="$HOME/.custom-curl-pkg/bin:$PATH"\n',
    '/Users/tester/.bash_profile': 'export PATH=${HOME}/.another-tool/bin:$PATH\n',
    '/Users/tester/.zshrc': '# comment\npath+=(~/.zsh-tool/bin)\n'
  }
  const existingDirs = new Set([
    '/Users/tester/.custom-curl-pkg/bin',
    '/Users/tester/.another-tool/bin',
    '/Users/tester/.zsh-tool/bin'
  ])

  const extracted = extractPathDirsFromShellProfiles(home, {
    exists: (p) => existingDirs.has(p),
    readFile: (p) => {
      if (p in fakeFiles) return fakeFiles[p]
      throw new Error('ENOENT')
    }
  })

  assert.deepEqual(extracted, [
    '/Users/tester/.zsh-tool/bin',
    '/Users/tester/.another-tool/bin',
    '/Users/tester/.custom-curl-pkg/bin'
  ])
})

test('PtyManager._createZdotdir: очищает ZDOTDIR и добавляет _etty_sync_path с rehash', () => {
  const pm = new PtyManager({
    shellPathResolver: { getDefaultShell: () => '/bin/zsh' },
    sshSessionRegistry: {}
  })
  const tmpDir = pm._createZdotdir('/tmp/fake-hist', 'default')
  try {
    const zshenv = fs.readFileSync(path.join(tmpDir, '.zshenv'), 'utf-8')
    const zshrc = fs.readFileSync(path.join(tmpDir, '.zshrc'), 'utf-8')

    assert.ok(zshenv.includes('unset ZDOTDIR'), '.zshenv должен сбрасывать временный ZDOTDIR перед source ~/.zshenv')
    assert.ok(zshrc.includes('unset ZDOTDIR'), '.zshrc должен сбрасывать временный ZDOTDIR, чтобы curl-инсталляторы писали в ~/.zshrc')
    assert.ok(zshrc.includes('.zprofile'), '.zshrc должен подгружать .zprofile')
    assert.ok(zshrc.includes('_etty_sync_path'), '.zshrc должен содержать хук синхронизации PATH')
    assert.ok(zshrc.includes('rehash'), '_etty_sync_path должен вызывать rehash для мгновенного обнаружения новых бинарников')
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('StatusBar: скрывает отключённых встроенных (forceDisabled) и кастомных (enabled: false) агентов', () => {
  const sb = Object.create(StatusBar.prototype)
  sb._agentConfigs = [
    { id: 'claude', label: 'Claude Code', enabled: true },
    { id: 'opencode', label: 'OpenCode', enabled: true },
    { id: 'custom-1', label: 'CodeWhale', enabled: false },
    { id: 'custom-2', label: 'MyAgent', enabled: true }
  ]
  sb._agentConfigById = new Map(sb._agentConfigs.map(a => [a.id, a]))
  sb._forceDisabled = { claude: true, opencode: false }
  sb._agentsById = new Map([
    ['claude', { id: 'claude', label: 'Claude', detected: true }],
    ['opencode', { id: 'opencode', label: 'OpenCode', detected: true }],
    ['custom-1', { id: 'custom-1', label: 'CodeWhale', detected: true }],
    ['custom-2', { id: 'custom-2', label: 'MyAgent', detected: true }]
  ])
  sb._activeTabBusy = false
  sb._activeAgentId = null
  sb._isRemote = false

  assert.equal(sb._isAgentHidden('claude'), true, 'встроенный агент с forceDisabled=true должен быть скрыт')
  assert.equal(sb._isAgentHidden('opencode'), false, 'включённый обнаруженный агент должен быть виден')
  assert.equal(sb._isAgentHidden('custom-1'), true, 'кастомный агент с enabled=false должен быть скрыт')
  assert.equal(sb._isAgentHidden('custom-2'), false, 'кастомный агент с enabled=true должен быть виден')

  const snapshot = sb.getQuickAccessSnapshot()
  assert.deepEqual(
    snapshot.agents.map(a => a.id),
    ['opencode', 'custom-2']
  )
})
