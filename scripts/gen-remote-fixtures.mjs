#!/usr/bin/env node
/**
 * Генератор golden-фикстур из десктопного JS-кода протокола SSH/tmux, чтобы мобильный Dart-порт
 * (mobile/lib/remote/*) сверял свой вывод с ЭТИМ (единственным источником истины), а не с
 * переписанной вручную копией. См. docs/plans/mob/plan.md, раздел «Golden-тесты», REQ-4.
 *
 * Режимы:
 *   node scripts/gen-remote-fixtures.mjs           — (пере)генерирует mobile/test/fixtures/remote/
 *   node scripts/gen-remote-fixtures.mjs --check    — генерирует в память, сравнивает с уже
 *                                                       записанными файлами, не трогая диск;
 *                                                       расхождение (включая лишние/недостающие
 *                                                       файлы) — exit 1 с сообщением, что разошлось.
 *
 * Формат каждой группы фикстур описан в комментарии над соответствующей build*()-функцией —
 * Dart-тесты (mobile/test/*_golden_test.dart, задачи #4–#8 плана) читают согласно этим схемам.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs'
import { dirname, join as pathJoin } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as remoteScripts from '../src/main/ssh/remote-scripts.js'
import { buildRemoteInitCommand } from '../src/main/ssh/remote-shell-hooks.js'
import * as remoteParse from '../src/main/ssh/remote-parse.js'
import { buildSessionNameBase, pickFreeSessionName } from '../src/shared/ssh-session-name.js'
import { resolveSshPersistence } from '../src/shared/ssh-persistence.js'
import { SSH_SESSION_CONFIG } from '../src/shared/ssh-session-config.js'
import { SSH_FS_CONFIG } from '../src/shared/ssh-fs-config.js'
import { createPathUtils } from '../src/shared/path-utils.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = pathJoin(__dirname, '..')
const FIXTURES_ROOT = pathJoin(REPO_ROOT, 'mobile', 'test', 'fixtures', 'remote')

// ssh-fs-provider.js:14 — `const BATCH_SIZE = 150` не экспортируется (внутренняя деталь
// реализации main-процесса). Дублируем как golden-константу осознанно: если десктопное значение
// поменяется, `npm run fixtures:check`-эквивалент не поймает рассинхрон автоматически — это
// единственное значение в генераторе, не читаемое напрямую из исходника. См. plan.md, риск R10.
const SSH_FS_BATCH_SIZE = 150

const pathUtils = createPathUtils('/')

/** dir(path)=>string — по образцу вызова из ssh-fs-provider.js (SSH-путь всегда POSIX). */
function joinFn(dir, name) {
  return pathUtils.join(dir, name)
}

// ---------------------------------------------------------------------------------------------
// Сбор фикстур в память: Map<относительный путь внутри FIXTURES_ROOT, string|Buffer>.
// Строки пишутся как UTF-8 без BOM; Buffer — как есть (бинарные фикстуры пока не нужны — вход
// парсеров с NUL-байтами кодируется в JSON как base64, см. buildParseFixtures()).
// ---------------------------------------------------------------------------------------------

const files = new Map()

function put(relPath, content) {
  if (files.has(relPath)) {
    throw new Error(`gen-remote-fixtures: дублирующийся путь фикстуры ${relPath}`)
  }
  files.set(relPath, content)
}

function putJson(relPath, value) {
  put(relPath, JSON.stringify(value, null, 2) + '\n')
}

// --- scripts.json ---------------------------------------------------------------------------
// Все именованные экспорты remote-scripts.js — построчные POSIX sh-константы. Побайтовое
// совпадение здесь = гарантия, что READ_DIR_SCRIPT/WRITE_FILE_SCRIPT/TMUX_*_SCRIPT и т.д. на
// мобилке — тот же текст, что уходит на сервер с десктопа (REQ-3).
function buildScriptsFixture() {
  const out = {}
  for (const [name, value] of Object.entries(remoteScripts)) {
    if (typeof value !== 'string') {
      throw new Error(`gen-remote-fixtures: неожиданный тип экспорта remote-scripts.js: ${name}`)
    }
    out[name] = value
  }
  putJson('scripts.json', out)
}

// --- config.json -----------------------------------------------------------------------------
// Снимок числовых/строковых констант, от которых зависит поведение (таймауты, интервалы поллинга,
// имя дефолтного сокета, regex имени сессии, wheel-последовательности). Ловит класс дрейфа
// «поправили таймаут на десктопе, забыли на мобилке» — см. риск R10 в plan.md.
function serializeConfig(obj) {
  const out = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value instanceof RegExp) {
      out[key] = { $regexSource: value.source, $regexFlags: value.flags }
    } else {
      out[key] = value
    }
  }
  return out
}

function buildConfigFixture() {
  putJson('config.json', {
    SSH_SESSION_CONFIG: serializeConfig(SSH_SESSION_CONFIG),
    SSH_FS_CONFIG: serializeConfig(SSH_FS_CONFIG),
    SSH_FS_BATCH_SIZE
  })
}

// --- session-names.json -----------------------------------------------------------------------
// Вход/выход buildSessionNameBase() и pickFreeSessionName() — детерминированные функции без
// побочных эффектов, фикстуре достаточно пар (аргументы → результат).
function buildSessionNamesFixture() {
  const baseCases = [
    { connectionId: 'abc123', expected: buildSessionNameBase('abc123') },
    { connectionId: 'ABC-123-xyz!!!', expected: buildSessionNameBase('ABC-123-xyz!!!') },
    {
      connectionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      expected: buildSessionNameBase('f47ac10b-58cc-4372-a567-0e02b2c3d479')
    },
    { connectionId: '12345', expected: buildSessionNameBase('12345') },
    { connectionId: 'ъ_юникод_連接', expected: buildSessionNameBase('ъ_юникод_連接') }
  ]

  const longBase64 = 'etty-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ' // 69 символов, обрежется
  const exact64Base = 'a'.repeat(64)

  const pickCases = [
    { base: 'etty-4f2a9c1b', taken: [], expected: pickFreeSessionName('etty-4f2a9c1b', []) },
    {
      base: 'etty-4f2a9c1b',
      taken: ['etty-4f2a9c1b'],
      expected: pickFreeSessionName('etty-4f2a9c1b', ['etty-4f2a9c1b'])
    },
    {
      base: 'etty-4f2a9c1b',
      taken: ['etty-4f2a9c1b', 'etty-4f2a9c1b-2'],
      expected: pickFreeSessionName('etty-4f2a9c1b', ['etty-4f2a9c1b', 'etty-4f2a9c1b-2'])
    },
    {
      base: 'etty-4f2a9c1b',
      taken: ['etty-4f2a9c1b', 'etty-4f2a9c1b-2', 'etty-4f2a9c1b-3'],
      expected: pickFreeSessionName('etty-4f2a9c1b', [
        'etty-4f2a9c1b',
        'etty-4f2a9c1b-2',
        'etty-4f2a9c1b-3'
      ])
    },
    // Базовое имя уже длиной 64 (max) — не занято, суффикс не нужен.
    { base: exact64Base, taken: [], expected: pickFreeSessionName(exact64Base, []) },
    // Базовое имя длиной 64 и занято — суффикс "-2" не влезает без усечения base.
    { base: exact64Base, taken: [exact64Base], expected: pickFreeSessionName(exact64Base, [exact64Base]) },
    { base: longBase64, taken: [], expected: pickFreeSessionName(longBase64, []) }
  ]

  putJson('session-names.json', { buildSessionNameBase: baseCases, pickFreeSessionName: pickCases })
}

// --- persistence.json ------------------------------------------------------------------------
function buildPersistenceFixture() {
  const cases = [
    { sshOptions: { persistence: 'tmux' }, connection: null },
    { sshOptions: { persistence: 'off' }, connection: { persistence: 'tmux' } },
    { sshOptions: undefined, connection: { persistence: 'tmux' } },
    { sshOptions: undefined, connection: { persistence: 'off' } },
    { sshOptions: undefined, connection: null },
    { sshOptions: {}, connection: { persistence: 'tmux' } },
    { sshOptions: { persistence: 'bogus' }, connection: { persistence: 'tmux' } },
    { sshOptions: null, connection: undefined }
  ].map((c) => ({ ...c, expected: resolveSshPersistence(c.sshOptions, c.connection) }))

  putJson('persistence.json', cases)
}

// --- path-utils.json --------------------------------------------------------------------------
// SSH-путь на удалённой стороне всегда POSIX (sep='/') — Windows-ветка createPathUtils('\\')
// на мобилке не нужна и не портируется.
function buildPathUtilsFixture() {
  const joinCases = [
    ['/home/user', ['sub', 'file.txt']],
    ['/home/user/', ['/sub/', 'a.txt']],
    ['relative', ['a', 'b']],
    ['/', ['a']],
    ['/a/b', []],
    ['/a', ['..', 'b']]
  ].map(([dir, parts]) => ({ dir, parts, expected: pathUtils.join(dir, ...parts) }))

  const singleArgCases = ['/a/b/c', '/a', 'a', '/a/b/', '/', '', '/a//b///c', '/a/./b/../c'].map((p) => ({
    input: p,
    dirname: pathUtils.dirname(p),
    basename: pathUtils.basename(p),
    extname: pathUtils.extname(p),
    normalize: pathUtils.normalize(p)
  }))

  const isInsideCases = [
    ['/root', '/root/sub/file'],
    ['/root', '/rootother/file'],
    ['/root', '/root'],
    ['/root/', '/root/sub'],
    ['/root', '/other/root']
  ].map(([root, child]) => ({ root, child, expected: pathUtils.isInside(root, child) }))

  putJson('path-utils.json', { join: joinCases, singleArg: singleArgCases, isInside: isInsideCases })
}

// --- init-command/ ----------------------------------------------------------------------------
// Матрица buildRemoteInitCommand(): каждый успешный кейс — отдельный .txt с сырым текстом
// remote-команды (без обёртывания в JSON, чтобы многострочный shell-текст было легко читать
// diff'ом); невалидные кейсы (ожидается throw) фиксируются только в манифесте — текст ошибки
// это деталь реализации JS, Dart-порт обязан бросить исключение, но не обязан повторять формулировку.
function buildInitCommandFixtures() {
  const sessionName64 = 'a'.repeat(64)
  const sessionName65 = 'a'.repeat(65)

  const cases = [
    { id: 'off_hooks_true', params: { persistence: 'off', hooks: true } },
    { id: 'off_hooks_false', params: { persistence: 'off', hooks: false } },
    {
      id: 'tmux_hooks_true_socket_etty',
      params: { persistence: 'tmux', hooks: true, socketName: 'etty', sessionName: 'etty-4f2a9c1b' }
    },
    {
      id: 'tmux_hooks_true_socket_etty_suffixed',
      params: { persistence: 'tmux', hooks: true, socketName: 'etty', sessionName: 'etty-4f2a9c1b-12' }
    },
    {
      id: 'tmux_hooks_true_default_socket',
      params: { persistence: 'tmux', hooks: true, socketName: '', sessionName: 'etty-4f2a9c1b' }
    },
    {
      id: 'tmux_hooks_false_socket_etty',
      params: { persistence: 'tmux', hooks: false, socketName: 'etty', sessionName: 'etty-4f2a9c1b' }
    },
    {
      id: 'tmux_hooks_false_default_socket',
      params: { persistence: 'tmux', hooks: false, socketName: '', sessionName: 'etty-4f2a9c1b' }
    },
    {
      id: 'tmux_hooks_true_custom_socket',
      params: { persistence: 'tmux', hooks: true, socketName: 'mysock', sessionName: 'A_z-0' }
    },
    {
      id: 'tmux_hooks_true_max_length_session_name',
      params: { persistence: 'tmux', hooks: true, socketName: 'etty', sessionName: sessionName64 }
    },
    // --- невалидные кейсы: ожидается throw ---
    {
      id: 'tmux_invalid_session_name_space',
      params: { persistence: 'tmux', hooks: true, socketName: 'etty', sessionName: 'bad name' },
      expectThrow: true
    },
    {
      id: 'tmux_invalid_session_name_null',
      params: { persistence: 'tmux', hooks: true, socketName: 'etty', sessionName: null },
      expectThrow: true
    },
    {
      id: 'tmux_invalid_session_name_too_long',
      params: { persistence: 'tmux', hooks: true, socketName: 'etty', sessionName: sessionName65 },
      expectThrow: true
    },
    {
      id: 'tmux_invalid_socket_name_space',
      params: { persistence: 'tmux', hooks: true, socketName: 'bad socket', sessionName: 'etty-4f2a9c1b' },
      expectThrow: true
    }
  ]

  const manifest = []
  for (const c of cases) {
    if (c.expectThrow) {
      let message = null
      try {
        buildRemoteInitCommand(c.params)
        throw new Error(`gen-remote-fixtures: кейс ${c.id} должен был бросить исключение, но не бросил`)
      } catch (err) {
        message = err.message
      }
      manifest.push({ id: c.id, params: c.params, expectThrow: true, errorMessage: message })
    } else {
      const output = buildRemoteInitCommand(c.params)
      // Инвариант L0 (assertL0Safe внутри buildRemoteInitCommand уже проверил, что нет ' и !
      // внутри inner-части) — здесь дополнительно проверяем форму обёртки целиком, чтобы
      // генератор не записал фикстуру, если контракт возврата когда-нибудь изменится.
      if (!/^exec \/bin\/sh -c '[\s\S]*'$/.test(output)) {
        throw new Error(`gen-remote-fixtures: неожиданная форма вывода buildRemoteInitCommand для ${c.id}`)
      }
      put(`init-command/${c.id}.txt`, output)
      manifest.push({ id: c.id, params: c.params, expectThrow: false, outputFile: `init-command/${c.id}.txt` })
    }
  }
  putJson('init-command/cases.json', manifest)
}

// --- parse/*.json ----------------------------------------------------------------------------
// Каждый файл — массив кейсов {name, inputBase64, ...доп.аргументы парсера, expected}.
// inputBase64 — сырые байты (Buffer), которые в JS-функцию передаются как Buffer либо строка
// (см. сигнатуры в remote-parse.js) — base64 гарантирует, что NUL/TAB/произвольные байты не
// потеряются при сериализации в JSON.
function b64(strOrBuffer) {
  return Buffer.from(strOrBuffer, 'utf-8').toString('base64')
}

function nulJoin(fields) {
  return fields.join('\0')
}

function buildParseProbeFixture() {
  const stdouts = {
    full_featured: [
      'Linux',
      '/home/dev',
      'dev',
      '/bin/zsh',
      'gnu',
      'find0',
      'inotify',
      'rg',
      'tmux 3.3a',
      'apt'
    ].join('\n') + '\n',
    minimal: ['Darwin', '/Users/dev', 'dev', '', 'bsd', 'nofind0', '-', '-', '-', '-'].join('\n') + '\n',
    tmux_next_snapshot: [
      'Linux',
      '/home/dev',
      'dev',
      '/bin/bash',
      'gnu',
      'find0',
      '-',
      '-',
      'tmux next-3.5',
      'dnf'
    ].join('\n'),
    tmux_below_passthrough_threshold: [
      'Linux',
      '/home/dev',
      'dev',
      '/bin/bash',
      'gnu',
      'find0',
      '-',
      '-',
      'tmux 2.9',
      'yum'
    ].join('\n'),
    tmux_exactly_at_threshold: [
      'Linux',
      '/home/dev',
      'dev',
      '/bin/bash',
      'gnu',
      'find0',
      '-',
      '-',
      'tmux 3.3',
      '-'
    ].join('\n'),
    // Регрессия для лексикографического сравнения версий: "3.10" < "3.3" посимвольно, но
    // 10 >= 3 численно — должно распознаваться как поддерживающее passthrough.
    tmux_numeric_not_lexicographic: [
      'Linux',
      '/home/dev',
      'dev',
      '/bin/bash',
      'gnu',
      'find0',
      '-',
      '-',
      'tmux 3.10',
      '-'
    ].join('\n')
  }

  const cases = Object.entries(stdouts).map(([name, stdout]) => ({
    name,
    inputBase64: b64(stdout),
    expected: remoteParse.parseProbe(stdout)
  }))
  putJson('parse/parse-probe.json', cases)
}

function buildParseTmuxSessionStateFixture() {
  const inputs = {
    normal: '/home/dev/project|/home/dev/project|zsh\n',
    missing_fields: 'onlypath\n',
    empty: '',
    all_fields_empty: '||\n',
    extra_lines_ignored: '/a|/b|vim\nSHOULD_BE_IGNORED\n'
  }
  const cases = Object.entries(inputs).map(([name, stdout]) => ({
    name,
    inputBase64: b64(stdout),
    expected: remoteParse.parseTmuxSessionState(stdout)
  }))
  putJson('parse/parse-tmux-session-state.json', cases)
}

function buildParseTmuxSessionsFixture() {
  function sessionLine(windows, attached, created, activity, name) {
    return nulJoin([String(windows), String(attached), String(created), String(activity), name])
  }
  function paneLine(windowActive, paneActive, command, name) {
    return nulJoin([windowActive, paneActive, command, name])
  }

  const cases = []

  // Две сессии, одна прицеплена (attached), у каждой активная панель с командой.
  {
    const sessionLines = [
      sessionLine(2, 1, 1700000000, 1700000100, 'etty-4f2a9c1b'),
      sessionLine(1, 0, 1700000050, 1700000060, 'etty-9a8b7c6d')
    ]
    const paneLines = [
      paneLine('1', '1', 'vim', 'etty-4f2a9c1b'),
      paneLine('0', '1', 'zsh', 'etty-4f2a9c1b'), // не активное окно — не должно перекрыть
      paneLine('1', '1', 'htop', 'etty-9a8b7c6d')
    ]
    const buffer = Buffer.from(
      sessionLines.join('\n') + '\n' + '\n' + paneLines.join('\n') + '\n',
      'utf-8'
    )
    cases.push({
      name: 'two_sessions_with_active_panes',
      inputBase64: buffer.toString('base64'),
      expected: remoteParse.parseTmuxSessions(buffer)
    })
  }

  // Пустой сервер: ни одной сессии.
  {
    const buffer = Buffer.from('\n', 'utf-8')
    cases.push({
      name: 'empty_server',
      inputBase64: buffer.toString('base64'),
      expected: remoteParse.parseTmuxSessions(buffer)
    })
  }

  // session_activity пустой (старый tmux < 2.1) — activityAt должен стать null, не 0.
  {
    const sessionLines = [nulJoin(['1', '0', '1700000000', '', 'etty-old'])]
    const buffer = Buffer.from(sessionLines.join('\n') + '\n' + '\n' + '\n', 'utf-8')
    cases.push({
      name: 'empty_activity_field',
      inputBase64: buffer.toString('base64'),
      expected: remoteParse.parseTmuxSessions(buffer)
    })
  }

  // Битая запись (TAB→NUL в имени после ручного rename-session сдвинул числовые поля) —
  // отбрасывается целиком, соседняя валидная запись остаётся.
  {
    const sessionLines = [
      nulJoin(['not-a-number', '1', '1700000000', '1700000010', 'weird']),
      sessionLine(1, 1, 1700000020, 1700000030, 'etty-valid')
    ]
    const buffer = Buffer.from(sessionLines.join('\n') + '\n' + '\n' + '\n', 'utf-8')
    cases.push({
      name: 'malformed_record_dropped',
      inputBase64: buffer.toString('base64'),
      expected: remoteParse.parseTmuxSessions(buffer)
    })
  }

  // Сортировка: attached сначала, затем по activityAt убыв.; без activity — в хвост.
  {
    const sessionLines = [
      sessionLine(1, 0, 1700000000, null_marker(), 'etty-no-activity'),
      sessionLine(1, 0, 1700000000, 1700000050, 'etty-older-activity'),
      sessionLine(1, 1, 1700000000, 1700000010, 'etty-attached'),
      sessionLine(1, 0, 1700000000, 1700000090, 'etty-newest-activity')
    ]
    const buffer = Buffer.from(sessionLines.join('\n') + '\n' + '\n' + '\n', 'utf-8')
    cases.push({
      name: 'sort_order',
      inputBase64: buffer.toString('base64'),
      expected: remoteParse.parseTmuxSessions(buffer)
    })
  }

  function null_marker() {
    return '' // пустая строка в поле activity — не проходит /^\d+$/, даёт activityAt=null
  }

  putJson('parse/parse-tmux-sessions.json', cases)
}

function buildParseReadDirFixture() {
  const dirPath = '/home/dev/project'
  function makeBuffer(dirs, filesEntries) {
    const dirPart = dirs.map((d) => `./${d}`).join('\0') + (dirs.length ? '\0' : '')
    const filePart = filesEntries.map((f) => `./${f}`).join('\0') + (filesEntries.length ? '\0' : '')
    return Buffer.from(dirPart + '\0' + filePart, 'utf-8')
  }

  const cases = [
    {
      name: 'mixed_dirs_and_files',
      dirs: ['sub dir', '.hidden-dir'],
      files: ['normal.txt', '.hidden-file', 'emoji😀.txt', "name'with\"quotes"]
    },
    { name: 'empty_directory', dirs: [], files: [] },
    { name: 'only_dirs', dirs: ['a', 'b', 'c'], files: [] },
    { name: 'only_files', dirs: [], files: ['a.txt', 'b.txt'] },
    { name: 'name_with_embedded_newline', dirs: [], files: ['weird\nname.txt'] }
  ].map(({ name, dirs, files: fileNames }) => {
    const buffer = makeBuffer(dirs, fileNames)
    return {
      name,
      dirPath,
      inputBase64: buffer.toString('base64'),
      expected: remoteParse.parseReadDir(buffer, dirPath, joinFn)
    }
  })

  putJson('parse/parse-read-dir.json', cases)
}

function buildParseMoveOrCopyManyFixture() {
  function outcomeBuffer(pairs) {
    // pairs: [['O', '/dst/a'], ['E', '/src/b']]
    return Buffer.from(pairs.map(([status, value]) => `${status}\0${value}\0`).join(''), 'utf-8')
  }

  const cases = [
    {
      name: 'all_success',
      srcPaths: ['/src/a', '/src/b'],
      pairs: [
        ['O', '/dst/a'],
        ['O', '/dst/b']
      ]
    },
    {
      name: 'mixed',
      srcPaths: ['/src/a', '/src/self-move-into-target'],
      pairs: [
        ['O', '/dst/a'],
        ['E', '/src/self-move-into-target']
      ]
    },
    {
      name: 'all_error',
      srcPaths: ['/src/a', '/src/b'],
      pairs: [
        ['E', '/src/a'],
        ['E', '/src/b']
      ]
    },
    { name: 'empty', srcPaths: [], pairs: [] }
  ].map(({ name, srcPaths, pairs }) => {
    const buffer = outcomeBuffer(pairs)
    return {
      name,
      srcPaths,
      inputBase64: buffer.toString('base64'),
      expected: remoteParse.parseMoveOrCopyMany(buffer, srcPaths)
    }
  })

  putJson('parse/parse-move-or-copy-many.json', cases)
}

function buildParseSinglePathResultFixture() {
  const cases = [
    { name: 'value_with_nul_terminator', raw: '/dst/file (copy).txt\0' },
    { name: 'only_nul', raw: '\0' },
    { name: 'empty_no_nul', raw: '' },
    { name: 'unicode_name', raw: '/dst/файл 😀.txt\0extra-after-nul-ignored' }
  ].map(({ name, raw }) => {
    const buffer = Buffer.from(raw, 'utf-8')
    return {
      name,
      inputBase64: buffer.toString('base64'),
      expected: remoteParse.parseSinglePathResult(buffer)
    }
  })

  putJson('parse/parse-single-path-result.json', cases)
}

function buildParseStatFileFixture() {
  const cases = [
    { name: 'well_formed', stdout: '1700000000 4096' },
    { name: 'trailing_newline', stdout: '1700000000 4096\n' },
    { name: 'malformed', stdout: 'not a stat line' },
    { name: 'empty', stdout: '' }
  ].map(({ name, stdout }) => ({
    name,
    inputBase64: b64(stdout),
    expected: remoteParse.parseStatFile(stdout)
  }))

  putJson('parse/parse-stat-file.json', cases)
}

function buildParsePollMtimesFixture() {
  const cases = [
    {
      name: 'mixed_present_and_missing',
      dirPaths: ['/a', '/b', '/c'],
      stdout: '1700000000\nx\n1700000200\n'
    },
    {
      name: 'all_present',
      dirPaths: ['/a', '/b'],
      stdout: '1700000000\n1700000100\n'
    },
    {
      name: 'all_missing',
      dirPaths: ['/a', '/b'],
      stdout: 'x\nx\n'
    },
    { name: 'empty_dir_list', dirPaths: [], stdout: '' }
  ].map(({ name, dirPaths, stdout }) => ({
    name,
    dirPaths,
    inputBase64: b64(stdout),
    // Map → массив [key, value] пар: сохраняет порядок, не зависит от особенностей ключей
    // при сериализации в JSON-объект (см. комментарий генератора).
    expected: Array.from(remoteParse.parsePollMtimes(stdout, dirPaths).entries())
  }))

  putJson('parse/parse-poll-mtimes.json', cases)
}

// ---------------------------------------------------------------------------------------------
// Запись на диск / сверка (--check)
// ---------------------------------------------------------------------------------------------

function collectExistingFiles(root) {
  const result = new Set()
  function walk(dir, relPrefix) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(pathJoin(dir, entry.name), rel)
      } else {
        result.add(rel)
      }
    }
  }
  walk(root, '')
  return result
}

function main() {
  buildScriptsFixture()
  buildConfigFixture()
  buildSessionNamesFixture()
  buildPersistenceFixture()
  buildPathUtilsFixture()
  buildInitCommandFixtures()
  buildParseProbeFixture()
  buildParseTmuxSessionStateFixture()
  buildParseTmuxSessionsFixture()
  buildParseReadDirFixture()
  buildParseMoveOrCopyManyFixture()
  buildParseSinglePathResultFixture()
  buildParseStatFileFixture()
  buildParsePollMtimesFixture()

  for (const [relPath, content] of files) {
    if (content.length === 0) {
      throw new Error(`gen-remote-fixtures: пустая фикстура ${relPath} — это баг генератора`)
    }
  }

  const check = process.argv.includes('--check')

  if (check) {
    const existing = collectExistingFiles(FIXTURES_ROOT)
    const generated = new Set(files.keys())
    const missing = [...generated].filter((f) => !existing.has(f))
    const orphaned = [...existing].filter((f) => !generated.has(f))
    const changed = []
    for (const relPath of generated) {
      if (!existing.has(relPath)) continue
      const onDisk = readFileSync(pathJoin(FIXTURES_ROOT, relPath), 'utf-8')
      if (onDisk !== files.get(relPath)) changed.push(relPath)
    }

    if (missing.length || orphaned.length || changed.length) {
      console.error('gen-remote-fixtures --check: fixtures разошлись с исходным JS-кодом.')
      if (missing.length) console.error('  отсутствуют на диске:\n' + missing.map((f) => `    ${f}`).join('\n'))
      if (changed.length) console.error('  изменилось содержимое:\n' + changed.map((f) => `    ${f}`).join('\n'))
      if (orphaned.length) console.error('  лишние файлы на диске:\n' + orphaned.map((f) => `    ${f}`).join('\n'))
      console.error('\nЗапустите `node scripts/gen-remote-fixtures.mjs` и закоммитьте результат.')
      process.exit(1)
    }
    console.log(`gen-remote-fixtures --check: ${generated.size} файлов совпадают. OK.`)
    return
  }

  // Полная перезапись: сносим старое дерево, чтобы устаревшие (переименованные/удалённые)
  // фикстуры не оставались сиротами на диске.
  rmSync(FIXTURES_ROOT, { recursive: true, force: true })
  mkdirSync(FIXTURES_ROOT, { recursive: true })
  for (const [relPath, content] of files) {
    const fullPath = pathJoin(FIXTURES_ROOT, relPath)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content, 'utf-8')
  }
  console.log(`gen-remote-fixtures: записано ${files.size} файлов в ${pathJoin('mobile', 'test', 'fixtures', 'remote')}`)
}

main()
