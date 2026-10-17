import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPwshInitScript, buildPwshArgs, psQuote } from '../shell-integration/pwsh.js'
import { buildGitBashRc } from '../shell-integration/git-bash.js'

test('psQuote удваивает одинарные кавычки', () => {
  assert.equal(psQuote("C:\\Users\\O'Brien\\h.txt"), "'C:\\Users\\O''Brien\\h.txt'")
})

test('pwsh: OSC 7/133/6973 и обёртка исходного prompt', () => {
  const s = buildPwshInitScript()
  for (const part of [']7;', ']133;A', ']133;C', ']6973;node=', '__etty_orig_prompt', 'AcceptLine']) {
    assert.ok(s.includes(part), part)
  }
  assert.ok(!s.includes('HistorySavePath'))
})

test('pwsh: история подставляется безопасно', () => {
  const s = buildPwshInitScript({ historyFile: "C:\\h\\it's.pwsh_history" })
  assert.ok(s.includes("-HistorySavePath 'C:\\h\\it''s.pwsh_history'"))
})

test('pwsh: стиль промпта заменяет оригинальный prompt', () => {
  const s = buildPwshInitScript({ promptStyle: 'arrow' })
  assert.ok(s.includes("' ❯ '"))
  assert.ok(!s.includes('& $global:__etty_orig_prompt'))
})

test('pwsh: -EncodedCommand декодируется в исходный скрипт', () => {
  const opts = { promptStyle: 'minimal' }
  const args = buildPwshArgs(opts)
  assert.deepEqual(args.slice(0, 3), ['-NoLogo', '-NoExit', '-EncodedCommand'])
  assert.equal(Buffer.from(args[3], 'base64').toString('utf16le'), buildPwshInitScript(opts))
})

test('git bash: хуки, MSYS-путь и история', () => {
  const rc = buildGitBashRc({ historyFile: 'C:\\h\\t.bash_history', promptStyle: 'short' })
  assert.ok(rc.includes('cygpath -m'))
  assert.ok(rc.includes("HISTFILE='C:/h/t.bash_history'"))
  assert.ok(rc.includes('trap _etty_preexec DEBUG'))
  assert.ok(rc.includes("PS1='\\W \\$ '"))
})
