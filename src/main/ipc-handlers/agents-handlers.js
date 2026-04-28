import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {{ agentService: import('../agent-service').AgentService }} deps
 */
export function registerAgentsHandlers(ipcMain, { agentService }) {
  ipcMain.handle(IPC_CHANNELS.AGENTS_GET_STATUS, async () => agentService.getStatus())
  ipcMain.handle(IPC_CHANNELS.AGENTS_REFRESH, async () => agentService.refresh())
}
