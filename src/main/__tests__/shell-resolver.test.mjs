import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveWindowsShell } from '../shell-integration/shell-resolver.js'
import { buildChildEnv, findExecutable, getPathValue } from '../env-utils.js'

const env = {
  Path: 'C:\\Windows\\System32;C:\\tools',
  ProgramFiles: 'C:\\Program Files',
  SystemRoot: 'C:\\Windows',
  ComSpec: 'C:\\Windows\\System32\\cmd.exe'
}
// ФС Windows регистронезависима
const withFiles = (...files) => (p) => files.some(f => f.toLowerCase() === p.toLowerCase())

test('auto: pwsh из PATH приоритетнее остальных', () => {
  const r = resolveWindowsShell('auto', { env, exists: withFiles('C:\\tools\\pwsh.exe', 'C:\\Windows\\System32\\powershell.exe') })
  assert.deepEqual(r, { file: 'C:\\tools\\pwsh.exe', kind: 'pwsh', fellBack: false })
})

test('auto: pwsh в Program Files, если нет в PATH', () => {
  const f = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
  assert.equal(resolveWindowsShell('auto', { env, exists: withFiles(f) }).file, f)
})

test('auto: без pwsh — Windows PowerShell, без него — cmd', () => {
  const ps = 'C:\\Windows\\System32\\powershell.exe'
  assert.equal(resolveWindowsShell('auto', { env, exists: withFiles(ps) }).kind, 'powershell')
  assert.equal(resolveWindowsShell('auto', { env, exists: withFiles() }).kind, 'cmd')
})

test('явный gitbash; отсутствующий — откат на auto с fellBack', () => {
  const bash = 'C:\\Program Files\\Git\\bin\\bash.exe'
  assert.equal(resolveWindowsShell('gitbash', { env, exists: withFiles(bash) }).kind, 'gitbash')
  const r = resolveWindowsShell('gitbash', { env, exists: withFiles('C:\\tools\\pwsh.exe') })
  assert.equal(r.kind, 'pwsh')
  assert.equal(r.fellBack, true)
})

test('произвольный путь определяет вид по имени файла', () => {
  const p = 'D:\\apps\\nu.exe'
  assert.deepEqual(resolveWindowsShell(p, { env, exists: withFiles(p) }), { file: p, kind: 'custom', fellBack: false })
})

test('buildChildEnv: Path/PATH на Windows не дублируются', () => {
  const out = buildChildEnv({ Path: 'a', Foo: '1' }, { PATH: 'b', Foo: undefined }, { platform: 'win32' })
  assert.deepEqual(out, { PATH: 'b' })
})

test('buildChildEnv: на POSIX ключи регистрозависимы', () => {
  const out = buildChildEnv({ PATH: 'a' }, { Path: 'b' }, { platform: 'linux' })
  assert.deepEqual(out, { PATH: 'a', Path: 'b' })
})

test('findExecutable: PATHEXT и готовое расширение', () => {
  const exists = withFiles('C:\\tools\\claude.cmd', 'C:\\tools\\pwsh.exe')
  assert.equal(findExecutable('claude', 'C:\\Windows;C:\\tools', { platform: 'win32', exists, pathExt: '.EXE;.CMD' }).toLowerCase(), 'c:\\tools\\claude.cmd')
  assert.equal(findExecutable('pwsh.exe', 'C:\\tools', { platform: 'win32', exists }), 'C:\\tools\\pwsh.exe')
  assert.equal(findExecutable('nope', 'C:\\tools', { platform: 'win32', exists }), null)
})

test('getPathValue: ключ Path на Windows', () => {
  assert.equal(getPathValue({ Path: 'x' }, { platform: 'win32' }), 'x')
  assert.equal(getPathValue({ PATH: 'y' }, { platform: 'linux' }), 'y')
})
