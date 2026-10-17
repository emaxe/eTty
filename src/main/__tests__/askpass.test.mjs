import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSshVersion, isAskpassCapable, askpassScriptContent } from '../ssh/askpass.js'

test('parseSshVersion: Linux/macOS и Windows', () => {
  assert.deepEqual(parseSshVersion('OpenSSH_9.6p1, LibreSSL 3.3.6'), [9, 6])
  assert.deepEqual(parseSshVersion('OpenSSH_for_Windows_9.5p2, LibreSSL 3.8.2'), [9, 5])
  assert.equal(parseSshVersion('что-то другое'), null)
})

test('isAskpassCapable: порог 8.4', () => {
  assert.equal(isAskpassCapable([8, 3]), false)
  assert.equal(isAskpassCapable([8, 4]), true)
  assert.equal(isAskpassCapable([9, 0]), true)
  assert.equal(isAskpassCapable(null), false)
})

test('скрипт Windows: отложенное раскрытие, без echo %VAR%', () => {
  const s = askpassScriptContent(true)
  assert.ok(s.includes('EnableDelayedExpansion'))
  assert.ok(s.includes('!ETTY_SSH_PASS!'))
  assert.ok(!s.includes('%ETTY_SSH_PASS%'))
  assert.ok(askpassScriptContent(false).startsWith('#!/bin/sh'))
})
