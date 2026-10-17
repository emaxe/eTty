/**
 * Диалекты оболочек для команд, которые renderer пишет в PTY (cd, открыть, запустить файл и т.д.).
 * Раньше такие строки собирались с POSIX-экранированием прямо в компонентах; теперь компонент
 * шлёт «намерение» (`cd`/`open`/`run`), а текст команды строит диалект ВКЛАДКИ, куда она пишется:
 * SSH-вкладка — всегда POSIX, локальная — по `shellKind` из ответа `pty:create`.
 */

export const DIALECTS = Object.freeze({
  POSIX: 'posix',
  PWSH: 'pwsh',
  CMD: 'cmd',
  GITBASH: 'gitbash'
})

const UNIX_RUNNERS = { '.sh': 'sh', '.bash': 'bash', '.zsh': 'zsh', '.fish': 'fish' }
const WIN_EXTS = ['.bat', '.cmd', '.ps1']

const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`
const cmdQuote = (s) => `"${String(s).replace(/"/g, '')}"`
const forward = (s) => String(s).replace(/\\/g, '/')
const extOf = (name) => {
  const dot = String(name).lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot).toLowerCase()
}

/** Вид оболочки из `pty:create` (`zsh|pwsh|powershell|gitbash|cmd|custom|null`) → диалект. */
export function dialectForShellKind(shellKind) {
  switch (shellKind) {
    case 'pwsh':
    case 'powershell': return DIALECTS.PWSH
    case 'cmd': return DIALECTS.CMD
    case 'gitbash': return DIALECTS.GITBASH
    default: return DIALECTS.POSIX
  }
}

/**
 * Можно ли запустить файл «кнопкой Run» в дереве: зависит от ОС клиента и типа ФС, не от оболочки.
 * @param {string} fileName
 * @param {{ remote?: boolean, platform?: string }} [ctx]
 */
export function isRunnableFile(fileName, { remote = false, platform = 'darwin' } = {}) {
  const ext = extOf(fileName)
  if (!ext) return false
  if (!remote && platform === 'win32') return WIN_EXTS.includes(ext)
  return ext in UNIX_RUNNERS
}

/**
 * Команды диалекта. Все возвращаемые строки готовы к записи в PTY (заканчиваются `\r`).
 * @param {string} dialect — одно из DIALECTS
 * @param {{ platform?: string }} [opts] — платформа клиента (для команды «открыть» в POSIX-диалекте)
 */
export function createShellCommands(dialect, { platform = 'darwin' } = {}) {
  const eol = '\r'
  // Ctrl+U в bash/zsh; Escape очищает строку в PSReadLine и cmd
  const clearLine = dialect === DIALECTS.PWSH || dialect === DIALECTS.CMD ? '\x1b' : '\x15'

  switch (dialect) {
    case DIALECTS.PWSH:
      return {
        dialect, clearLine, eol,
        cd: (p) => `Set-Location -LiteralPath ${psQuote(p)}${eol}`,
        up: () => `Set-Location ..${eol}`,
        home: () => `Set-Location ~${eol}`,
        open: (p) => `Invoke-Item -LiteralPath ${psQuote(p)}${eol}`,
        run: (p) => `& ${psQuote(p)}${eol}`,
        withEnv: (env, cmd) => Object.entries(env).map(([k, v]) => `$env:${k}=${psQuote(v)}; `).join('') + cmd,
        // fnm в PowerShell работает только после `fnm env`: подключает multishell-каталог в PATH сессии
        useNode: (manager, v) => ({
          nvm: `nvm use ${v}`,
          fnm: `fnm env --shell powershell | Out-String | Invoke-Expression; fnm use ${v}`
        })[manager] ?? null
      }
    case DIALECTS.CMD:
      return {
        dialect, clearLine, eol,
        cd: (p) => `cd /d ${cmdQuote(p)}${eol}`,
        up: () => `cd ..${eol}`,
        home: () => `cd /d %USERPROFILE%${eol}`,
        open: (p) => `start "" ${cmdQuote(p)}${eol}`,
        run: (p, name) => (extOf(name) === '.ps1' ? `powershell -File ${cmdQuote(p)}` : cmdQuote(p)) + eol,
        withEnv: (env, cmd) => Object.entries(env).map(([k, v]) => `set "${k}=${v}" && `).join('') + cmd,
        useNode: (manager, v) => (manager === 'nvm' ? `nvm use ${v}` : null)
      }
    case DIALECTS.GITBASH:
      return {
        dialect, clearLine, eol,
        cd: (p) => `cd ${shQuote(forward(p))}${eol}`,
        up: () => `cd ..${eol}`,
        home: () => `cd ~${eol}`,
        open: (p) => `cmd //c start "" ${shQuote(p)}${eol}`,
        run: (p, name) => {
          const ext = extOf(name)
          if (ext === '.ps1') return `powershell -File ${shQuote(p)}${eol}`
          if (ext === '.bat' || ext === '.cmd') return `cmd //c ${shQuote(p)}${eol}`
          return `${UNIX_RUNNERS[ext] || 'sh'} ${shQuote(forward(p))}${eol}`
        },
        withEnv: (env, cmd) => Object.entries(env).map(([k, v]) => `${k}=${shQuote(v)} `).join('') + cmd,
        useNode: (manager, v) => ({
          nvm: `nvm use ${v}`,
          fnm: `eval "$(fnm env --shell bash)" && fnm use ${v}`
        })[manager] ?? null
      }
    default:
      return {
        dialect: DIALECTS.POSIX, clearLine, eol,
        cd: (p) => `cd ${shQuote(p)}${eol}`,
        up: () => `cd ..${eol}`,
        home: () => `cd ~${eol}`,
        open: (p) => `${platform === 'darwin' ? 'open' : 'xdg-open'} ${shQuote(p)}${eol}`,
        run: (p, name) => `${UNIX_RUNNERS[extOf(name)] || 'sh'} ${shQuote(p)}${eol}`,
        withEnv: (env, cmd) => Object.entries(env).map(([k, v]) => `${k}=${shQuote(v)} `).join('') + cmd,
        useNode: (manager, v) => ({ nvm: `nvm use ${v}`, fnm: `fnm use ${v}`, asdf: `asdf shell nodejs ${v}` })[manager] ?? null
      }
  }
}
