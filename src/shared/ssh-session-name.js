import { SSH_SESSION_CONFIG } from './ssh-session-config.js'

/**
 * Базовое имя tmux-сессии для подключения — детерминировано от `connectionId`, чтобы
 * повторное открытие того же подключения находило ту же (уже существующую) сессию вместо
 * создания новой (см. docs/features/ssh-persistent-sessions/checklist.md, «Найденные и
 * исправленные баги»). Совпадает со схемой, что уже используется в проекте.
 * @param {string} connectionId
 * @returns {string}
 */
export function buildSessionNameBase(connectionId) {
  return `etty-${String(connectionId).replace(/[^A-Za-z0-9]/g, '').slice(0, 8)}`
}

/**
 * Первое свободное имя сессии вида `<base>`, `<base>-2`, `<base>-3`, … — свободное значит:
 * не входит в `takenNames` (объединение сессий на сервере и sessionName открытых вкладок).
 * Результат ГАРАНТИРОВАННО проходит `SSH_SESSION_CONFIG.SESSION_NAME_RE` и не превышает 64
 * символа — обрезает `base`, если суффикс не влезает, а не сам суффикс.
 * @param {string} base — см. `buildSessionNameBase()`
 * @param {Iterable<string>} takenNames
 * @returns {string}
 */
export function pickFreeSessionName(base, takenNames = []) {
  const taken = new Set(takenNames)
  if (!taken.has(base)) return base
  const maxLen = SSH_SESSION_CONFIG.SESSION_NAME_RE.source.match(/\{1,(\d+)\}/)?.[1]
  const limit = maxLen ? Number(maxLen) : 64
  for (let n = 2; n < 10000; n++) {
    const suffix = `-${n}`
    const candidate = base.length + suffix.length > limit
      ? base.slice(0, limit - suffix.length) + suffix
      : base + suffix
    if (!taken.has(candidate)) return candidate
  }
  // Практически недостижимо (10000 занятых имён на одно подключение) — но функция обязана
  // вернуть что-то валидное, а не зависнуть.
  return `${base.slice(0, limit - 6)}-${Date.now().toString(36).slice(-5)}`
}
