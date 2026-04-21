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
      theme: 'catppuccin-mocha',
      focusIndicator: 'glow'
    },
    terminal: {
      promptStyle: 'default'
    },
    agents: {
      forceDisabled: {
        claude: false,
        codex: false,
        copilot: false,
        agent: false,
        opencode: false
      },
      lastDetected: {},
      proxy: '',
      proxyEnabled: false
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
      appearance: { ...defaults.appearance, ...data.appearance },
      terminal: { ...defaults.terminal, ...data.terminal },
      agents: {
        ...defaults.agents,
        ...data.agents,
        forceDisabled: {
          ...defaults.agents.forceDisabled,
          ...(data.agents?.forceDisabled || {})
        },
        lastDetected: { ...(data.agents?.lastDetected || {}) },
        proxy: typeof data.agents?.proxy === 'string' ? data.agents.proxy : defaults.agents.proxy,
        proxyEnabled: typeof data.agents?.proxyEnabled === 'boolean'
          ? data.agents.proxyEnabled
          : defaults.agents.proxyEnabled
      }
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
