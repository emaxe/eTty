import { parseStatusPorcelainZ, parseBranchHeader, parseNumstat, parseBranchList } from '../git/git-parse.js'

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

check('parseBranchHeader — разные формы заголовка', () => {
  assert(parseBranchHeader('main') === 'main', 'простая ветка')
  assert(parseBranchHeader('main...origin/main') === 'main', 'с upstream')
  assert(parseBranchHeader('main...origin/main [ahead 1, behind 2]') === 'main', 'ahead/behind')
  assert(parseBranchHeader('feature/x [gone]') === 'feature/x', 'upstream gone без ...')
  assert(parseBranchHeader('No commits yet on main') === 'main', 'пустой репозиторий')
  assert(parseBranchHeader('HEAD (no branch)') === null, 'detached HEAD')
})

check('parseStatusPorcelainZ — modified/staged/untracked/ignored/rename', () => {
  const raw = [
    '## main...origin/main [ahead 3, behind 1]',
    ' M src/a.js',
    'M  src/b.js',
    'MM src/c.js',
    'R  new name.js', 'old name.js',
    '?? notes.txt',
    'UU conflict.js',
    '!! node_modules/',
    ''
  ].join('\0')
  const r = parseStatusPorcelainZ(raw)
  assert(r.branch === 'main', 'branch')
  assert(r.ahead === 3 && r.behind === 1, `ahead/behind: ${r.ahead}/${r.behind}`)
  assert(r.files.length === 6, `files: ${r.files.length}`)
  assert(r.files[0].index === ' ' && r.files[0].working_dir === 'M', 'unstaged M')
  assert(r.files[1].index === 'M' && r.files[1].working_dir === ' ', 'staged M')
  const rename = r.files.find(f => f.index === 'R')
  assert(rename.path === 'new name.js' && rename.from === 'old name.js', 'rename: путь с пробелом и from')
  assert(r.files.some(f => f.index === '?' && f.path === 'notes.txt'), 'untracked')
  assert(r.files.some(f => f.index === 'U' && f.working_dir === 'U'), 'conflict UU')
  assert(r.ignored.length === 1 && r.ignored[0] === 'node_modules/', 'ignored отделён от files')
})

check('parseStatusPorcelainZ — пустой/чистый репозиторий', () => {
  const r = parseStatusPorcelainZ('## main\0')
  assert(r.branch === 'main' && r.files.length === 0 && r.ahead === 0, 'чистый')
  assert(parseStatusPorcelainZ('').branch === null, 'пустой вывод')
})

check('parseNumstat — бинарные файлы и rename', () => {
  const m = parseNumstat('3\t1\tsrc/a.js\n-\t-\timg.png\n2\t0\tsrc/{old => new}/f.js\n')
  assert(m.get('src/a.js').additions === 3 && m.get('src/a.js').deletions === 1, 'обычный')
  assert(m.get('img.png').additions === 0, 'бинарный')
  assert(m.has('src/new/f.js'), 'нормализованный путь rename')
})

check('parseBranchList — текущая, detached, remote-алиас', () => {
  const r = parseBranchList('* main\n  feature/x\n  remotes/origin/HEAD -> origin/main\n')
  assert(r.current === 'main', 'current')
  assert(r.all.includes('feature/x') && r.all.length === 3, 'all')
  const d = parseBranchList('* (HEAD detached at abc123)\n  main\n')
  assert(d.current === null && d.all.length === 1, 'detached не попадает в список')
})

if (failed) {
  console.error('\n❌ Some tests failed')
  process.exit(1)
} else {
  console.log('\n✅ All tests passed')
}
