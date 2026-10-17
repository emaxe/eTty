import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNvmWindowsList, parseNvmWindowsRemote, parseVoltaList, versionFromNodePath } from '../services/node-version-parse.js'

test('nvm-windows list', () => {
  const out = '\r\n  * 20.11.0 (Currently using 64-bit executable)\r\n    18.19.1\r\n'
  assert.deepEqual(parseNvmWindowsList(out), [
    { version: '20.11.0', current: true, lts: false },
    { version: '18.19.1', current: false, lts: false }
  ])
})

test('nvm-windows list available: таблица, сортировка, без старых 0.x', () => {
  const out = `|   CURRENT    |     LTS      |  OLD STABLE  | OLD UNSTABLE |
|--------------|--------------|--------------|--------------|
|    25.2.1    |   24.12.0    |   0.12.18    |   0.11.16    |
|    25.2.0    |   24.11.1    |   0.12.17    |   0.11.15    |`
  assert.deepEqual(parseNvmWindowsRemote(out).map(v => v.version), ['25.2.1', '25.2.0', '24.12.0', '24.11.1'])
})

test('volta list', () => {
  const out = 'runtime node@20.11.0 (default)\nruntime node@18.19.1\npackage-manager npm@10.2.4 (default)'
  assert.deepEqual(parseVoltaList(out), [
    { version: '20.11.0', current: false, default: true },
    { version: '18.19.1', current: false, default: false }
  ])
})

test('versionFromNodePath: Windows-пути', () => {
  assert.equal(versionFromNodePath('C:\\Users\\u\\AppData\\Roaming\\fnm\\node-versions\\v20.1.0\\installation\\node.exe'), '20.1.0')
  assert.equal(versionFromNodePath('C:\\Users\\u\\AppData\\Local\\Volta\\tools\\image\\node\\20.1.0\\node.exe'), '20.1.0')
  assert.equal(versionFromNodePath('C:\\Users\\u\\AppData\\Roaming\\nvm\\v18.19.1\\node.exe'), '18.19.1')
  assert.equal(versionFromNodePath('C:\\Program Files\\nodejs\\node.exe'), null)
  assert.equal(versionFromNodePath('/Users/u/.nvm/versions/node/v22.1.0/bin/node'), '22.1.0')
})
