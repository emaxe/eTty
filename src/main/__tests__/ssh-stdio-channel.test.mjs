import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { SshStdioChannel } from '../ssh/ssh-stdio-channel.js'
import { encodeRequest, FrameParser, buildDispatcherScript, posixQuote } from '../ssh/ssh-stdio-protocol.js'

// «Удалённая сторона» — локальный /bin/sh: канал запускает spawnImpl вместо ssh, остальной путь тот же
function localChannel(extra = {}) {
  return new SshStdioChannel({
    sshFile: 'ssh', args: [], target: 'user@host',
    spawnImpl: () => spawn('/bin/sh', [], { stdio: ['pipe', 'pipe', 'pipe'] }),
    ...extra
  })
}

test('encodeRequest: одна строка, base64-поля, пустой stdin = "-"', () => {
  const line = encodeRequest({ id: 7, script: 'echo hi', args: ['a b', "it's"] }).toString()
  assert.ok(line.endsWith('\n') && line.indexOf('\n') === line.length - 1)
  const [op, id, a, sc, i] = line.trim().split(' ')
  assert.deepEqual([op, id, i], ['R', '7', '-'])
  assert.equal(Buffer.from(a, 'base64').toString(), "set -- 'a b' 'it'\\''s'\n")
  assert.equal(Buffer.from(sc, 'base64').toString(), 'echo hi')
})

test('FrameParser: шум до READY, кадры по частям, бинарные данные', () => {
  const frames = []
  let ready = false
  const p = new FrameParser({ nonce: 'abc', onReady: () => { ready = true }, onFrame: f => frames.push(f) })
  const data = Buffer.concat([
    Buffer.from('motd noise\nETTY-READY ab'),
  ])
  p.feed(data)
  assert.equal(ready, false)
  p.feed(Buffer.from('c\nETTY-RES 1 0 3 2\n'))
  p.feed(Buffer.from([0xff, 0x00, 0x0a]))
  p.feed(Buffer.from('ok'))
  assert.equal(ready, true)
  assert.equal(frames.length, 1)
  assert.deepEqual([...frames[0].stdout], [0xff, 0x00, 0x0a])
  assert.equal(frames[0].stderr.toString(), 'ok')
})

test('exec: stdout, stderr, код выхода и аргументы со спецсимволами', { skip: process.platform === 'win32' }, async () => {
  const ch = localChannel()
  try {
    assert.equal(await ch.waitReady({ maxWaitMs: 5000 }), true)
    const r = await ch.exec('printf "%s|" "$@"; echo err >&2; exit 3', ['a b', "it's", '$(x)', 'line1\nline2'])
    assert.equal(r.stdout.toString(), 'a b|it\'s|$(x)|line1\nline2|')
    assert.equal(r.stderr.toString(), 'err\n')
    assert.equal(r.code, 3)
  } finally { ch.dispose() }
})

test('exec: stdin (бинарный) и параллельные запросы не смешиваются', { skip: process.platform === 'win32' }, async () => {
  const ch = localChannel()
  try {
    await ch.waitReady({ maxWaitMs: 5000 })
    const payload = Buffer.from(Array.from({ length: 70000 }, (_, i) => i % 256))
    const [a, b, c] = await Promise.all([
      ch.exec('cat', [], { stdin: payload }),
      ch.exec('sleep 0.3; echo slow'),
      ch.exec('echo fast')
    ])
    assert.ok(a.stdout.equals(payload))
    assert.equal(b.stdout.toString(), 'slow\n')
    assert.equal(c.stdout.toString(), 'fast\n')
  } finally { ch.dispose() }
})

test('exec: таймаут не блокирует канал', { skip: process.platform === 'win32' }, async () => {
  const ch = localChannel()
  try {
    await ch.waitReady({ maxWaitMs: 5000 })
    const slow = await ch.exec('sleep 5', [], { timeoutMs: 300 })
    assert.equal(slow.timedOut, true)
    const ok = await ch.exec('echo alive')
    assert.equal(ok.stdout.toString(), 'alive\n')
  } finally { ch.dispose() }
})

test('обрыв канала: ожидающие получают код 255, следующий exec переподключается', { skip: process.platform === 'win32' }, async () => {
  const ch = localChannel()
  try {
    await ch.waitReady({ maxWaitMs: 5000 })
    const pending = ch.exec('sleep 5', [], { timeoutMs: 10000 })
    await new Promise(r => setTimeout(r, 200))
    ch._child.kill()
    const r = await pending
    assert.equal(r.code, 255)
    const again = await ch.exec('echo back')
    assert.equal(again.stdout.toString(), 'back\n')
  } finally { ch.dispose() }
})

test('dispose: exec после dispose возвращает disposed', async () => {
  const ch = localChannel()
  ch.dispose()
  const r = await ch.exec('echo x')
  assert.equal(r.error, 'disposed')
})

test('posixQuote и скрипт диспетчера содержат nonce и exit', () => {
  assert.equal(posixQuote("a'b"), "'a'\\''b'")
  const s = buildDispatcherScript('n0nce')
  assert.ok(s.includes('ETTY-READY n0nce'))
  assert.ok(s.trimEnd().endsWith('done'))
})
