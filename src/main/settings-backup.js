/**
 * Резервная копия всех настроек eTty (раздел «Резервная копия» в настройках).
 *
 * Собирает `config.json` (внешний вид, терминал, дерево, панель SSH, агенты с прокси, быстрые
 * ответы), пользовательские темы из `themes/*.json` и — по желанию — SSH-подключения в портативном
 * виде (тот же, что у `*.ettyx`). Формат/валидация — `backup/backup-format.js`, шифрование —
 * `ssh/ettyx-format.js`.
 *
 * Импорт заменяет конфиг целиком (с дозаполнением дефолтов), темы и SSH-подключения — upsert по
 * `id`: локальные записи, которых нет в файле, не удаляются. Перед записью текущие config.json и
 * themes/ копируются в `userData/eTty/backups/<timestamp>/`.
 *
 * Применение — только перезапуском приложения: часть настроек (prompt style, shell) читается при
 * создании вкладок, а живая страница настроек хранит свою копию конфига и перезаписала бы импорт.
 */
import { join } from 'path'
import { readFile, writeFile, mkdir, cp, readdir } from 'fs/promises'
import log from 'electron-log'
import { CONFIG_DIR, loadConfig, writeConfigFile } from './config-loader.js'
import { THEMES_DIR, readUserThemes, validateTheme } from './theme-loader.js'
import { buildPortableConnections, mergePortableConnections } from './ssh-store.js'
import { mergeConfigWithDefaults } from './config-schema.js'
import {
  buildBackupPayload,
  serializeBackup,
  inspectBackup,
  parseBackup,
} from './backup/backup-format.js'

const THEME_ID_RE = /^[A-Za-z0-9._-]+$/

/** `20261115-103000` — имя каталога резервной копии перед импортом. */
function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/**
 * @param {{ includeConnections?: boolean, includePrivateKeys?: boolean }} [opts]
 * @returns {Promise<{ payload: object, themesCount: number, connectionsCount: number, warnings: string[] }>}
 */
export async function createBackup({ includeConnections = false, includePrivateKeys = false } = {}) {
  const { config, warnings: configWarnings } = await loadConfig()
  const { themes, warnings: themeWarnings } = await readUserThemes()

  let connections = null
  if (includeConnections) {
    const built = await buildPortableConnections({ includePrivateKeys })
    connections = built.portable
  }

  return {
    payload: buildBackupPayload({ config, themes, connections }),
    themesCount: themes.length,
    connectionsCount: connections?.length || 0,
    warnings: [...(configWarnings || []), ...themeWarnings],
  }
}

/** @param {object} payload @param {string} [passphrase] @returns {string} */
export function serializeBackupFile(payload, passphrase = '') {
  return serializeBackup(payload, passphrase)
}

/** @param {string} contents @returns {{ encrypted: boolean }} */
export function inspectBackupFile(contents) {
  return inspectBackup(contents)
}

/**
 * @param {{ path: string, passphrase?: string }} opts
 * @returns {Promise<{ backupDir: string, themes: number, connections: number, warnings: string[] }>}
 */
export async function applyBackupFile({ path, passphrase = '' }) {
  const contents = await readFile(path, 'utf-8')
  const payload = parseBackup(contents, passphrase)
  return applyBackupPayload(payload)
}

/**
 * @param {object} payload — провалидированный payload (см. `parseBackup`)
 * @returns {Promise<{ backupDir: string, themes: number, connections: number, warnings: string[] }>}
 */
export async function applyBackupPayload(payload) {
  const backupDir = await backupCurrentSettings()

  const warnings = []
  const configWarnings = []
  const config = mergeConfigWithDefaults(payload.config, configWarnings)
  // «Missing field» — ожидаемо (недостающие поля добираются дефолтами), в итог не выносим
  warnings.push(...configWarnings.filter((warning) => !warning.startsWith('Missing field')))
  await writeConfigFile(config)

  const themes = []
  await mkdir(THEMES_DIR(), { recursive: true })
  // upsert по id, а не по имени файла: у пользовательской темы файл может называться иначе
  const existingThemeFiles = await readThemeFileNames()
  for (const theme of payload.themes || []) {
    const errors = validateTheme(theme, String(theme?.id || ''))
    if (errors.length > 0) {
      warnings.push(`Тема «${theme?.name || theme?.id || '?'}» пропущена: ${errors.join('; ')}`)
      continue
    }
    // id попадает в имя файла — не даём выйти за пределы themes/
    if (!THEME_ID_RE.test(theme.id)) {
      warnings.push(`Тема «${theme.name}» пропущена: недопустимый id «${theme.id}»`)
      continue
    }
    const fileName = existingThemeFiles.get(theme.id) || `${theme.id}.json`
    await writeFile(join(THEMES_DIR(), fileName), JSON.stringify(theme, null, 2), 'utf-8')
    themes.push(theme.id)
  }

  let connections = 0
  if (Array.isArray(payload.connections) && payload.connections.length > 0) {
    const merged = await mergePortableConnections(payload.connections)
    connections = merged.imported
    warnings.push(...merged.warnings)
  }

  log.info(`settings-backup: applied (themes=${themes.length}, connections=${connections}, backup=${backupDir})`)
  return { backupDir, themes: themes.length, connections, warnings }
}

/**
 * Карта `id → имя файла` существующих тем: импорт перезаписывает файл темы с тем же id, даже если
 * он назван иначе (иначе рядом появился бы дубль id).
 * @returns {Promise<Map<string, string>>}
 */
async function readThemeFileNames() {
  const byId = new Map()
  let entries
  try {
    entries = await readdir(THEMES_DIR())
  } catch (e) {
    if (e.code === 'ENOENT') return byId
    throw e
  }
  for (const fileName of entries.filter(f => f.endsWith('.json'))) {
    try {
      const parsed = JSON.parse(await readFile(join(THEMES_DIR(), fileName), 'utf-8'))
      if (typeof parsed?.id === 'string' && parsed.id) byId.set(parsed.id, fileName)
    } catch {
      // битый файл не участвует в upsert — его пропустит и loadThemes
    }
  }
  return byId
}

/** Копия текущих config.json и themes/ — откат вручную, если импорт не понравился. */
async function backupCurrentSettings() {
  const dir = join(CONFIG_DIR(), 'backups', timestamp())
  await mkdir(dir, { recursive: true })

  try {
    await cp(join(CONFIG_DIR(), 'config.json'), join(dir, 'config.json'))
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
  try {
    await cp(THEMES_DIR(), join(dir, 'themes'), { recursive: true })
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }

  return dir
}
