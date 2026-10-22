import test from 'node:test'
import assert from 'node:assert/strict'
import { fuzzyMatch } from '../../renderer/core/fuzzy.js'
import { CommandRegistry } from '../../renderer/core/command-registry.js'
import { formatHotkey, matchesHotkey } from '../../renderer/core/hotkeys.js'

test('fuzzyMatch: подпоследовательность, регистр не важен', () => {
  assert.ok(fuzzyMatch('прд', 'Показать редактор'))
  assert.ok(fuzzyMatch('ТЕМА', 'тема: Dark'))
  assert.equal(fuzzyMatch('xyz', 'Показать редактор'), null)
  assert.deepEqual(fuzzyMatch('', 'что угодно'), { score: 0, indices: [] })
})

test('fuzzyMatch: индексы указывают на совпавшие символы', () => {
  const m = fuzzyMatch('ген', 'Git: ветка')
  assert.equal(m, null)
  const r = fuzzyMatch('gt', 'Git')
  assert.deepEqual(r.indices, [0, 2])
})

test('fuzzyMatch: подряд идущие и начало слов выше разрозненных', () => {
  const tight = fuzzyMatch('ред', 'Редактор')
  const loose = fuzzyMatch('ред', 'Показать глобальный редактор')
  const scattered = fuzzyMatch('ред', 'Расширенный экспорт данных')
  assert.ok(tight.score > scattered.score)
  assert.ok(loose.score > scattered.score)
})

test('CommandRegistry: register/list/run и отмена регистрации', async () => {
  const reg = new CommandRegistry()
  let ran = 0
  const off = reg.register({ id: 'a', title: 'Alpha', run: () => { ran++ } })
  assert.equal(reg.list().length, 1)
  assert.equal(await reg.run('a'), true)
  assert.equal(ran, 1)
  off()
  assert.equal(reg.list().length, 0)
  assert.equal(await reg.run('a'), false)
})

test('CommandRegistry: дубликат id и неполная команда — ошибка', () => {
  const reg = new CommandRegistry()
  reg.register({ id: 'a', title: 'A', run() {} })
  assert.throws(() => reg.register({ id: 'a', title: 'A2', run() {} }), /already registered/)
  assert.throws(() => reg.register({ id: 'b', title: 'B' }), /requires/)
})

test('CommandRegistry: when скрывает команду и из list, и из run', async () => {
  const reg = new CommandRegistry()
  let enabled = false
  let ran = false
  reg.register({ id: 'x', title: 'X', when: () => enabled, run: () => { ran = true } })
  assert.equal(reg.list().length, 0)
  assert.equal(await reg.run('x'), false)
  enabled = true
  assert.equal(reg.list().length, 1)
  await reg.run('x')
  assert.equal(ran, true)
})

test('CommandRegistry.search: по названию, группе и ключевым словам; пустой запрос — всё', () => {
  const reg = new CommandRegistry()
  reg.register({ id: '1', title: 'Показать редактор', group: 'Вид', run() {} })
  reg.register({ id: '2', title: 'Тема: Dark', group: 'Оформление', keywords: ['тёмная'], run() {} })
  reg.register({ id: '3', title: 'Новая вкладка', group: 'Вкладки', run() {} })
  assert.equal(reg.search('').length, 3)
  assert.deepEqual(reg.search('редак').map(r => r.command.id), ['1'])
  assert.deepEqual(reg.search('тёмн').map(r => r.command.id), ['2'])
  assert.deepEqual(reg.search('вкладки').map(r => r.command.id), ['3'])
  assert.equal(reg.search('zzz').length, 0)
})

test('formatHotkey: macOS и остальные платформы', () => {
  const spec = { key: 'g', mod: true, shift: true }
  assert.equal(formatHotkey(spec, true), '⇧⌘G')
  assert.equal(formatHotkey(spec, false), 'Ctrl+Shift+G')
  assert.equal(formatHotkey({ key: ',', mod: true }, true), '⌘,')
})

test('matchesHotkey: точное сравнение модификаторов', () => {
  const spec = { key: 'k', mod: true }
  const ev = (o) => ({ key: 'k', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o })
  assert.equal(matchesHotkey(ev({ metaKey: true }), spec, true), true)
  assert.equal(matchesHotkey(ev({ metaKey: true, shiftKey: true }), spec, true), false)
  assert.equal(matchesHotkey(ev({ ctrlKey: true }), spec, true), false)
  assert.equal(matchesHotkey(ev({ ctrlKey: true }), spec, false), true)
  assert.equal(matchesHotkey(ev({ metaKey: true, key: 'K' }), spec, true), true)
})
