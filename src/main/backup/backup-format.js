/**
 * Формат резервной копии настроек `*.ettybackup`: конфиг, пользовательские темы и — по желанию —
 * SSH-подключения в одном файле. Чистый модуль (без Electron/fs/диалогов), поэтому проверяется
 * обычным node-тестом (`src/main/__tests__/settings-backup.test.mjs`); запись на диск, чтение тем и
 * слияние с `ssh-store.js` — в `../settings-backup.js`.
 *
 * Без SSH-подключений файл — обычный JSON:
 *   { format: 'etty-backup', version: 1, exportedAt, config, themes }
 * С подключениями — тот же payload, зашифрованный парольной фразой в конверт
 * `ssh/ettyx-format.js` (PBKDF2-HMAC-SHA256 + AES-256-GCM), поле `format` конверта — 'etty-backup'.
 */
import { CONFIG_VERSION } from '../config-schema.js'
import { encryptEttyx, decryptEttyx } from '../ssh/ettyx-format.js'

export const BACKUP_FORMAT = 'etty-backup'
export const BACKUP_VERSION = 1
export const BACKUP_EXTENSION = 'ettybackup'

const BACKUP_LABEL = '.ettybackup'

/**
 * @param {{ config: object, themes?: object[], connections?: object[]|null, exportedAt?: string }} opts
 * @returns {object} payload до сериализации
 */
export function buildBackupPayload({ config, themes = [], connections = null, exportedAt } = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Нечего экспортировать: настройки не загружены')
  }

  const payload = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: exportedAt || new Date().toISOString(),
    config,
    themes: Array.isArray(themes) ? themes : [],
  }
  if (Array.isArray(connections)) payload.connections = connections
  return payload
}

/**
 * @param {object} payload
 * @param {string} [passphrase] — пустая строка = незашифрованный JSON
 * @returns {string} содержимое файла
 */
export function serializeBackup(payload, passphrase = '') {
  const json = JSON.stringify(payload, null, 2)
  if (!passphrase) return json
  return encryptEttyx(json, passphrase, { format: BACKUP_FORMAT, version: BACKUP_VERSION })
}

/**
 * Проверяет только конверт (не расшифровывая), чтобы UI мог решить, спрашивать ли пароль.
 * @param {string} contents
 * @returns {{ encrypted: boolean }}
 */
export function inspectBackup(contents) {
  let parsed
  try {
    parsed = JSON.parse(contents)
  } catch {
    throw new Error(`Файл повреждён или это не резервная копия eTty (${BACKUP_LABEL})`)
  }
  if (parsed?.format !== BACKUP_FORMAT) {
    throw new Error(`Это не файл резервной копии eTty (${BACKUP_LABEL})`)
  }
  return { encrypted: typeof parsed.ciphertext === 'string' && parsed.ciphertext.length > 0 }
}

/**
 * @param {string} contents
 * @param {string} [passphrase]
 * @returns {object} провалидированный payload
 */
export function parseBackup(contents, passphrase = '') {
  const { encrypted } = inspectBackup(contents)

  let payload
  if (encrypted) {
    if (!passphrase) {
      const error = new Error('Файл зашифрован — введите парольную фразу')
      error.code = 'PASSPHRASE_REQUIRED'
      throw error
    }
    payload = decryptEttyx(contents, passphrase, {
      expectedFormat: BACKUP_FORMAT,
      expectedVersion: BACKUP_VERSION,
      label: BACKUP_LABEL,
    })
  } else {
    try {
      payload = JSON.parse(contents)
    } catch {
      throw new Error(`Файл повреждён или это не резервная копия eTty (${BACKUP_LABEL})`)
    }
  }

  return validateBackupPayload(payload)
}

/**
 * @param {object} payload
 * @returns {object} тот же payload
 */
export function validateBackupPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Некорректное содержимое резервной копии')
  }
  if (payload.format !== BACKUP_FORMAT) {
    throw new Error(`Это не файл резервной копии eTty (${BACKUP_LABEL})`)
  }
  if (payload.version !== BACKUP_VERSION) {
    throw new Error(`Неподдерживаемая версия резервной копии: ${payload.version}`)
  }
  if (!payload.config || typeof payload.config !== 'object' || Array.isArray(payload.config)) {
    throw new Error('В резервной копии нет настроек')
  }
  if (payload.config.version !== CONFIG_VERSION) {
    throw new Error(
      `Резервная копия от другой версии eTty (настройки v${payload.config.version}, ожидается v${CONFIG_VERSION})`
    )
  }
  if (payload.themes !== undefined && !Array.isArray(payload.themes)) {
    throw new Error('Некорректный список тем в резервной копии')
  }
  if (payload.connections !== undefined && !Array.isArray(payload.connections)) {
    throw new Error('Некорректный список SSH-подключений в резервной копии')
  }
  if (Array.isArray(payload.connections)) {
    payload.connections.forEach((connection, index) => {
      const ok = connection && typeof connection === 'object' &&
        typeof connection.id === 'string' && connection.id &&
        typeof connection.host === 'string' && connection.host
      if (!ok) throw new Error(`Некорректная запись SSH-подключения №${index + 1} в резервной копии`)
    })
  }
  return payload
}
