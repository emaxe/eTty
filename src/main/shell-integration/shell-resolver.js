import path from 'path'
import { findExecutable, getPathValue, fileExists } from '../env-utils.js'

/** Значения настройки `terminal.shell`. Любое другое значение трактуется как путь к исполняемому файлу. */
export const SHELL_SETTINGS = Object.freeze(['auto', 'pwsh', 'powershell', 'cmd', 'gitbash'])

/** Виды оболочек, для которых есть интеграция (cwd, busy, история). */
export const SHELL_KINDS = Object.freeze({
  ZSH: 'zsh',
  PWSH: 'pwsh',
  POWERSHELL: 'powershell',
  GITBASH: 'gitbash',
  CMD: 'cmd',
  CUSTOM: 'custom'
})

/** Вид истории, которую ведёт интеграция оболочки; null — истории по вкладкам нет. */
export const HISTORY_KIND = Object.freeze({
  [SHELL_KINDS.ZSH]: 'zsh',
  [SHELL_KINDS.PWSH]: 'pwsh',
  [SHELL_KINDS.POWERSHELL]: 'pwsh',
  [SHELL_KINDS.GITBASH]: 'bash'
})

const win = path.win32

function kindFromFile(file) {
  switch (win.basename(file).toLowerCase()) {
    case 'pwsh.exe': return SHELL_KINDS.PWSH
    case 'powershell.exe': return SHELL_KINDS.POWERSHELL
    case 'cmd.exe': return SHELL_KINDS.CMD
    case 'bash.exe': return SHELL_KINDS.GITBASH
    default: return SHELL_KINDS.CUSTOM
  }
}

/**
 * Выбирает оболочку для локальной вкладки на Windows.
 * `auto`: pwsh (PATH, затем Program Files) → Windows PowerShell 5.1 → cmd.
 * Недоступная запрошенная оболочка заменяется на `auto` (приложение не должно остаться без терминала).
 * @param {string} [setting] — значение `terminal.shell`
 * @param {{ env?: object, exists?: (p: string) => boolean }} [deps]
 * @returns {{ file: string, kind: string, fellBack: boolean }}
 */
export function resolveWindowsShell(setting = 'auto', { env = process.env, exists } = {}) {
  const existsFn = exists || fileExists
  const pathValue = getPathValue(env, { platform: 'win32' })
  const find = (name) => findExecutable(name, pathValue, { platform: 'win32', exists: existsFn })
  const programFiles = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432].filter(Boolean)
  const systemRoot = env.SystemRoot || 'C:\\Windows'

  const locate = {
    pwsh: () => find('pwsh.exe') || programFiles.map(d => win.join(d, 'PowerShell', '7', 'pwsh.exe')).find(existsFn) || null,
    powershell: () => find('powershell.exe') || [win.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')].find(existsFn) || null,
    cmd: () => env.ComSpec || win.join(systemRoot, 'System32', 'cmd.exe'),
    gitbash: () => programFiles.map(d => win.join(d, 'Git', 'bin', 'bash.exe')).find(existsFn) || null
  }
  const kindOf = { pwsh: SHELL_KINDS.PWSH, powershell: SHELL_KINDS.POWERSHELL, cmd: SHELL_KINDS.CMD, gitbash: SHELL_KINDS.GITBASH }

  const requested = String(setting || 'auto').trim()
  if (requested !== 'auto') {
    if (locate[requested]) {
      const file = locate[requested]()
      if (file) return { file, kind: kindOf[requested], fellBack: false }
    } else if (win.isAbsolute(requested) && existsFn(requested)) {
      return { file: requested, kind: kindFromFile(requested), fellBack: false }
    }
  }

  for (const name of ['pwsh', 'powershell', 'cmd']) {
    const file = locate[name]()
    if (file) return { file, kind: kindOf[name], fellBack: requested !== 'auto' }
  }
  return { file: 'cmd.exe', kind: SHELL_KINDS.CMD, fellBack: requested !== 'auto' }
}
