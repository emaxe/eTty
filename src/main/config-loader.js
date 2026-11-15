import { app, dialog } from 'electron'
import { join } from 'path'
import { readFile, writeFile, mkdir, access } from 'fs/promises'
import log from 'electron-log'
import { CONFIG_VERSION, getConfigDefaults, mergeConfigWithDefaults } from './config-schema.js'

export { getConfigDefaults }

const CONFIG_DIR = () => join(app.getPath('userData'), 'eTty')
const CONFIG_FILE = () => join(CONFIG_DIR(), 'config.json')

export async function loadConfig() {
  const warnings = []
  const defaults = getConfigDefaults()

  try {
    await access(CONFIG_DIR())
  } catch {
    await mkdir(CONFIG_DIR(), { recursive: true })
  }

  let raw
  try {
    raw = await readFile(CONFIG_FILE(), 'utf-8')
  } catch (e) {
    if (e.code === 'ENOENT') {
      log.info('config: file not found, creating from defaults')
      // Новая установка: фирменные темы eTty и следование системной схеме
      defaults.appearance.theme = defaults.appearance.themeDark
      defaults.appearance.themeMode = 'auto'
      await writeFile(CONFIG_FILE(), JSON.stringify(defaults, null, 2), 'utf-8')
      return { config: defaults, warnings: ['config.json created with default values'], wasCreated: true }
    }
    throw e
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    const message = `config.json is not valid JSON: ${e.message}. Using default settings.`
    log.error('config:', message)
    dialog.showErrorBox('Configuration Error', message)
    return { config: defaults, warnings: [message], wasCreated: false }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    const message = 'config.json must contain a JSON object. Using default settings.'
    log.error('config:', message)
    dialog.showErrorBox('Configuration Error', message)
    return { config: defaults, warnings: [message], wasCreated: false }
  }

  if (typeof parsed.version !== 'number') {
    const message = `config.json missing or invalid 'version' field (expected number, got ${typeof parsed.version}). Using default settings.`
    log.error('config:', message)
    dialog.showErrorBox('Configuration Error', message)
    return { config: defaults, warnings: [message], wasCreated: false }
  }

  if (parsed.version !== CONFIG_VERSION) {
    const message = `config.json version ${parsed.version} is not supported (expected ${CONFIG_VERSION}). Using default settings.`
    log.error('config:', message)
    dialog.showErrorBox('Configuration Error', message)
    return { config: defaults, warnings: [message], wasCreated: false }
  }

  const merged = mergeConfigWithDefaults(parsed, warnings)
  return { config: merged, warnings, wasCreated: false }
}

export async function saveConfig(config) {
  try {
    await mkdir(CONFIG_DIR(), { recursive: true })
    await writeFile(CONFIG_FILE(), JSON.stringify(config, null, 2), 'utf-8')
    log.info('config: saved')
  } catch (e) {
    log.error('config: failed to save', e.message)
  }
}
