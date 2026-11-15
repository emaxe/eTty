import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { findExecutable, extractCommandBinary } from '../env-utils.js'
import { getCommonUserBinDirs, extractPathDirsFromShellProfiles } from '../shell-path-resolver.js'
import { PtyManager } from '../pty-manager.js'
import { AgentService } from '../agent-service.js'
import { StatusBar } from '../../renderer/status-bar.js'
import { SettingsPage } from '../../renderer/settings-page.js'

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

test('StatusBar: manual enable overrides failed detection in buttons and radial menu', () => {
  const sb = Object.create(StatusBar.prototype)
  sb._agentConfigs = [{ id: 'codex', label: 'Codex' }]
  sb._agentConfigById = new Map(sb._agentConfigs.map(a => [a.id, a]))
  sb._agentsById = new Map([['codex', { id: 'codex', detected: false }]])
  sb._forceDisabled = { codex: false }
  sb._forceEnabled = {}
  sb._activeTabBusy = false
  sb._activeAgentId = null
  sb._isRemote = false

  const button = {
    dataset: { agentId: 'codex' }, style: {}, textContent: 'Codex',
    classList: { toggle() {} }
  }
  sb._agentButtons = [button]
  sb._updateAgentButtons()
  assert.equal(button.style.display, 'none')
  sb.setForceEnabled({ codex: true })

  assert.equal(sb._isAgentHidden('codex'), false)
  assert.equal(button.style.display, '')
  assert.equal(button.disabled, false)
  assert.deepEqual(sb.getQuickAccessSnapshot().agents, [{ id: 'codex', label: 'Codex' }])
  sb.setAgentsStatus({ agents: [{ id: 'codex', detected: false }] })
  assert.equal(sb._isAgentHidden('codex'), false, 'refresh must not erase manual choice')

  sb.setForceDisabled({ codex: true })
  assert.equal(sb._isAgentHidden('codex'), true, 'disable wins over enable')
  assert.equal(button.style.display, 'none')
  sb._forceDisabled.codex = false
  sb._activeTabBusy = true
  sb._activeAgentId = 'claude'
  assert.equal(sb._isAgentHidden('codex'), true, 'another busy agent remains protected')
  sb._activeTabBusy = false
  sb._forceEnabled = {}
  assert.equal(sb._isAgentHidden('codex'), true, 'old false defaults are still automatic')
})

test('StatusBar: enabled custom agent remains available when its check command is missing', () => {
  const sb = Object.create(StatusBar.prototype)
  sb._agentConfigs = [{ id: 'custom-1', label: 'Custom', enabled: true }]
  sb._agentConfigById = new Map(sb._agentConfigs.map(a => [a.id, a]))
  sb._agentsById = new Map([['custom-1', { detected: false }]])
  sb._forceDisabled = {}
  sb._activeTabBusy = false
  assert.deepEqual(sb.getQuickAccessSnapshot().agents, [{ id: 'custom-1', label: 'Custom' }])
  sb._agentConfigs[0].enabled = false
  assert.deepEqual(sb.getQuickAccessSnapshot().agents, [])
})

// Minimal DOM boundary: exercise real settings control and its change listener.
class SettingsElement extends EventTarget {
  children = []
  isConnected = true
  appendChild(child) { this.children.push(child) }
  querySelector() { return this.children.find(child => child.type === 'checkbox') }
}

test('SettingsPage: missing agent can be checked and manual choice survives reload', (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => new SettingsElement() }
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'document', original)
    else delete globalThis.document
  })
  const page = Object.create(SettingsPage.prototype)
  page._config = { agents: { forceDisabled: { codex: false } } }
  page._agentStatusById = new Map([['codex', { id: 'codex', detected: false }]])
  const changes = []
  page._bus = { emit: (_, change) => changes.push(change) }
  let saved
  page._scheduleSave = () => { saved = JSON.stringify(page._config) }
  page._ensureAgentSettings()
  const control = page._buildAgentControl('codex')
  const checkbox = control.children.find(el => el.className === 'settings-toggle').children[0]

  assert.equal(checkbox.checked, false, 'missing agent must allow an explicit enable action')
  checkbox.checked = true
  checkbox.dispatchEvent(new Event('change'))
  assert.equal(page._config.agents.forceEnabled.codex, true)
  assert.equal(page._config.agents.forceDisabled.codex, false)
  assert.ok(changes.some(change => change.key === 'agents.forceEnabled' && change.value.codex === true))

  page._config = JSON.parse(saved)
  page._ensureAgentSettings()
  const reloaded = page._buildAgentControl('codex')
  assert.equal(reloaded.children.find(el => el.className === 'settings-toggle').children[0].checked, true)
  assert.equal(reloaded.children[0].textContent, 'Не обнаружен', 'enable must not fake detection')

  checkbox.checked = false
  checkbox.dispatchEvent(new Event('change'))
  assert.equal(page._config.agents.forceEnabled.codex, undefined, 'auto default must not accumulate explicit false')
  assert.equal(page._config.agents.forceDisabled.codex, true)
})

test('AgentService: refresh forces a fresh PATH probe so PTY never sees a cleared cache', async () => {
  const calls = []
  const resolver = {
    getResolvedPath: () => '/resolved/bin:/usr/bin',
    resolve: async () => { calls.push('resolve'); return '/usr/bin:/bin' },
    refresh: async () => { calls.push('refresh'); return '/usr/bin:/bin' },
    invalidate: () => calls.push('invalidate')
  }
  const service = new AgentService({ shellPathResolver: resolver })
  const status = await service.refresh([], {})
  assert.deepEqual(calls, ['refresh'])
  assert.ok(status.agents.some(agent => agent.id === 'codex'))
})

test('SettingsPage: command recheck updates automatic checkbox without overriding manual choice', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true, value: { createElement: () => new SettingsElement() }
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'document', original)
    else delete globalThis.document
  })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const page = Object.create(SettingsPage.prototype)
  page._config = { agents: {} }
  page._agentStatusById = new Map([['codex', { detected: false }]])
  page._bus = { emit() {} }
  page._scheduleSave = () => {}
  page._api = { agentsRefresh: async () => ({ agents: [{ id: 'codex', detected: true }] }) }
  page._ensureAgentSettings()
  const control = page._buildAgentControl('codex')
  const checkbox = control.children.find(el => el.className === 'settings-toggle').children[0]
  const input = control.children.find(el => el.type === 'text')
  assert.equal(checkbox.checked, false)
  input.value = 'codex'
  input.dispatchEvent(new Event('input'))
  t.mock.timers.tick(350)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(control.children[0].textContent, 'Обнаружен')
  assert.equal(checkbox.checked, true)

  checkbox.checked = false
  checkbox.dispatchEvent(new Event('change'))
  input.dispatchEvent(new Event('input'))
  t.mock.timers.tick(350)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(checkbox.checked, false, 'recheck must not undo manual disable')
})
