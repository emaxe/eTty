import { app } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import log from 'electron-log'

/**
 * Настройки приложения. При загрузке — deep merge с дефолтами,
 * чтобы новые поля автоматически подхватывались.
 */
const SETTINGS_FILE = () => join(app.getPath('userData'), 'settings.json')
const SETTINGS_VERSION = 1

export function getDefaults() {
  return {
    version: SETTINGS_VERSION,
    fileTree: {
      collapseChildrenOnClose: true,
      fileOpenMode: 'double'
    },
    appearance: {
      theme: 'catppuccin-mocha'
    }
  }
}

export async function loadSettings() {
  try {
    const raw = await readFile(SETTINGS_FILE(), 'utf-8')
    const data = JSON.parse(raw)
    if (data.version !== SETTINGS_VERSION) return getDefaults()
    // Deep merge: defaults as base, saved values on top
    const defaults = getDefaults()
    return {
      ...defaults,
      ...data,
      fileTree: { ...defaults.fileTree, ...data.fileTree },
      appearance: { ...defaults.appearance, ...data.appearance }
    }
  } catch {
    return getDefaults()
  }
}

export async function saveSettings(settings) {
  try {
    await writeFile(SETTINGS_FILE(), JSON.stringify(settings, null, 2), 'utf-8')
    log.info('settings: saved')
  } catch (e) {
    log.error('settings: failed to save', e.message)
  }
}
