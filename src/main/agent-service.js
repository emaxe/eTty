/**
 * Сервис авто-детекта CLI ИИ-агентов.
 * Проверяет наличие команд claude, codex, gh copilot, agent, opencode в $PATH.
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

function getShellEnv() {
  const home = process.env.HOME || '/Users/' + process.env.USER;
  const extraPaths = [
    '/usr/local/bin',
    home + '/.local/bin',
    '/opt/homebrew/bin',
    home + '/.cargo/bin'
  ];
  const basePath = process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin';
  const path = [...new Set([...extraPaths, ...basePath.split(':')])].join(':');
  return {
    ...process.env,
    PATH: path,
    HOME: home,
    USER: process.env.USER || 'unknown'
  };
}

async function runShell(cmd, timeout = 2500) {
  const env = getShellEnv()
  try {
    await execFileAsync('/bin/zsh', ['-l', '-c', cmd], { timeout, env })
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

async function commandExists(command) {
  const result = await runShell(`command -v ${command} >/dev/null 2>&1`, 2500)
  return result.ok
}

async function probeCommand(cmd) {
  const result = await runShell(cmd, 3000)
  return result.ok
}

async function resolveCopilotLaunchCommand() {
  if (await commandExists('copilot')) {
    return 'copilot'
  }

  if (await probeCommand('gh copilot --help >/dev/null 2>&1')) {
    return 'gh copilot'
  }

  return null
}

async function detectAgent(agent) {
  if (agent.checkType === 'copilot') {
    const launchCommand = await resolveCopilotLaunchCommand()
    return {
      detected: !!launchCommand,
      launchCommand: launchCommand || agent.launchCommand
    }
  }

  return {
    detected: await commandExists(agent.command),
    launchCommand: agent.launchCommand
  }
}

export class AgentService {
  constructor() {
    this._cache = null
  }

  async getStatus() {
    if (!this._cache) {
      return this.refresh()
    }

    return this._cache
  }

  async refresh() {
    const agents = await Promise.all(
      SUPPORTED_AGENTS.map(async (agent) => {
        const result = await detectAgent(agent)
        return {
          id: agent.id,
          label: agent.label,
          launchCommand: result.launchCommand,
          detected: result.detected
        }
      })
    )

    this._cache = { checkedAt: Date.now(), agents }
    return this._cache
  }
}
