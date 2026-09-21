import { TMUX_LIST_SESSIONS_SCRIPT, TMUX_KILL_SESSION_SCRIPT, TMUX_RENAME_SESSION_SCRIPT } from '../ssh/remote-scripts.js'
import { parseTmuxSessions } from '../ssh/remote-parse.js'
import { buildSessionNameBase, pickFreeSessionName } from '../../shared/ssh-session-name.js'
import { SSH_SESSION_CONFIG } from '../../shared/ssh-session-config.js'
import { resolveSshPersistence } from '../../shared/ssh-persistence.js'

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

// --- parseTmuxSessions ---

check('parseTmuxSessions — обычный вывод: две сессии + активные команды', () => {
  // \0 — поля, \n — записи (естественный разделитель tmux), пустая строка — граница секций
  const buf = Buffer.from(
    '1\x000\x001700000000\x001700000000\x00sess-one\n' +
    '2\x001\x001700000001\x001700000005\x00sess-two\n' +
    '\n' +
    '1\x001\x00zsh\x00sess-one\n' +
    '0\x001\x00zsh\x00sess-two\n' +
    '1\x001\x00vim\x00sess-two\n'
  )
  const sessions = parseTmuxSessions(buf)
  assert(sessions.length === 2, `ожидалось 2 сессии, получено ${sessions.length}`)
  // attached первыми
  assert(sessions[0].name === 'sess-two', 'attached-сессия должна идти первой')
  assert(sessions[0].attached === 1, 'sess-two.attached')
  assert(sessions[0].windows === 2, 'sess-two.windows')
  assert(sessions[0].currentCommand === 'vim', 'sess-two.currentCommand — активная панель активного окна')
  assert(sessions[1].name === 'sess-one', 'sess-one второй')
  assert(sessions[1].currentCommand === 'zsh', 'sess-one.currentCommand')
})

check('parseTmuxSessions — пустой сервер (нет сессий) — []', () => {
  assert(parseTmuxSessions(Buffer.from('\n')).length === 0, 'единственный \\n от printf — пустой список')
  assert(parseTmuxSessions(Buffer.alloc(0)).length === 0, 'совсем пустой буфер — пустой список')
})

check('parseTmuxSessions — пустая activity (tmux < 2.1) не путается с границей секций', () => {
  const buf = Buffer.from('1\x000\x001700000000\x00\x00my-session\n\n')
  const sessions = parseTmuxSessions(buf)
  assert(sessions.length === 1, 'запись с пустой activity должна распознаться')
  assert(sessions[0].activityAt === null, 'пустая activity → null')
  assert(sessions[0].name === 'my-session', 'имя не должно потеряться')
})

check('parseTmuxSessions — битая запись (не число в числовом поле) пропускается, соседи выживают', () => {
  const buf = Buffer.from(
    'bad\x001\x001700000000\x001700000000\x00broken\n' +
    '1\x001\x001700000001\x001700000001\x00good\n' +
    '\n'
  )
  const sessions = parseTmuxSessions(buf)
  assert(sessions.length === 1, 'битая запись должна быть отброшена целиком')
  assert(sessions[0].name === 'good', 'соседняя валидная запись должна сохраниться')
})

// --- Инварианты текста remote-скриптов (тот же стиль, что и remote-tmux.test.mjs) ---

check('TMUX_LIST_SESSIONS_SCRIPT — данные только в $1, есть проверка на отсутствие tmux', () => {
  assert(TMUX_LIST_SESSIONS_SCRIPT.includes('command -v tmux'), 'ожидалась проверка наличия tmux')
  assert(TMUX_LIST_SESSIONS_SCRIPT.includes('exit 127'), 'отсутствие tmux — exit 127')
  assert(TMUX_LIST_SESSIONS_SCRIPT.includes('$1'), 'сокет должен приходить позиционным параметром')
  assert(!TMUX_LIST_SESSIONS_SCRIPT.includes('$2'), 'у этого скрипта только один параметр — сокет')
  assert(TMUX_LIST_SESSIONS_SCRIPT.includes("printf '\\n'"), 'между секциями должна печататься пустая строка')
})

check('TMUX_LIST_SESSIONS_SCRIPT — регрессия: UTF-8-локаль ДО вызова tmux (иначе -F ломает TAB)', () => {
  // Подтверждено вживую на реальном sshd: неинтерактивная SSH-сессия по умолчанию не наследует
  // LANG/LC_* клиента (нужен AcceptEnv на сервере), и без UTF-8-локали tmux заменяет TAB-байт
  // в `-F` на `_` — весь парсинг молча ломается (панель не может получить список сессий, если
  // нет открытой вкладки на этот сервер — единственный путь, где выполняется этот скрипт).
  const localeIdx = TMUX_LIST_SESSIONS_SCRIPT.indexOf('UTF-8')
  const firstTmuxCallIdx = TMUX_LIST_SESSIONS_SCRIPT.indexOf('list-sessions')
  assert(localeIdx !== -1, 'ожидалась установка UTF-8-локали (LC_ALL/LANG) в тексте скрипта')
  assert(localeIdx < firstTmuxCallIdx, 'локаль должна устанавливаться ДО первого вызова tmux -F')
})

check('TMUX_KILL_SESSION_SCRIPT — $1 сокет, $2 имя, есть точный grep-гард', () => {
  assert(TMUX_KILL_SESSION_SCRIPT.includes('$1') && TMUX_KILL_SESSION_SCRIPT.includes('$2'), 'ожидались оба параметра')
  assert(!TMUX_KILL_SESSION_SCRIPT.includes('$3'), 'у kill только два параметра')
  assert(TMUX_KILL_SESSION_SCRIPT.includes('grep -qxF'), 'ожидался точный (не prefix) гард существования сессии')
  assert(TMUX_KILL_SESSION_SCRIPT.includes('exit 3'), 'отсутствие сессии — exit 3')
  assert(TMUX_KILL_SESSION_SCRIPT.includes('kill-session -t "$2"'), 'ожидался kill-session по имени из $2')
})

check('TMUX_RENAME_SESSION_SCRIPT — $1/$2/$3, гарды на отсутствие и занятость имени', () => {
  assert(['$1', '$2', '$3'].every(p => TMUX_RENAME_SESSION_SCRIPT.includes(p)), 'ожидались три параметра')
  assert(TMUX_RENAME_SESSION_SCRIPT.includes('grep -qxF'), 'ожидался точный гард')
  assert(TMUX_RENAME_SESSION_SCRIPT.includes('exit 3'), 'исходной сессии нет — exit 3')
  assert(TMUX_RENAME_SESSION_SCRIPT.includes('exit 17'), 'новое имя занято — exit 17')
  assert(TMUX_RENAME_SESSION_SCRIPT.includes('rename-session -t "$2" -- "$3"'), 'ожидался rename-session с -- перед новым именем')
})

// --- shared/ssh-session-name.js ---

check('buildSessionNameBase — совпадает со старой схемой etty-<conn8>', () => {
  assert(buildSessionNameBase('a1b2c3d4-e5f6-7890') === 'etty-a1b2c3d4', 'ожидалась схема etty-<8 alnum>')
  assert(SSH_SESSION_CONFIG.SESSION_NAME_RE.test(buildSessionNameBase('a1b2c3d4-e5f6-7890')), 'результат должен проходить SESSION_NAME_RE')
})

check('pickFreeSessionName — base, затем base-2, base-3, …', () => {
  const base = 'etty-a1b2c3d4'
  assert(pickFreeSessionName(base, []) === base, 'свободная база возвращается как есть')
  assert(pickFreeSessionName(base, [base]) === `${base}-2`, 'занята база → -2')
  assert(pickFreeSessionName(base, [base, `${base}-2`]) === `${base}-3`, 'заняты база и -2 → -3')
})

check('pickFreeSessionName — результат всегда проходит SESSION_NAME_RE, даже на длинной базе', () => {
  const longBase = 'x'.repeat(64)
  const name = pickFreeSessionName(longBase, [longBase])
  assert(SSH_SESSION_CONFIG.SESSION_NAME_RE.test(name), `результат ${name} должен проходить SESSION_NAME_RE`)
  assert(name.length <= 64, 'результат не должен превышать 64 символа')
})

// --- shared/ssh-persistence.js ---

check('resolveSshPersistence — явный persistence в опциях побеждает', () => {
  assert(resolveSshPersistence({ persistence: 'tmux' }, { persistence: 'off' }) === 'tmux', 'явный tmux должен победить')
  assert(resolveSshPersistence({ persistence: 'off' }, { persistence: 'tmux' }) === 'off', 'явный off должен победить')
})

check('resolveSshPersistence — не задан явно → fallback на connection.persistence', () => {
  assert(resolveSshPersistence({}, { persistence: 'tmux' }) === 'tmux', 'fallback на tmux')
  assert(resolveSshPersistence(undefined, { persistence: 'tmux' }) === 'tmux', 'sshOptions может отсутствовать целиком')
  assert(resolveSshPersistence({}, { persistence: 'off' }) === 'off', 'fallback на off')
})

check('resolveSshPersistence — ни того, ни другого нет → off', () => {
  assert(resolveSshPersistence({}, {}) === 'off', 'дефолт — off')
  assert(resolveSshPersistence(null, null) === 'off', 'null-аргументы не должны падать')
})

if (failed) {
  console.error('\n❌ Some tests failed')
  process.exit(1)
} else {
  console.log('\n✅ All tests passed')
}
