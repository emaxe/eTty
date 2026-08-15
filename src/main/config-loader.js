import { app, dialog } from 'electron'
import { join } from 'path'
import { readFile, writeFile, mkdir, access } from 'fs/promises'
import log from 'electron-log'

const CONFIG_DIR = () => join(app.getPath('userData'), 'eTty')
const CONFIG_FILE = () => join(CONFIG_DIR(), 'config.json')
const CONFIG_VERSION = 1

export function getConfigDefaults() {
  return {
    version: CONFIG_VERSION,
    fileTree: {
      collapseChildrenOnClose: true,
      fileOpenMode: 'double'
    },
    appearance: {
      theme: 'dark',
      focusIndicator: 'glow',
      statusBarSize: 'compact'
    },
    terminal: {
      promptStyle: 'default',
      newTabPlacement: 'modifierAdjacent',
      tabSwitchHotkey: 'none'
    },
    agents: {
      forceDisabled: {
        claude: false,
        codex: false,
        copilot: false,
        agent: false,
        opencode: false,
        qwen: false,
        agento: false
      },
      keyboardModes: {
        claude: 'kitty',
        codex: 'kitty',
        copilot: 'kitty',
        agent: 'kitty',
        opencode: 'kitty',
        qwen: 'ctrl-j',
        agento: 'ctrl-j'
      },
      custom: [],
      lastDetected: {},
      proxy: '',
      proxyEnabled: false
    },
    quickReplies: {
      groups: [],
      items: [
        { id: 'qr-1', label: 'Ok', command: 'Ok', enabled: true, agents: ['claude', 'codex', 'copilot', 'agent', 'opencode', 'qwen', 'agento'] },
        { id: 'qr-2', label: 'Продолжай', command: 'Продолжай', enabled: true, agents: ['claude', 'codex', 'copilot', 'agent', 'opencode', 'qwen', 'agento'] },
        { id: 'qr-3', label: '/clear', command: '/clear', enabled: true, agents: ['claude', 'codex', 'copilot', 'agent', 'opencode', 'qwen', 'agento'] },
        { id: 'qr-4', label: '/model', command: '/model', enabled: true, agents: ['claude', 'codex', 'copilot', 'agent', 'opencode', 'qwen', 'agento'] },
        { id: 'qr-5', label: '/exit', command: '/exit', enabled: true, agents: ['claude', 'codex', 'copilot', 'agent', 'qwen', 'agento'] },
        { id: 'qr-6', label: '/new', command: '/new', enabled: true, agents: ['opencode', 'qwen', 'agento'] }
      ]
    }
  }
}

const DYNAMIC_KEY_PATHS = [
  'agents.keyboardModes',
  'agents.forceDisabled',
  'agents.lastDetected'
]

function deepMergeConfig(defaults, saved, warnings, path = '') {
  if (saved === null || saved === undefined) return defaults
  if (typeof saved !== 'object' || Array.isArray(saved)) {
    warnings.push(`Invalid type at ${path || 'root'}: expected object, got ${Array.isArray(saved) ? 'array' : typeof saved}. Using defaults.`)
    return defaults
  }

  const result = { ...defaults }
  const allowUnknownKeys = DYNAMIC_KEY_PATHS.includes(path)

  for (const key of Object.keys(defaults)) {
    const currentPath = path ? `${path}.${key}` : key
    if (!(key in saved)) {
      warnings.push(`Missing field: ${currentPath}, using default`)
      continue
    }
    const savedValue = saved[key]
    const defaultValue = defaults[key]

    if (key === 'version') {
      if (typeof savedValue !== 'number') {
        warnings.push(`Invalid type for ${currentPath}: expected number, got ${typeof savedValue}. Using default.`)
        result[key] = defaultValue
      } else {
        result[key] = savedValue
      }
      continue
    }

    if (typeof defaultValue === 'object' && !Array.isArray(defaultValue) && defaultValue !== null) {
      result[key] = deepMergeConfig(defaultValue, savedValue, warnings, currentPath)
    } else if (typeof defaultValue === 'boolean') {
      if (typeof savedValue !== 'boolean') {
        warnings.push(`Invalid type for ${currentPath}: expected boolean, got ${typeof savedValue}. Using default.`)
        result[key] = defaultValue
      } else {
        result[key] = savedValue
      }
    } else if (typeof defaultValue === 'string') {
      if (typeof savedValue !== 'string') {
        warnings.push(`Invalid type for ${currentPath}: expected string, got ${typeof savedValue}. Using default.`)
        result[key] = defaultValue
      } else {
        result[key] = savedValue
      }
    } else if (typeof defaultValue === 'number') {
      if (typeof savedValue !== 'number') {
        warnings.push(`Invalid type for ${currentPath}: expected number, got ${typeof savedValue}. Using default.`)
        result[key] = defaultValue
      } else {
        result[key] = savedValue
      }
    } else {
      result[key] = savedValue !== undefined ? savedValue : defaultValue
    }
  }

  // Handle unknown keys: preserve for dynamic-key objects, warn otherwise
  for (const key of Object.keys(saved)) {
    if (!(key in defaults)) {
      if (allowUnknownKeys) {
        result[key] = saved[key]
      } else {
        warnings.push(`Unknown field ignored: ${path ? `${path}.${key}` : key}`)
      }
    }
  }

  return result
}

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

  const merged = deepMergeConfig(defaults, parsed, warnings)
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
