/**
 * Схема конфигурации: значения по умолчанию и слияние с сохранённым файлом.
 * Без Electron — чтобы схему можно было проверять обычными Node-тестами.
 */

export const CONFIG_VERSION = 1

export function getConfigDefaults() {
  return {
    version: CONFIG_VERSION,
    fileTree: {
      collapseChildrenOnClose: true,
      fileOpenMode: 'double'
    },
    appearance: {
      theme: 'dark',
      // manual — appearance.theme; auto — themeDark/themeLight по системной схеме.
      // По умолчанию manual, чтобы не менять тему существующим пользователям;
      // новый конфиг получает auto (см. loadConfig).
      themeMode: 'manual',
      themeDark: 'etty-dark',
      themeLight: 'etty-light',
      focusIndicator: 'line',
      statusBarSize: 'compact'
    },
    terminal: {
      promptStyle: 'default',
      // Windows: auto | pwsh | powershell | cmd | gitbash | <путь к exe>; на macOS/Linux не используется
      shell: 'auto',
      renderer: 'canvas', // canvas | webgl | dom
      newTabPlacement: 'modifierAdjacent',
      tabSwitchHotkey: 'none',
      // Открытие ссылок терминала в системном браузере: click | cmd-click (Cmd на macOS, Ctrl на остальных)
      linkOpenMode: 'cmd-click',
      // Радиальное меню быстрых команд: gesture — two-finger-double-tap | three-finger-double-tap
      radialMenu: { enabled: true, gesture: 'two-finger-double-tap' },
      // Свайпы двумя пальцами по терминалу (тачпад macOS): swipeVertical — off | arrows;
      // swipeHorizontal — off | arrows | tabs
      swipeVertical: 'off',
      swipeHorizontal: 'off',
      // Модификатор для вертикального свайпа (чтобы не конфликтовал с прокруткой):
      // none | shift | alt | primary (Cmd на macOS, Ctrl на остальных)
      swipeModifier: 'none',
      defaultKeyboardMode: 'kitty',
      // Шрифт терминала; fontFamily '' = системный моно-шрифт по умолчанию
      fontSize: 14,
      lineHeight: 1,
      fontFamily: ''
    },
    agents: {
      // Ручное включение поверх неудачного автообнаружения: true — агент доступен,
      // даже если проверка команды не нашла его в PATH.
      forceEnabled: {},
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
      launchCommands: {
        claude: '',
        codex: '',
        copilot: '',
        agent: '',
        opencode: '',
        qwen: '',
        agento: ''
      },
      custom: [],
      lastDetected: {},
      proxy: '',
      proxyEnabled: false
    },
    ssh: {
      panelPosition: 'off',
      panelMode: 'ssh'
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
  'agents.forceEnabled',
  'agents.launchCommands',
  'agents.lastDetected'
]

export function deepMergeConfig(defaults, saved, warnings, path = '') {
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
      } else if (currentPath === 'terminal.renderer' && !['canvas', 'webgl', 'dom'].includes(savedValue)) {
        warnings.push(`Invalid value for ${currentPath}: "${savedValue}". Expected "canvas", "webgl", or "dom". Using default.`)
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

/** Сливает сохранённый конфиг с актуальными значениями по умолчанию. */
export function mergeConfigWithDefaults(saved, warnings = []) {
  return deepMergeConfig(getConfigDefaults(), saved, warnings)
}
