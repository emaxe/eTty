/**
 * Формат `*.ettyx` — зашифрованный экспорт SSH-подключений (задача #31, REQ-22/23 в
 * `docs/plans/mob/plan.md`). Единственный источник истины для формата: мобильное приложение
 * (`mobile/lib/data/connection_export.dart`) реализует симметричный decrypt на `package:cryptography`
 * и обязано совпадать с этим модулем побайтово по всем параметрам KDF/шифра — иначе экспорт
 * с десктопа не расшифруется на телефоне.
 *
 * Конверт (JSON, что упрощает диагностику битого файла и не требует бинарного парсера на обеих
 * сторонах):
 *   { format: 'ettyx', version: 1, kdf: 'pbkdf2-sha256', iterations, salt, iv, ciphertext, authTag }
 *   — все бинарные поля в base64. Ключ шифрования — PBKDF2-HMAC-SHA256(passphrase, salt,
 *   iterations, 32 байта) → AES-256-GCM(iv, authTag) над UTF-8 JSON полезной нагрузки
 *   (см. [buildEttyxPlaintext]).
 *
 * Чистый модуль — никакого Electron/fs/диалогов (те остаются в `ssh-store.js`/`ssh-handlers.js`),
 * поэтому тестируется без Electron-рантайма (`src/main/__tests__/ettyx-format.test.mjs`).
 */
import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from 'node:crypto'

export const ETTYX_FORMAT = 'ettyx'
export const ETTYX_VERSION = 1
export const ETTYX_KDF = 'pbkdf2-sha256'
export const ETTYX_PBKDF2_ITERATIONS = 600000

const KEY_LENGTH_BYTES = 32 // AES-256
const SALT_LENGTH_BYTES = 16
const IV_LENGTH_BYTES = 12 // AES-GCM стандарт

/**
 * `authType` в сторе десктопа ('agent'|'password'|'key') → «портативное» значение файла —
 * совпадает с именами `SshAuthType` на мобилке (`password`|`privateKey`), плюс `agent`
 * сохраняется как есть: десктоп не решает за импортирующую сторону, что с ним делать (REQ-7 —
 * это обязанность импортирующей стороны, см. докстринг `SshAuthType` в `connection_store.dart`).
 * @param {string} desktopAuthType
 * @returns {'password'|'privateKey'|'agent'}
 */
export function mapAuthTypeToPortable(desktopAuthType) {
  if (desktopAuthType === 'key') return 'privateKey'
  if (desktopAuthType === 'agent') return 'agent'
  return 'password'
}

/**
 * Обратное отображение — для импорта обратно в десктопный стор (`ssh-store.js`).
 * @param {string} portableAuthType
 * @returns {'password'|'key'|'agent'}
 */
export function mapAuthTypeFromPortable(portableAuthType) {
  if (portableAuthType === 'privateKey') return 'key'
  if (portableAuthType === 'agent') return 'agent'
  return 'password'
}

/**
 * Собирает JSON полезной нагрузки (до шифрования) — отдельная функция, а не инлайн в
 * [encryptEttyx], чтобы тест мог проверить форму payload'а независимо от шифрования.
 * @param {object[]} connections — портативные записи, см. докстринг модуля
 * @param {{ exportedAt?: string }} [opts] — `exportedAt` переопределим только в тестах
 *   (детерминированность), в проде всегда берётся `new Date().toISOString()`
 */
export function buildEttyxPlaintext(connections, opts = {}) {
  return JSON.stringify({
    exportedAt: opts.exportedAt || new Date().toISOString(),
    connections,
  })
}

/**
 * Шифрует уже собранный JSON payload'а (см. [buildEttyxPlaintext]) парольной фразой пользователя.
 * @param {string} plaintextJson
 * @param {string} passphrase
 * @returns {string} содержимое `.ettyx`-файла (JSON-конверт, см. докстринг модуля)
 */
export function encryptEttyx(plaintextJson, passphrase) {
  const salt = randomBytes(SALT_LENGTH_BYTES)
  const iv = randomBytes(IV_LENGTH_BYTES)
  const key = pbkdf2Sync(passphrase, salt, ETTYX_PBKDF2_ITERATIONS, KEY_LENGTH_BYTES, 'sha256')
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintextJson, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return JSON.stringify(
    {
      format: ETTYX_FORMAT,
      version: ETTYX_VERSION,
      kdf: ETTYX_KDF,
      iterations: ETTYX_PBKDF2_ITERATIONS,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      authTag: authTag.toString('base64'),
    },
    null,
    2
  )
}

/**
 * Расшифровывает `.ettyx`-файл. Бросает `Error` с человекочитаемым сообщением на: битый JSON,
 * неизвестный формат/версию, неверную парольную фразу (AES-GCM tag mismatch — тот же признак,
 * что повреждение файла, различить их криптографически невозможно, поэтому сообщение общее).
 * @param {string} fileContents
 * @param {string} passphrase
 * @returns {{ exportedAt: string, connections: object[] }}
 */
export function decryptEttyx(fileContents, passphrase) {
  let envelope
  try {
    envelope = JSON.parse(fileContents)
  } catch {
    throw new Error('Файл повреждён или это не .ettyx')
  }

  if (envelope?.format !== ETTYX_FORMAT) {
    throw new Error('Это не файл экспорта eTty (.ettyx)')
  }
  if (envelope.version !== ETTYX_VERSION) {
    throw new Error(`Неподдерживаемая версия формата .ettyx: ${envelope.version}`)
  }

  let plaintext
  try {
    const salt = Buffer.from(envelope.salt, 'base64')
    const iv = Buffer.from(envelope.iv, 'base64')
    const key = pbkdf2Sync(passphrase, salt, envelope.iterations, KEY_LENGTH_BYTES, 'sha256')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'))
    plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()])
  } catch {
    throw new Error('Неверный пароль или файл повреждён')
  }

  try {
    return JSON.parse(plaintext.toString('utf8'))
  } catch {
    throw new Error('Файл повреждён (не удалось разобрать содержимое после расшифровки)')
  }
}
