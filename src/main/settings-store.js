import { loadConfig, saveConfig } from './config-loader.js'
import { loadThemes } from './theme-loader.js'
import log from 'electron-log'

/**
 * Оркестратор настроек: агрегирует config и themes из loader-модулей.
 * Возвращает { config, themes, warnings } для renderer.
 */
export async function loadSettings() {
  const { config, warnings: configWarnings } = await loadConfig()
  const { themes, warnings: themeWarnings } = await loadThemes()

  const warnings = [...configWarnings, ...themeWarnings]

  // Если выбранная тема отсутствует — fallback на dark
  if (!themes.has(config.appearance.theme)) {
    const message = `Theme "${config.appearance.theme}" not found, falling back to "dark"`
    log.warn('settings:', message)
    warnings.push(message)
    config.appearance.theme = 'dark'
  }

  // themes как объект для удобства сериализации
  const themesObject = Object.fromEntries(themes)

  return { config, themes: themesObject, warnings }
}

export async function saveSettings(settings) {
  // Сохраняем только config-часть (без themes и warnings)
  const config = settings?.config || settings
  await saveConfig(config)
}
