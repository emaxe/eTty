import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFile, writeFile, mkdir, access } from 'fs/promises'
import log from 'electron-log'
import { SSH_SESSION_CONFIG } from '../shared/ssh-session-config.js'
import {
  mapAuthTypeToPortable,
  mapAuthTypeFromPortable,
  buildEttyxPlaintext,
  encryptEttyx,
  decryptEttyx,
} from './ssh/ettyx-format.js'

/**
 * Хранилище SSH-подключений. Отдельно от config.json: config.json целиком уходит
 * в renderer через settings:load, а расшифрованные секреты (пароль/passphrase)
 * не должны покидать main-процесс.
 */
const CONFIG_DIR = () => join(app.getPath('userData'), 'eTty')
const STORE_FILE = () => join(CONFIG_DIR(), 'ssh-connections.json')
const STORE_VERSION = 1

function emptyStore() {
  return { version: STORE_VERSION, connections: [] }
}

async function readStore() {
  try {
    await access(CONFIG_DIR())
  } catch {
    await mkdir(CONFIG_DIR(), { recursive: true })
  }

  try {
    const raw = await readFile(STORE_FILE(), 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.connections)) return emptyStore()
    return parsed
  } catch (e) {
    if (e.code !== 'ENOENT') {
      log.error('ssh-store: failed to read, using empty store', e.message)
    }
    return emptyStore()
  }
}

async function writeStore(store) {
  await mkdir(CONFIG_DIR(), { recursive: true })
  await writeFile(STORE_FILE(), JSON.stringify(store, null, 2), 'utf-8')
}

/** Шифрует секрет, если ОС поддерживает safeStorage. Иначе — не хранит его. */
function encryptSecret(plain) {
  if (!plain) return null
  if (!safeStorage.isEncryptionAvailable()) return null
  return safeStorage.encryptString(plain).toString('base64')
}

/** Расшифровывает секрет. Битые данные считаются отсутствующим секретом. */
function decryptSecret(encoded) {
  if (!encoded) return null
  try {
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
  } catch (e) {
    log.warn('ssh-store: failed to decrypt secret, ignoring', e.message)
    return null
  }
}

/** Убирает секрет из объекта подключения перед отправкой в renderer. */
function toPublic(conn) {
  const { secret, ...rest } = conn
  return { ...rest, hasSecret: !!secret }
}

export async function loadConnections() {
  const store = await readStore()
  return store.connections.map(toPublic)
}

/**
 * Создаёт или обновляет подключение.
 * @param {object} conn — { id?, label, host, port, user, authType, privateKeyPath, secret, extraArgs,
 *   injectShellIntegration?, persistence?, tmuxSocket? }
 *   `secret` — пароль/passphrase в открытом виде (только при изменении); `undefined` — оставить как есть,
 *   `null`/`''` — очистить. `injectShellIntegration` — инжект OSC 7/133-хуков на удалённой стороне
 *   (см. `ssh/remote-shell-hooks.js`), по умолчанию включён. `persistence` — `'off'`|`'tmux'`, DEPRECATED:
 *   режим (обычная сессия / tmux) теперь выбирается ПРИ ПОДКЛЮЧЕНИИ (переключатель SSH/tmux в боковой
 *   панели, передаётся с каждым `pty:create`, см. `ssh/ssh-persistence.js`), форма подключения это поле
 *   больше не отправляет. Значение в сторе остаётся ТОЛЬКО как fallback обратной совместимости — для
 *   вкладок, восстановленных из `tabs-state.json` без явного `persistence` (сохранены до этой фичи):
 *   если `conn.persistence` не передан, СУЩЕСТВУЮЩЕЕ значение сохраняется как есть, а не сбрасывается
 *   в `'off'` — иначе первое же редактирование подключения новым диалогом стёрло бы `'tmux'`, и такие
 *   вкладки перестали бы попадать в свою сессию. `tmuxSocket` — сокет tmux-сервера (`-L`); пустая
 *   строка — сокет по умолчанию (режим совместимости с чужим `tmux ls`).
 */
export async function saveConnection(conn) {
  try {
    const store = await readStore()
    const id = conn.id || crypto.randomUUID()
    const index = store.connections.findIndex(c => c.id === id)
    const existing = index >= 0 ? store.connections[index] : null

    let secret = existing?.secret ?? null
    if (conn.secret !== undefined) {
      secret = conn.secret ? encryptSecret(conn.secret) : null
    }

    const persistence = conn.persistence !== undefined
      ? (conn.persistence === 'tmux' ? 'tmux' : 'off')
      : (existing?.persistence === 'tmux' ? 'tmux' : 'off')

    const record = {
      id,
      label: conn.label || conn.host || 'SSH',
      host: conn.host,
      port: conn.port || 22,
      user: conn.user,
      authType: conn.authType || 'agent',
      privateKeyPath: conn.privateKeyPath || '',
      extraArgs: conn.extraArgs || '',
      injectShellIntegration: conn.injectShellIntegration !== false,
      persistence,
      tmuxSocket: typeof conn.tmuxSocket === 'string' ? conn.tmuxSocket.trim() : SSH_SESSION_CONFIG.DEFAULT_SOCKET,
      secret
    }

    const warning = (conn.secret && !secret && !safeStorage.isEncryptionAvailable())
      ? 'Безопасное хранилище недоступно на этой системе — пароль не сохранён'
      : undefined

    if (index >= 0) {
      store.connections[index] = record
    } else {
      store.connections.push(record)
    }

    await writeStore(store)
    return { success: true, connection: toPublic(record), warning }
  } catch (e) {
    log.error('ssh-store: failed to save connection', e.message)
    return { success: false, error: e.message }
  }
}

export async function deleteConnection(id) {
  try {
    const store = await readStore()
    store.connections = store.connections.filter(c => c.id !== id)
    await writeStore(store)
    return { success: true }
  } catch (e) {
    log.error('ssh-store: failed to delete connection', e.message)
    return { success: false, error: e.message }
  }
}

export async function reorderConnections(ids) {
  try {
    const store = await readStore()
    const byId = new Map(store.connections.map(c => [c.id, c]))
    const reordered = ids.map(id => byId.get(id)).filter(Boolean)
    // Сохраняем записи, которых нет в переданном порядке (защита от рассинхрона)
    for (const conn of store.connections) {
      if (!ids.includes(conn.id)) reordered.push(conn)
    }
    store.connections = reordered
    await writeStore(store)
    return { success: true }
  } catch (e) {
    log.error('ssh-store: failed to reorder connections', e.message)
    return { success: false, error: e.message }
  }
}

/**
 * Возвращает подключение с расшифрованным секретом. Только для main-процесса
 * (запуск ssh) — никогда не пересылать результат в renderer как есть.
 */
export async function getConnectionForLaunch(id) {
  const store = await readStore()
  const conn = store.connections.find(c => c.id === id)
  if (!conn) return null
  return { ...conn, secret: decryptSecret(conn.secret) }
}

/**
 * Собирает зашифрованный `.ettyx` (задача #31, REQ-22): портативные записи выбранных подключений
 * (или всех, если `ids` не передан) с расшифрованными секретами. Содержимое приватного ключа
 * читается с диска ТОЛЬКО при `includePrivateKeys: true` — иначе `authType: 'key'`-профили
 * экспортируются без ключа (импортирующая сторона получает предупреждение, см.
 * `ettyx-format.js`/`connection_export.dart`).
 * @param {{ ids?: string[], passphrase: string, includePrivateKeys?: boolean }} opts
 * @returns {Promise<{ success: true, fileContents: string, count: number } | { success: false, error: string }>}
 */
export async function exportConnectionsPayload({ ids, passphrase, includePrivateKeys = false }) {
  try {
    const store = await readStore()
    const selected = ids ? store.connections.filter(c => ids.includes(c.id)) : store.connections

    const portable = []
    for (const conn of selected) {
      const secret = decryptSecret(conn.secret)
      const secrets = {}
      if (conn.authType === 'password') {
        if (secret) secrets.password = secret
      } else if (conn.authType === 'key') {
        if (secret) secrets.passphrase = secret
        if (includePrivateKeys && conn.privateKeyPath) {
          try {
            secrets.privateKeyPem = await readFile(conn.privateKeyPath, 'utf-8')
          } catch (e) {
            log.warn('ssh-store: failed to read private key for export', conn.id, e.message)
          }
        }
      }
      portable.push({
        id: conn.id,
        label: conn.label,
        host: conn.host,
        port: conn.port,
        username: conn.user,
        authType: mapAuthTypeToPortable(conn.authType),
        persistence: conn.persistence,
        tmuxSocket: conn.tmuxSocket,
        hooksEnabled: conn.injectShellIntegration !== false,
        secrets,
      })
    }

    const fileContents = encryptEttyx(buildEttyxPlaintext(portable), passphrase)
    return { success: true, fileContents, count: portable.length }
  } catch (e) {
    log.error('ssh-store: failed to export connections', e.message)
    return { success: false, error: e.message }
  }
}

/** Пишет PEM импортированного приватного ключа в защищённый каталог стора, возвращает путь. */
async function writeImportedPrivateKey(id, pem) {
  const dir = join(CONFIG_DIR(), 'imported-keys')
  await mkdir(dir, { recursive: true })
  const filePath = join(dir, `${id}.pem`)
  await writeFile(filePath, pem, { encoding: 'utf-8', mode: 0o600 })
  return filePath
}

/**
 * Разбирает `.ettyx` и мержит подключения в стор (задача #31) — upsert по `id`: повторный импорт
 * того же файла идемпотентен, а `id` сохраняется как есть (REQ-1 — имя tmux-сессии зависит от
 * него, десктоп и мобилка обязаны находить одну и ту же серверную сессию для «того же»
 * подключения). `extraArgs` — десктоп-специфичное поле, которого нет в портативном формате:
 * у существующей записи сохраняется как было, у новой — пусто.
 * @param {{ fileContents: string, passphrase: string }} opts
 * @returns {Promise<{ success: true, imported: number, warnings: string[] } | { success: false, error: string }>}
 */
export async function importConnectionsFromPayload({ fileContents, passphrase }) {
  let payload
  try {
    payload = decryptEttyx(fileContents, passphrase)
  } catch (e) {
    return { success: false, error: e.message }
  }

  try {
    const store = await readStore()
    const warnings = []
    const records = payload.connections || []

    for (const record of records) {
      const authType = mapAuthTypeFromPortable(record.authType)
      let privateKeyPath = ''
      if (authType === 'key' && record.secrets?.privateKeyPem) {
        privateKeyPath = await writeImportedPrivateKey(record.id, record.secrets.privateKeyPem)
      } else if (authType === 'key') {
        warnings.push(`Профиль «${record.label}»: приватный ключ не был включён в экспорт — добавьте его вручную.`)
      }
      if (record.authType === 'agent') {
        warnings.push(`Профиль «${record.label}» использовал SSH-agent на исходном устройстве — настройте агент заново.`)
      }

      const secretPlain = record.secrets?.password || record.secrets?.passphrase || null
      const index = store.connections.findIndex(c => c.id === record.id)
      const existing = index >= 0 ? store.connections[index] : null

      const newRecord = {
        id: record.id,
        label: record.label || record.host || 'SSH',
        host: record.host,
        port: record.port || 22,
        user: record.username,
        authType,
        privateKeyPath: privateKeyPath || existing?.privateKeyPath || '',
        extraArgs: existing?.extraArgs || '',
        injectShellIntegration: record.hooksEnabled !== false,
        persistence: record.persistence === 'tmux' ? 'tmux' : 'off',
        tmuxSocket: typeof record.tmuxSocket === 'string' ? record.tmuxSocket : SSH_SESSION_CONFIG.DEFAULT_SOCKET,
        secret: secretPlain ? encryptSecret(secretPlain) : null,
      }

      if (index >= 0) {
        store.connections[index] = newRecord
      } else {
        store.connections.push(newRecord)
      }
    }

    await writeStore(store)
    return { success: true, imported: records.length, warnings }
  } catch (e) {
    log.error('ssh-store: failed to import connections', e.message)
    return { success: false, error: e.message }
  }
}
