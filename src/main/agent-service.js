/**
 * Сервис авто-детекта CLI ИИ-агентов.
 * Проверяет наличие команд claude, codex, gh copilot, agent, opencode в resolved PATH.
 * Результат кэшируется; обновляется при открытии настроек.
 */
import { findExecutable, getPathValue, extractCommandBinary } from './env-utils.js'
import { execProgram } from './exec-utils.js'

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
  },
  {
    id: 'qwen',
    label: 'Qwen',
    launchCommand: 'qwen',
    checkType: 'command',
    command: 'qwen'
  },
  {
    id: 'agento',
    label: 'Agento',
    launchCommand: 'agento',
    checkType: 'command',
    command: 'agento'
  }
]

async function commandExists(command, resolvedPath) {
  return findExecutable(command, resolvedPath || getPathValue(process.env)) !== null
}

/** Запуск фиксированной команды как проверки доступности (`gh copilot --help`); успех = код 0. */
async function probeCommand(name, args, resolvedPath) {
  try {
    await execProgram(name, args, { resolvedPath, timeout: 3000 })
    return true
  } catch {
    return false
  }
}

async function resolveCopilotLaunchCommand(resolvedPath) {
  if (await commandExists('copilot', resolvedPath)) {
    return 'copilot'
  }

  if (await probeCommand('gh', ['copilot', '--help'], resolvedPath)) {
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
      const npxOk = await probeCommand('npx', ['--no-install', '@openai/codex', '--version'], resolvedPath)
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
    this._lastCustomAgents = []
    this._lastLaunchCommands = {}
  }

  async getStatus() {
    if (!this._cache) {
      return this.refresh(this._lastCustomAgents, this._lastLaunchCommands)
    }

    return this._cache
  }

  async refresh(customAgentsOrOpts, launchCommandsArg) {
    let customAgents = this._lastCustomAgents
    let launchCommands = this._lastLaunchCommands

    if (Array.isArray(customAgentsOrOpts)) {
      customAgents = customAgentsOrOpts
      if (launchCommandsArg && typeof launchCommandsArg === 'object') {
        launchCommands = launchCommandsArg
      }
    } else if (customAgentsOrOpts && typeof customAgentsOrOpts === 'object') {
      if (Array.isArray(customAgentsOrOpts.custom)) customAgents = customAgentsOrOpts.custom
      if (customAgentsOrOpts.launchCommands && typeof customAgentsOrOpts.launchCommands === 'object') {
        launchCommands = customAgentsOrOpts.launchCommands
      }
    }

    this._lastCustomAgents = customAgents || []
    this._lastLaunchCommands = launchCommands || {}

    // Инвалидируем кэш PATH, чтобы подхватить свежие установки
    this._shellPathResolver.invalidate()
    const resolvedPath = await this._shellPathResolver.resolve()

    const builtInAgents = await Promise.all(
      SUPPORTED_AGENTS.map(async (agent) => {
        const result = await detectAgent(agent, resolvedPath)
        const customCmd = typeof this._lastLaunchCommands?.[agent.id] === 'string'
          ? this._lastLaunchCommands[agent.id].trim()
          : ''
        let detected = result.detected
        let launchCommand = result.launchCommand

        if (customCmd) {
          launchCommand = customCmd
          const customBin = extractCommandBinary(customCmd)
          if (customBin) {
            const customDetected = await commandExists(customBin, resolvedPath)
            detected = customDetected || result.detected
          }
        }

        return {
          id: agent.id,
          label: agent.label,
          launchCommand,
          defaultLaunchCommand: result.launchCommand,
          detected
        }
      })
    )

    const customAgentResults = await Promise.all(
      (this._lastCustomAgents || []).map(async (agent) => {
        let detected = true
        if (agent.checkCommand) {
          const checkBin = extractCommandBinary(String(agent.checkCommand))
          detected = checkBin ? await commandExists(checkBin, resolvedPath) : true
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
