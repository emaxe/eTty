import test from 'node:test'
import assert from 'node:assert/strict'
import { createShellCommands, dialectForShellKind, isRunnableFile, DIALECTS } from '../../renderer/core/shell-commands.js'

test('dialectForShellKind', () => {
  assert.equal(dialectForShellKind('pwsh'), DIALECTS.PWSH)
  assert.equal(dialectForShellKind('powershell'), DIALECTS.PWSH)
  assert.equal(dialectForShellKind('cmd'), DIALECTS.CMD)
  assert.equal(dialectForShellKind('gitbash'), DIALECTS.GITBASH)
  assert.equal(dialectForShellKind('zsh'), DIALECTS.POSIX)
  assert.equal(dialectForShellKind(null), DIALECTS.POSIX)
})

test('POSIX: кавычки в пути экранируются, Ctrl+U', () => {
  const c = createShellCommands(DIALECTS.POSIX)
  assert.equal(c.cd("/a/it's"), "cd '/a/it'\\''s'\r")
  assert.equal(c.clearLine, '\x15')
  assert.equal(c.run('/x/a.sh', 'a.sh'), "sh '/x/a.sh'\r")
  assert.equal(createShellCommands(DIALECTS.POSIX, { platform: 'linux' }).open('/x'), "xdg-open '/x'\r")
})

test('PowerShell: -LiteralPath, удвоение кавычек, Esc, $env', () => {
  const c = createShellCommands(DIALECTS.PWSH)
  assert.equal(c.cd("C:\\Users\\O'B"), "Set-Location -LiteralPath 'C:\\Users\\O''B'\r")
  assert.equal(c.run('C:\\s\\a.ps1', 'a.ps1'), "& 'C:\\s\\a.ps1'\r")
  assert.equal(c.clearLine, '\x1b')
  assert.equal(c.withEnv({ http_proxy: 'http://p:1' }, 'claude\r'), "$env:http_proxy='http://p:1'; claude\r")
})

test('cmd: cd /d и set', () => {
  const c = createShellCommands(DIALECTS.CMD)
  assert.equal(c.cd('C:\\a b'), 'cd /d "C:\\a b"\r')
  assert.equal(c.home(), 'cd /d %USERPROFILE%\r')
  assert.equal(c.withEnv({ A: '1' }, 'x'), 'set "A=1" && x')
})

test('Git Bash: cd с прямыми слэшами', () => {
  assert.equal(createShellCommands(DIALECTS.GITBASH).cd('C:\\Users\\a'), "cd 'C:/Users/a'\r")
})

test('isRunnableFile зависит от ОС клиента и ФС', () => {
  assert.equal(isRunnableFile('a.bat', { platform: 'win32' }), true)
  assert.equal(isRunnableFile('a.sh', { platform: 'win32' }), false)
  assert.equal(isRunnableFile('a.sh', { platform: 'win32', remote: true }), true)
  assert.equal(isRunnableFile('a.sh', { platform: 'darwin' }), true)
  assert.equal(isRunnableFile('a', { platform: 'darwin' }), false)
})

test('useNode: диалекты и неподдерживаемые менеджеры', () => {
  assert.equal(createShellCommands(DIALECTS.POSIX).useNode('asdf', '20.1.0'), 'asdf shell nodejs 20.1.0')
  assert.equal(createShellCommands(DIALECTS.PWSH).useNode('fnm', '20'), 'fnm env --shell powershell | Out-String | Invoke-Expression; fnm use 20')
  assert.equal(createShellCommands(DIALECTS.PWSH).useNode('nvm', '20'), 'nvm use 20')
  assert.equal(createShellCommands(DIALECTS.PWSH).useNode('volta', '20'), null)
  assert.equal(createShellCommands(DIALECTS.CMD).useNode('fnm', '20'), null)
})
