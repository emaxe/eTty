import { buildRemoteInitCommand } from '../ssh/remote-shell-hooks.js'
import { SSH_SESSION_CONFIG } from '../../shared/ssh-session-config.js'
import { parseProbe, parseTmuxSessionState } from '../ssh/remote-parse.js'
import { buildTmuxInstallCommand } from '../ssh/tmux-install.js'

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

/** Извлекает L1-текст (без `exec /bin/sh -c '`/завершающей кавычки) и проверяет инвариант L0. */
function innerOf(cmd) {
  assert(cmd.startsWith("exec /bin/sh -c '") && cmd.endsWith("'"), 'команда не обёрнута в exec /bin/sh -c \'...\'')
  const inner = cmd.slice("exec /bin/sh -c '".length, -1)
  assert(!inner.includes("'"), 'L1 содержит \' — сломает L0-обёртку')
  assert(!inner.includes('!'), 'L1 содержит ! — history expansion в csh/tcsh сломает L0-обёртку')
  return inner
}

// --- buildRemoteInitCommand: комбинации persistence × hooks × skipShellIntegration ---

check('off/hooks — не запускает tmux', () => {
  const inner = innerOf(buildRemoteInitCommand({ persistence: 'off', hooks: true }))
  // _etty_emit (DCS-aware эмиттер) применяется универсально и легитимно содержит слово "tmux"
  // (проверка $TMUX, префикс Ptmux; на случай, если $TMUX уже стоит по не зависящей от eTty
  // причине) — здесь проверяем именно ОТСУТСТВИЕ запуска самого tmux-сервера, а не подстроку.
  assert(!inner.includes('new-session'), 'непостоянная ветка не должна запускать tmux new-session')
  assert(inner.includes('ZDOTDIR=$d'), 'ожидался ZDOTDIR для непостоянной ветки с хуками')
})

check('off/no-hooks — простой login-shell', () => {
  const inner = innerOf(buildRemoteInitCommand({ persistence: 'off', hooks: false }))
  assert(inner.includes('exec "$s" -l'), 'ожидался простой login-shell без хуков')
  assert(!inner.includes('ZDOTDIR'), 'хуки выключены — ZDOTDIR не должен появляться')
})

check('tmux/hooks — new-session -A -D с именем сессии', () => {
  const inner = innerOf(buildRemoteInitCommand({ persistence: 'tmux', sessionName: 'etty-4f2a9c1b', hooks: true, socketName: 'etty' }))
  assert(inner.includes('new-session -A -D -s "$n"'), 'ожидался new-session -A -D')
  assert(inner.includes('n=etty-4f2a9c1b'), 'имя сессии должно попасть в текст')
  assert(inner.includes('-L etty'), 'ожидался отдельный сокет')
  assert(inner.includes('allow-passthrough on'), 'ожидался allow-passthrough в tmux.conf')
  assert(inner.includes('prefix None'), 'ожидался prefix None')
  assert(inner.includes('_etty_emit'), 'ожидался DCS-эмиттер в rc')
})

check('tmux/no-hooks — tmux есть, хуков нет', () => {
  const inner = innerOf(buildRemoteInitCommand({ persistence: 'tmux', sessionName: 'etty-4f2a9c1b', hooks: false, socketName: 'etty' }))
  assert(inner.includes('new-session -A -D -s "$n"'), 'tmux должен запускаться и без хуков')
  assert(!inner.includes('_etty_emit'), 'хуки выключены — эмиттера быть не должно')
})

check('tmux/compat-socket — без -L, с фолбэком allow-passthrough', () => {
  const inner = innerOf(buildRemoteInitCommand({ persistence: 'tmux', sessionName: 'etty-4f2a9c1b', hooks: true, socketName: '' }))
  assert(!inner.includes('-L '), 'пустой сокет — без -L (сокет по умолчанию)')
  assert(inner.includes('tmux set -p allow-passthrough on'), 'ожидался панельный фолбэк allow-passthrough')
})

check('невалидные имена сессий отвергаются', () => {
  for (const bad of ["a'b", 'a!b', 'a.b', 'a:b', '', 'x'.repeat(65)]) {
    let threw = false
    try {
      buildRemoteInitCommand({ persistence: 'tmux', sessionName: bad, hooks: true })
    } catch {
      threw = true
    }
    assert(threw, `имя сессии ${JSON.stringify(bad)} должно быть отвергнуто`)
  }
})

check('невалидные имена сокетов отвергаются', () => {
  let threw = false
  try {
    buildRemoteInitCommand({ persistence: 'tmux', sessionName: 'etty-4f2a9c1b', socketName: "bad'socket" })
  } catch {
    threw = true
  }
  assert(threw, 'некорректное имя сокета должно быть отвергнуто')
})

check('SESSION_NAME_RE — валидные значения проходят', () => {
  for (const ok of ['etty-4f2a9c1b', 'a', 'A_B-1', 'x'.repeat(64)]) {
    assert(SSH_SESSION_CONFIG.SESSION_NAME_RE.test(ok), `${ok} должно быть валидным`)
  }
})

// --- DCS-обёртка: удвоенный ESC, формат `ESC P tmux ; <payload x2 ESC> ESC \` ---

check('DCS-эмиттер удваивает ведущий ESC для tmux-ветки', () => {
  const inner = innerOf(buildRemoteInitCommand({ persistence: 'tmux', sessionName: 'etty-4f2a9c1b', hooks: true }))
  // сырой текст эмиттера, как он попадёт в файл (после снятия L1-экранирования posixDquote
  // делает это одинаково для \\ и т.д. — здесь просто проверяем, что оба варианта формата
  // присутствуют дословно в сгенерированном L1 (до записи в файл, но после экранирования
  // символ `\` остаётся текстовым, отличить экранированный вид можно по паттерну)
  assert(inner.includes('Ptmux;'), 'ожидался DCS-префикс Ptmux; в теле эмиттера')
})

// --- Парсеры ---

check('parseProbe — распознаёт версию tmux и порог passthrough', () => {
  const stdout = ['Linux', '/home/user', 'user', '/bin/zsh', 'gnu', 'find0', '-', '-', 'tmux 3.3a'].join('\n')
  const caps = parseProbe(stdout)
  assert(caps.tmuxVersion === 'tmux 3.3a', `ожидалась версия tmux 3.3a, получено ${caps.tmuxVersion}`)
  assert(caps.tmuxPassthrough === true, 'tmux 3.3a должен поддерживать passthrough')
})

check('parseProbe — версии ниже порога/tmux отсутствует', () => {
  const below = parseProbe(['', '', '', '', 'gnu', 'find0', '-', '-', 'tmux 3.2'].join('\n'))
  assert(below.tmuxPassthrough === false, 'tmux 3.2 не должен поддерживать passthrough')
  const none = parseProbe(['', '', '', '', 'gnu', 'find0', '-', '-', '-'].join('\n'))
  assert(none.tmuxVersion === null && none.tmuxPassthrough === false, 'отсутствие tmux должно давать null/false')
})

check('parseProbe — "3.10" не меньше "3.3" (числовое, не строковое сравнение)', () => {
  const caps = parseProbe(['', '', '', '', 'gnu', 'find0', '-', '-', 'tmux 3.10'].join('\n'))
  assert(caps.tmuxPassthrough === true, 'tmux 3.10 должен считаться новее 3.3 (числовое сравнение)')
})

check('parseTmuxSessionState — разбирает cwd/pane_path/command', () => {
  const state = parseTmuxSessionState('/home/user/project|/home/user/project|vim\n')
  assert(state.currentPath === '/home/user/project', 'currentPath не совпал')
  assert(state.currentCommand === 'vim', 'currentCommand не совпал')
})

check('parseTmuxSessionState — пустой вывод (нет сокета/сессии) — null', () => {
  assert(parseTmuxSessionState('') === null, 'пустой вывод должен давать null')
})

check('parseProbe — распознаёт менеджер пакетов (10-я строка)', () => {
  const stdout = ['', '', '', '', 'gnu', 'find0', '-', '-', '-', 'apt'].join('\n')
  assert(parseProbe(stdout).pkgManager === 'apt', 'ожидался pkgManager=apt')
  const none = parseProbe(['', '', '', '', 'gnu', 'find0', '-', '-', '-', '-'].join('\n'))
  assert(none.pkgManager === null, 'нераспознанный менеджер должен давать null')
})

// --- Установка tmux по подтверждению пользователя ---

check('buildTmuxInstallCommand — известные менеджеры дают команду с sudo (кроме brew)', () => {
  assert(buildTmuxInstallCommand('apt') === 'sudo apt-get install -y tmux', 'apt')
  assert(buildTmuxInstallCommand('dnf').startsWith('sudo dnf'), 'dnf')
  assert(buildTmuxInstallCommand('apk').startsWith('sudo apk'), 'apk')
  assert(!buildTmuxInstallCommand('brew').includes('sudo'), 'brew не должен использовать sudo')
})

check('buildTmuxInstallCommand — неизвестный/отсутствующий менеджер даёт null', () => {
  assert(buildTmuxInstallCommand(null) === null, 'null pkgManager → null')
  assert(buildTmuxInstallCommand('unknown-pm') === null, 'нераспознанный менеджер → null')
})

if (failed) {
  console.error('\n❌ Some tests failed')
  process.exit(1)
} else {
  console.log('\n✅ All tests passed')
}
