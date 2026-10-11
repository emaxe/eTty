import {
  validateVersion, stripTerminalEscapes, parseNvmList, parseNvmRemote,
  parseFnmList, parseAsdfList, versionFromNodePath
} from '../services/node-version-parse.js'

let failed = false

function check(label, fn) {
  try {
    fn()
    console.log(`✅ ${label}`)
  } catch (e) {
    console.error(`❌ ${label}: ${e.message}`)
    failed = true
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

const NVM_LS = `\x1b]7;file:///Users/me\x07->     v22.22.2
        v20.17.0 (LTS: Iron)
         system
default -> node (-> v22.22.2)
iojs -> N/A (default)
unstable -> N/A (default)
node -> stable (-> v22.22.2) (default)
stable -> 22.22 (-> v22.22.2) (default)
lts/* -> lts/jod (-> N/A)
lts/argon -> v4.9.1 (-> N/A)
lts/iron -> v20.19.6 (-> N/A)`

check('parseNvmList — только реальные версии, алиасы и OSC-мусор отброшены', () => {
  const v = parseNvmList(NVM_LS)
  assert(v.length === 2, `ожидалось 2 версии, получено ${v.length}: ${JSON.stringify(v)}`)
  assert(v[0].version === '22.22.2' && v[0].current === true, 'current по ->')
  assert(v[1].version === '20.17.0' && v[1].current === false && v[1].lts === true, 'LTS без current')
})

check('parseNvmRemote — свежие первыми, LTS помечены', () => {
  const v = parseNvmRemote('       v18.0.0\n       v20.1.0   (LTS: Iron)\n->   v22.0.0\n')
  assert(v[0].version === '22.0.0' && v[2].version === '18.0.0', 'порядок')
  assert(v.find(x => x.version === '20.1.0').lts === true, 'lts')
})

check('parseFnmList — default, system пропущен, current не ставится всем подряд', () => {
  const v = parseFnmList('* v18.17.0\n* v20.5.0 default\n* system\n')
  assert(v.length === 2, 'без system')
  assert(v.every(x => x.current === false), 'current не выставлен')
  assert(v[1].default === true && v[0].default === false, 'default')
})

check('parseAsdfList — активная версия со звёздочкой', () => {
  const v = parseAsdfList('  18.0.0\n *20.1.0\n')
  assert(v.length === 2 && v[1].current === true && v[0].current === false, JSON.stringify(v))
})

check('validateVersion — инъекции отклоняются, алиасы и неполные версии принимаются', () => {
  for (const ok of ['20', 'v20', '20.1', '20.1.0', 'lts/*', 'lts/iron', 'node', 'latest', 'lts']) validateVersion(ok)
  for (const bad of ['20.1.0; rm -rf ~', '$(id)abc', '20 && ls', '', null, 'a b', '`id`', '-rf']) {
    let thrown = false
    try { validateVersion(bad) } catch { thrown = true }
    assert(thrown, `должно отклоняться: ${bad}`)
  }
})

check('stripTerminalEscapes — OSC 7 и ANSI', () => {
  assert(stripTerminalEscapes('\x1b]7;file:///x\x07v22.1.0') === 'v22.1.0', 'OSC')
  assert(stripTerminalEscapes('\x1b[32mv1.2.3\x1b[0m') === 'v1.2.3', 'CSI')
})

check('versionFromNodePath — nvm/fnm/asdf/volta; shim и brew не распознаются', () => {
  assert(versionFromNodePath('/Users/a/.nvm/versions/node/v22.22.2/bin/node') === '22.22.2', 'nvm')
  assert(versionFromNodePath('/home/a/.local/share/fnm/node-versions/v20.1.0/installation/bin/node') === '20.1.0', 'fnm')
  assert(versionFromNodePath('/home/a/.asdf/installs/nodejs/18.2.0/bin/node') === '18.2.0', 'asdf')
  assert(versionFromNodePath('/home/a/.volta/tools/image/node/20.9.0/bin/node') === '20.9.0', 'volta')
  assert(versionFromNodePath('/opt/homebrew/bin/node') === null, 'brew')
  assert(versionFromNodePath('/home/a/.asdf/shims/node') === null, 'shim')
})

if (failed) {
  console.error('\n❌ Some tests failed')
  process.exit(1)
} else {
  console.log('\n✅ All tests passed')
}
