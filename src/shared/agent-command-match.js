/**
 * Сопоставление foreground-процесса (tmux `pane_current_command` + полный argv) с ИИ-агентом eTty.
 * `pane_current_command` — лишь имя процесса: у нативного Claude Code это номер версии
 * (`2.1.19`, бинарь лежит в `.../claude/versions/<ver>`), у npm-установки — `node`. Поэтому
 * имя сравнивается только в первом приближении; решающий источник — argv.
 */

/** Интерпретаторы: реальная программа — первый не-флаг аргумент после них. */
const INTERPRETER_RE = /^(node|nodejs|bun|deno|npx|bunx|tsx|python[\d.]*|ruby)$/

/** Фрагменты пути установки → id агента (только для argv0 / скрипта интерпретатора). */
const PATH_HINTS = [
  ['/claude/versions/', 'claude'],
  ['@anthropic-ai/claude-code', 'claude'],
  ['@openai/codex', 'codex'],
  ['@github/copilot', 'copilot'],
  ['opencode-ai', 'opencode']
]

// Имя исполняемого файла: оба разделителя, без Windows-расширения (`C:\\bin\\claude.exe` → `claude`)
const baseName = (token) => String(token || '').split(/[\\/]/).pop().replace(/\.(exe|cmd|bat|ps1)$/i, '')

/**
 * @param {{ command?: string, args?: string }} proc — `command`: имя процесса, `args`: полный argv
 * @param {Array<{ id: string, bases: string[] }>} candidates — агенты и имена их исполняемых файлов
 * @returns {string|null} id агента или null
 */
export function resolveAgentIdByProcess({ command = '', args = '' } = {}, candidates = []) {
  const byName = (name) => {
    if (!name) return null
    for (const c of candidates) {
      if (c.id === name || c.bases.includes(name)) return c.id
    }
    return null
  }
  const byPath = (token) => {
    const normalized = token.replace(/\\/g, '/')
    for (const [fragment, id] of PATH_HINTS) {
      if (normalized.includes(fragment) && candidates.some(c => c.id === id)) return id
    }
    return null
  }

  const fromName = byName(baseName(String(command).trim().split(/\s+/)[0]))
  if (fromName) return fromName

  const tokens = String(args).trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return null

  // Запускаемая программа: argv0, а для интерпретатора — ещё и его скрипт (первый не-флаг)
  const programs = [tokens[0]]
  if (INTERPRETER_RE.test(baseName(tokens[0]))) {
    const script = tokens.slice(1).find(t => !t.startsWith('-'))
    if (script) programs.push(script)
  }
  for (const program of programs) {
    const id = byName(baseName(program)) || byPath(program)
    if (id) return id
  }
  return null
}
