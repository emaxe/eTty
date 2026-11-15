import { CONFIG_VERSION } from '../config-schema.js'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  buildBackupPayload,
  serializeBackup,
  inspectBackup,
  parseBackup,
  validateBackupPayload,
} from '../backup/backup-format.js'

let failed = false
function assert(cond, message) {
  if (cond) {
    console.log(`PASS: ${message}`)
  } else {
    console.error(`FAIL: ${message}`)
    failed = true
  }
}

function assertThrows(fn, message) {
  try {
    fn()
    console.error(`FAIL: ${message} (не бросило ошибку)`)
    failed = true
  } catch {
    console.log(`PASS: ${message}`)
  }
}

function sampleConfig(overrides = {}) {
  return {
    version: CONFIG_VERSION,
    appearance: { theme: 'etty-dark', themeMode: 'auto' },
    agents: { proxy: 'http://user:pass@proxy.local:8080', proxyEnabled: true },
    quickReplies: { items: [{ id: 'qr-1', label: 'Ok', command: 'Ok', enabled: true }], groups: [] },
    ...overrides,
  }
}

function sampleTheme() {
  return {
    id: 'backup-test',
    name: 'Backup Test',
    ui: { bg: '#000', surface: '#111', border: '#222', muted: '#333', text: '#eee', subtext: '#ddd', accent: '#00f', green: '#0f0', red: '#f00', hover: '#333' },
    terminal: {
      background: '#000', foreground: '#eee', cursor: '#eee', selectionBackground: '#333',
      black: '#000', red: '#f00', green: '#0f0', yellow: '#ff0', blue: '#00f', magenta: '#f0f', cyan: '#0ff', white: '#fff',
      brightBlack: '#333', brightRed: '#f00', brightGreen: '#0f0', brightYellow: '#ff0',
      brightBlue: '#00f', brightMagenta: '#f0f', brightCyan: '#0ff', brightWhite: '#fff',
    },
    editor: {
      bg: '#000', text: '#eee', gutterBg: '#111', lineNumber: '#333', activeLine: '#222', selection: '#333', cursor: '#eee',
      keyword: '#00f', string: '#0f0', number: '#ff0', comment: '#333', function: '#0ff', type: '#f0f',
      variable: '#eee', operator: '#eee', property: '#eee', tag: '#f00', attribute: '#ff0', bracket: '#ddd',
    },
  }
}

function runTest() {
  // 1. Незашифрованный round-trip: config + themes без секретов
  const payload = buildBackupPayload({ config: sampleConfig(), themes: [sampleTheme()], exportedAt: '2026-01-01T00:00:00.000Z' })
  assert(payload.format === BACKUP_FORMAT && payload.version === BACKUP_VERSION, 'payload: формат и версия')
  assert(!('connections' in payload), 'payload: без SSH нет поля connections')

  const plain = serializeBackup(payload)
  assert(!inspectBackup(plain).encrypted, 'plain: файл не считается зашифрованным')
  const parsedPlain = parseBackup(plain)
  assert(parsedPlain.config.quickReplies.items[0].command === 'Ok', 'plain: быстрые ответы сохранились')
  assert(parsedPlain.themes[0].id === 'backup-test', 'plain: тема сохранилась')

  // 2. Зашифрованный round-trip с SSH-подключениями
  const encryptedPayload = buildBackupPayload({
    config: sampleConfig(),
    themes: [],
    connections: [{ id: 'c1', label: 'prod', host: 'example.com', authType: 'password', secrets: { password: 'x' } }],
  })
  const encrypted = serializeBackup(encryptedPayload, 'super-secret-pass')
  assert(inspectBackup(encrypted).encrypted, 'encrypted: определён конверт шифрования')
  const parsedEncrypted = parseBackup(encrypted, 'super-secret-pass')
  assert(parsedEncrypted.connections[0].host === 'example.com', 'encrypted: SSH-подключение сохранилось')
  assert(parsedEncrypted.config.agents.proxyEnabled === true, 'encrypted: настройки агентов сохранились')

  // 3. Зашифрованный файл без пароля требует парольную фразу
  try {
    parseBackup(encrypted)
    console.error('FAIL: parse без пароля должен бросить PASSPHRASE_REQUIRED')
    failed = true
  } catch (e) {
    assert(e.code === 'PASSPHRASE_REQUIRED', 'encrypted: без пароля — PASSPHRASE_REQUIRED')
  }

  // 4. Неверный пароль
  assertThrows(() => parseBackup(encrypted, 'wrong-pass'), 'encrypted: неверный пароль отклонён')

  // 5. Чужой формат файла
  assertThrows(() => inspectBackup(JSON.stringify({ format: 'ettyx', version: 1 })), 'чужой format отклонён')
  assertThrows(() => inspectBackup('не json'), 'битый JSON отклонён')

  // 6. Несовпадение версии формата
  assertThrows(
    () => validateBackupPayload({ format: BACKUP_FORMAT, version: 999, config: sampleConfig() }),
    'неподдерживаемая версия резервной копии отклонена'
  )

  // 7. Файл от другой версии eTty
  assertThrows(
    () => validateBackupPayload({ format: BACKUP_FORMAT, version: BACKUP_VERSION, config: sampleConfig({ version: CONFIG_VERSION + 1 }) }),
    'конфиг от другой версии eTty отклонён'
  )

  // 8. Некорректный список подключений
  assertThrows(
    () => validateBackupPayload({ format: BACKUP_FORMAT, version: BACKUP_VERSION, config: sampleConfig(), connections: {} }),
    'некорректный connections отклонён'
  )
  assertThrows(
    () => validateBackupPayload({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      config: sampleConfig(),
      connections: [{ id: 'c1' }],
    }),
    'запись подключения без host отклонена'
  )

  if (failed) {
    console.error('\nНекоторые проверки не прошли')
    process.exit(1)
  }
  console.log('\nВсе проверки прошли')
}

runTest()
