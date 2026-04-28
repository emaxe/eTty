import { BrowserWindow, dialog } from 'electron'
import os from 'os'
import log from 'electron-log'
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {{ saveTabState, loadTabState, deleteTabState, hasTabState, validatePath }} deps
 */
export function registerTabsHandlers(ipcMain, { saveTabState, loadTabState, deleteTabState, hasTabState, validatePath }) {
  ipcMain.handle(IPC_CHANNELS.TABS_EXPORT_STATE, (event, tabs) => {
    return saveTabState(tabs)
  })

  ipcMain.handle(IPC_CHANNELS.TABS_HAS_SAVED_STATE, () => hasTabState())

  ipcMain.handle(IPC_CHANNELS.TABS_LOAD_SAVED_STATE, async () => {
    const state = await loadTabState()
    if (!state) return null
    const homedir = os.homedir()
    const validated = []
    for (const tab of state.tabs) {
      const valid = await validatePath(tab.rootPath)
      if (!valid) {
        log.warn('tab-state: path not found, using homedir:', tab.rootPath)
      }
      validated.push({
        rootPath: valid ? tab.rootPath : homedir,
        isActive: tab.isActive,
        tabId: tab.tabId,
        editorState: tab.editorState || null
      })
    }
    return validated
  })

  ipcMain.handle(IPC_CHANNELS.TABS_DELETE_SAVED_STATE, () => deleteTabState())

  ipcMain.handle(IPC_CHANNELS.TABS_SHOW_RESTORE_DIALOG, async (event, tabCount) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Восстановить', 'Не восстанавливать'],
      defaultId: 1,
      cancelId: 1,
      title: 'Восстановление вкладок',
      message: `Восстановить ${tabCount} вкладок?`,
      detail: 'Вкладки из предыдущей сессии можно восстановить.'
    })
    return response === 0
  })
}
