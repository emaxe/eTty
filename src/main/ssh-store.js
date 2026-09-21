import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFile, writeFile, mkdir, access } from 'fs/promises'
import log from 'electron-log'
import { SSH_SESSION_CONFIG } from '../shared/ssh-session-config.js'

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
