/**
 * Сервис авто-детекта CLI ИИ-агентов.
 * Проверяет наличие команд claude, codex, gh copilot, agent, opencode в resolved PATH.
 * Результат кэшируется; обновляется при открытии настроек.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export const SUPPORTED_AGENTS = [
  {
    id: 'claude',
    label: 'Claude',
    launchCommand: 'claude',
    checkType: 'command',
    command: 'claude'
  },
  {
    id: 'codex',
    label: 'Codex',
    launchCommand: 'codex',
    checkType: 'command',
    command: 'codex'
  },
  {
    id: 'copilot',
    label: 'Copilot',
    launchCommand: 'gh copilot',
    checkType: 'copilot'
  },
  {
    id: 'agent',
    label: 'Agent',
    launchCommand: 'agent',
    checkType: 'command',
    command: 'agent'
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    launchCommand: 'opencode',
    checkType: 'command',
    command: 'opencode'
  }
]

async function commandExists(command, resolvedPath) {
  try {
    await execFileAsync('sh', ['-c', `command -v ${command} >/dev/null 2>&1`], {
      timeout: 2500,
      env: { ...process.env, PATH: resolvedPath }
    })
    return true
  } catch {
    return false
  }
}

async function probeCommand(cmd, resolvedPath) {
  try {
    await execFileAsync('sh', ['-c', cmd], {
      timeout: 3000,
      env: { ...process.env, PATH: resolvedPath }
    })
    return true
  } catch {
    return false
  }
}

async function resolveCopilotLaunchCommand(resolvedPath) {
  if (await commandExists('copilot', resolvedPath)) {
    return 'copilot'
  }

  if (await probeCommand('gh copilot --help >/dev/null 2>&1', resolvedPath)) {
    return 'gh copilot'
  }

  return null
}

async function detectAgent(agent, resolvedPath) {
  if (agent.checkType === 'copilot') {
    const launchCommand = await resolveCopilotLaunchCommand(resolvedPath)
    return {
      detected: !!launchCommand,
      launchCommand: launchCommand || agent.launchCommand
    }
  }

  let detected = await commandExists(agent.command, resolvedPath)
  let launchCommand = agent.launchCommand

  // Fallback для Codex: если глобальный codex не найден — пробуем через npx
  if (agent.id === 'codex' && !detected) {
    if (await commandExists('npx', resolvedPath)) {
      const npxOk = await probeCommand(
        'npx --no-install @openai/codex --version >/dev/null 2>&1',
        resolvedPath
      )
      if (npxOk) {
        detected = true
        launchCommand = 'npx @openai/codex'
      }
    }
  }

  return { detected, launchCommand }
}

export class AgentService {
  constructor({ shellPathResolver }) {
    this._shellPathResolver = shellPathResolver
    this._cache = null
  }

  async getStatus() {
    if (!this._cache) {
      return this.refresh()
    }

    return this._cache
  }

  async refresh(customAgents = []) {
    // Инвалидируем кэш PATH, чтобы подхватить свежие установки
    this._shellPathResolver.invalidate()
    const resolvedPath = await this._shellPathResolver.resolve()

    const builtInAgents = await Promise.all(
      SUPPORTED_AGENTS.map(async (agent) => {
        const result = await detectAgent(agent, resolvedPath)
        return {
          id: agent.id,
          label: agent.label,
          launchCommand: result.launchCommand,
          detected: result.detected
        }
      })
    )

    const customAgentResults = await Promise.all(
      (customAgents || []).map(async (agent) => {
        let detected = true
        if (agent.checkCommand) {
          detected = await commandExists(agent.checkCommand, resolvedPath)
        }
        return {
          id: agent.id,
          label: agent.label,
          launchCommand: agent.launchCommand,
          detected
        }
      })
    )

    const agents = [...builtInAgents, ...customAgentResults]
    this._cache = { checkedAt: Date.now(), agents }
    return this._cache
  }
}
