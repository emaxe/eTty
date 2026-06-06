import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import path from 'path'
import log from 'electron-log'

const execFileAsync = promisify(execFile)
const COMMAND_TIMEOUT_MS = 15000
const NVM_INSTALL_URL = 'https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh'

const MANAGERS = Object.freeze({
  NVM: 'nvm',
  FNM: 'fnm',
  ASDF: 'asdf',
})

/** Valid Node version identifiers: semver, or known aliases like 'lts', 'latest', 'node'. */
const VERSION_RE = /^\d+\.\d+\.\d+|[a-zA-Z][a-zA-Z0-9._-]*$/

function isUnix() {
  return process.platform !== 'win32'
}

function validateVersion(version) {
  if (!version || !VERSION_RE.test(version)) {
    throw new Error(`Invalid Node version: ${version}`)
  }
  return version
}

/**
 * Универсальный менеджер версий Node.js.
 * Поддерживает nvm, fnm, asdf.
 * Все команды запускаются через shell с resolved PATH (ShellPathResolver).
 */
export class NodeVersionManager {
  constructor({ shellPathResolver }) {
    this._resolver = shellPathResolver
  }

  // ── Detection ──

  /**
   * Определяет, какой менеджер версий доступен в системе.
   * Возвращает { manager: 'nvm'|'fnm'|'asdf'|null, path: string|null }.
   */
  async detectManager() {
    const resolvedPath = this._resolver.getResolvedPath()
    if (!resolvedPath) {
      log.warn('[NodeVersionManager] PATH not resolved yet')
      return { manager: null, path: null }
    }

    const env = { ...process.env, PATH: resolvedPath }

    for (const manager of [MANAGERS.NVM, MANAGERS.FNM, MANAGERS.ASDF]) {
      try {
        const cmd = manager === MANAGERS.NVM
          ? this._nvmShellCommand('nvm --version')
          : `${manager} --version`
        const { stdout } = await this._exec(cmd, env)
        const version = stdout.trim()
        if (version) {
          log.info(`[NodeVersionManager] Detected ${manager} v${version}`)
          return { manager, version }
        }
      } catch (e) {
        // Not found, continue
      }
    }

    log.info('[NodeVersionManager] No node version manager detected')
    return { manager: null, version: null }
  }

  /**
   * Возвращает текущую версию Node.js для указанной папки.
   * Сначала проверяет .nvmrc / .node-version / .tool-versions,
   * затем запускает `node --version` в shell с resolved PATH.
   */
  async getCurrentVersion(cwd) {
    const resolvedPath = this._resolver.getResolvedPath()
    if (!resolvedPath) return null

    const env = { ...process.env, PATH: resolvedPath }

    // Check version files first
    const { manager: detectedManager } = await this.detectManager()
    const versionFile = await this._readVersionFile(cwd, detectedManager)
    if (versionFile) {
      return {
        version: versionFile.version,
        source: versionFile.source,
        manager: versionFile.manager,
      }
    }

    // Fallback: ask node directly
    try {
      const { stdout } = await this._exec('node --version', env, cwd)
      const v = stdout.trim()
      if (v.startsWith('v')) {
        return { version: v.slice(1), source: 'node', manager: null }
      }
      return { version: v, source: 'node', manager: null }
    } catch (e) {
      log.warn('[NodeVersionManager] Failed to get node version:', e.message)
      return null
    }
  }

  /**
   * Список установленных версий Node.js.
   */
  async listInstalled() {
    const { manager } = await this.detectManager()
    if (!manager) return { manager: null, versions: [] }

    const env = this._env()

    try {
      switch (manager) {
        case MANAGERS.NVM: {
          const { stdout } = await this._exec(this._nvmShellCommand('nvm ls --no-colors'), env)
          return { manager, versions: this._parseNvmList(stdout) }
        }
        case MANAGERS.FNM: {
          const { stdout } = await this._exec('fnm list', env)
          return { manager, versions: this._parseFnmList(stdout) }
        }
        case MANAGERS.ASDF: {
          const { stdout } = await this._exec('asdf list nodejs', env)
          return { manager, versions: this._parseAsdfList(stdout) }
        }
      }
    } catch (e) {
      log.warn(`[NodeVersionManager] Failed to list installed versions (${manager}):`, e.message)
      return { manager, versions: [] }
    }
  }

  /**
   * Список доступных для установки версий (remote).
   */
  async listRemote() {
    const { manager } = await this.detectManager()
    if (!manager) return { manager: null, versions: [] }

    const env = this._env()

    try {
      switch (manager) {
        case MANAGERS.NVM: {
          const { stdout } = await this._exec(this._nvmShellCommand('nvm ls-remote --no-colors'), env)
          return { manager, versions: this._parseNvmRemote(stdout) }
        }
        case MANAGERS.FNM: {
          const { stdout } = await this._exec('fnm list-remote', env)
          return { manager, versions: this._parseFnmRemote(stdout) }
        }
        case MANAGERS.ASDF: {
          const { stdout } = await this._exec('asdf list-all nodejs', env)
          return { manager, versions: this._parseAsdfRemote(stdout) }
        }
      }
    } catch (e) {
      log.warn(`[NodeVersionManager] Failed to list remote versions (${manager}):`, e.message)
      return { manager, versions: [] }
    }
  }

  /**
   * Установить версию Node.js.
   */
  async install(version) {
    const v = validateVersion(version)
    const { manager } = await this.detectManager()
    if (!manager) throw new Error('No node version manager found')

    const env = this._env()

    try {
      switch (manager) {
        case MANAGERS.NVM:
          await this._exec(this._nvmShellCommand(`nvm install ${v}`), env)
          break
        case MANAGERS.FNM:
          await this._exec(`fnm install ${v}`, env)
          break
        case MANAGERS.ASDF:
          await this._exec(`asdf install nodejs ${v}`, env)
          break
      }
      return { success: true, manager, version: v }
    } catch (e) {
      log.warn(`[NodeVersionManager] Failed to install ${v} (${manager}):`, e.message)
      throw e
    }
  }

  /**
   * Переключить версию Node.js для указанной папки.
   * Для nvm/fnm — создаёт/обновляет .nvmrc; для asdf — обновляет .tool-versions.
   */
  async use(version, cwd) {
    const v = validateVersion(version)
    const { manager } = await this.detectManager()
    if (!manager) throw new Error('No node version manager found')

    const env = this._env()

    try {
      switch (manager) {
        case MANAGERS.NVM: {
          await this._exec(this._nvmShellCommand(`nvm use ${v}`), env, cwd)
          await fs.writeFile(path.join(cwd, '.nvmrc'), v + '\n')
          break
        }
        case MANAGERS.FNM: {
          await this._exec(`fnm use ${v}`, env, cwd)
          await fs.writeFile(path.join(cwd, '.nvmrc'), v + '\n')
          break
        }
        case MANAGERS.ASDF: {
          await this._exec(`asdf local nodejs ${v}`, env, cwd)
          break
        }
      }
      return { success: true, manager, version: v }
    } catch (e) {
      log.warn(`[NodeVersionManager] Failed to use ${v} (${manager}):`, e.message)
      throw e
    }
  }

  /**
   * Удалить версию Node.js.
   */
  async uninstall(version) {
    const v = validateVersion(version)
    const { manager } = await this.detectManager()
    if (!manager) throw new Error('No node version manager found')

    const env = this._env()

    try {
      switch (manager) {
        case MANAGERS.NVM:
          await this._exec(this._nvmShellCommand(`nvm uninstall ${v}`), env)
          break
        case MANAGERS.FNM:
          await this._exec(`fnm uninstall ${v}`, env)
          break
        case MANAGERS.ASDF:
          await this._exec(`asdf uninstall nodejs ${v}`, env)
          break
      }
      return { success: true, manager, version: v }
    } catch (e) {
      log.warn(`[NodeVersionManager] Failed to uninstall ${v} (${manager}):`, e.message)
      throw e
    }
  }

  /**
   * Автоматическая установка nvm.
   * Возвращает { success: boolean, output: string }.
   */
  async installManager() {
    if (!isUnix()) {
      throw new Error('Automatic nvm installation is only supported on Unix-like systems. Please install nvm manually.')
    }

    try {
      const { stdout, stderr } = await this._exec(
        `curl -o- ${NVM_INSTALL_URL} | bash`,
        process.env
      )
      this._resolver.invalidate()
      return { success: true, output: stdout + stderr }
    } catch (e) {
      log.warn('[NodeVersionManager] Failed to install nvm:', e.message)
      throw e
    }
  }

  // ── Private helpers ──

  _env() {
    const resolvedPath = this._resolver.getResolvedPath()
    return { ...process.env, PATH: resolvedPath || process.env.PATH }
  }

  async _exec(command, env, cwd) {
    const shell = isUnix() ? '/bin/zsh' : (process.env.ComSpec || 'cmd.exe')
    const args = isUnix() ? ['-l', '-i', '-c', command] : ['/c', command]
    return execFileAsync(shell, args, {
      timeout: COMMAND_TIMEOUT_MS,
      env,
      cwd: cwd || process.env.HOME,
    })
  }

  _nvmShellCommand(cmd) {
    const nvmDir = process.env.NVM_DIR || `${process.env.HOME}/.nvm`
    return `[ -s "${nvmDir}/nvm.sh" ] && . "${nvmDir}/nvm.sh" && ${cmd}`
  }

  async _readVersionFile(cwd, detectedManager) {
    const files = [
      { name: '.nvmrc', manager: MANAGERS.NVM },
      { name: '.node-version', manager: detectedManager },
      { name: '.tool-versions', manager: MANAGERS.ASDF },
    ]

    for (const { name, manager } of files) {
      try {
        const filePath = path.join(cwd, name)
        const content = await fs.readFile(filePath, 'utf-8')
        let version = content.trim().split('\n')[0].trim()
        if (name === '.tool-versions') {
          const match = content.match(/^nodejs\s+(.+)$/m)
          if (!match) continue
          version = match[1].trim()
        }
        return { version, source: name, manager }
      } catch (e) {
        // File not found, continue
      }
    }
    return null
  }

  // ── Parsers ──

  _parseNvmList(stdout) {
    const lines = stdout.split('\n')
    const versions = []
    for (const line of lines) {
      const match = line.match(/(->)?\s*v?(\d+\.\d+\.\d+|[a-z]+)\s*/)
      if (match) {
        versions.push({
          version: match[2],
          current: line.includes('->'),
          lts: line.includes('LTS') || line.includes('lts'),
        })
      }
    }
    return versions
  }

  _parseNvmRemote(stdout) {
    const lines = stdout.split('\n')
    const versions = []
    for (const line of lines) {
      const match = line.match(/\s*v?(\d+\.\d+\.\d+|[a-z]+)\s*/)
      if (match) {
        versions.push({
          version: match[1],
          lts: line.includes('LTS') || line.includes('lts'),
        })
      }
    }
    return versions.reverse()
  }

  _parseFnmList(stdout) {
    const lines = stdout.split('\n')
    const versions = []
    for (const line of lines) {
      const match = line.match(/(\*|default)?\s*(\d+\.\d+\.\d+)\s*/)
      if (match) {
        versions.push({
          version: match[2],
          current: line.includes('*'),
        })
      }
    }
    return versions
  }

  _parseFnmRemote(stdout) {
    const lines = stdout.split('\n')
    return lines
      .map(l => l.trim())
      .filter(l => /^\d+\.\d+\.\d+/.test(l))
      .map(v => ({ version: v }))
  }

  _parseAsdfList(stdout) {
    const lines = stdout.split('\n')
    const versions = []
    for (const line of lines) {
      const match = line.match(/(\*)?\s*(\d+\.\d+\.\d+)\s*/)
      if (match) {
        versions.push({
          version: match[2],
          current: line.includes('*'),
        })
      }
    }
    return versions
  }

  _parseAsdfRemote(stdout) {
    const lines = stdout.split('\n')
    return lines
      .map(l => l.trim())
      .filter(l => /^\d+\.\d+\.\d+/.test(l))
      .map(v => ({ version: v }))
  }
}
