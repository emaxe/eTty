/**
 * Описание и отображение горячих клавиш.
 * spec: { key, mod?, shift?, alt? } — `mod` это Cmd на macOS и Ctrl на остальных платформах.
 */

/**
 * Текст хоткея для подсказок: «⇧⌘G» на macOS, «Ctrl+Shift+G» на остальных.
 * @param {{ key: string, mod?: boolean, shift?: boolean, alt?: boolean }} spec
 * @param {boolean} isMac
 * @returns {string}
 */
export function formatHotkey(spec, isMac) {
  const key = spec.key.length === 1 ? spec.key.toUpperCase() : spec.key
  if (isMac) {
    return `${spec.alt ? '⌥' : ''}${spec.shift ? '⇧' : ''}${spec.mod ? '⌘' : ''}${key}`
  }
  return [spec.mod && 'Ctrl', spec.alt && 'Alt', spec.shift && 'Shift', key].filter(Boolean).join('+')
}

/**
 * Совпадает ли событие клавиатуры со spec. Точное сравнение модификаторов:
 * лишний Shift/Alt не даёт совпадения.
 * @param {KeyboardEvent} e
 * @param {{ key: string, mod?: boolean, shift?: boolean, alt?: boolean }} spec
 * @param {boolean} isMac
 */
export function matchesHotkey(e, spec, isMac) {
  const mod = isMac ? e.metaKey : e.ctrlKey
  const otherMod = isMac ? e.ctrlKey : e.metaKey
  return (
    e.key.toLowerCase() === spec.key.toLowerCase() &&
    mod === !!spec.mod &&
    !otherMod &&
    e.shiftKey === !!spec.shift &&
    e.altKey === !!spec.alt
  )
}

/** Хоткеи приложения: единый источник для подсказок, палитры команд и настроек. */
export const HOTKEYS = Object.freeze({
  commandPalette: { key: 'k', mod: true },
  commandPaletteAlt: { key: 'p', mod: true, shift: true },
  toggleEditor: { key: 'e', mod: true },
  searchProject: { key: 'f', mod: true },
  newTab: { key: 't', mod: true, shift: true },
  toggleGit: { key: 'g', mod: true, shift: true },
  openSettings: { key: ',', mod: true }
})
