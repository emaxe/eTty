import test from 'node:test'
import assert from 'node:assert/strict'
import { createPathUtils } from '../../shared/path-utils.js'

const win = createPathUtils('\\')
const posix = createPathUtils('/')

test('fromFileUrl: Windows drive, пробелы, UNC', () => {
  assert.equal(win.fromFileUrl('file:///C:/Users/a%20b'), 'C:\\Users\\a b')
  assert.equal(win.fromFileUrl('file:///C:/'), 'C:\\')
  assert.equal(win.fromFileUrl('file://server/share/x'), '\\\\server\\share\\x')
})

test('fromFileUrl: POSIX отбрасывает хост и слэш в конце', () => {
  assert.equal(posix.fromFileUrl('file://host/Users/x/'), '/Users/x')
  assert.equal(posix.fromFileUrl('file:///'), '/')
  assert.equal(posix.fromFileUrl('nope'), null)
})

test('equals: регистр и разделители на Windows', () => {
  assert.ok(win.equals('C:\\Foo\\Bar', 'c:/foo/bar'))
  assert.ok(!posix.equals('/Foo', '/foo'))
})

test('isRoot', () => {
  assert.ok(win.isRoot('C:\\'))
  assert.ok(win.isRoot('\\\\srv\\share\\'))
  assert.ok(!win.isRoot('C:\\x'))
  assert.ok(posix.isRoot('/'))
  assert.ok(!posix.isRoot('/x'))
})

test('relative / dirname / join для UNC и drive', () => {
  assert.equal(win.relative('C:\\a', 'C:\\a\\b\\c'), 'b\\c')
  assert.equal(win.relative('C:\\a', 'C:\\a'), '')
  assert.equal(win.dirname('C:\\a\\b.txt'), 'C:\\a')
  assert.equal(win.dirname('C:\\a'), 'C:\\')
  assert.equal(win.join('\\\\srv\\share', 'x'), '\\\\srv\\share\\x')
  assert.equal(posix.relative('/a', '/a/b/c'), 'b/c')
})

test('toDisplay: ~ только на POSIX', () => {
  assert.equal(posix.toDisplay('/Users/u/p', '/Users/u'), '~/p')
  assert.equal(win.toDisplay('C:\\Users\\u\\p', 'C:\\Users\\u'), 'C:\\Users\\u\\p')
})
