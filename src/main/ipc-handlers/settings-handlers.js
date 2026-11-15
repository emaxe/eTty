import { BrowserWindow, dialog } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import log from 'electron-log'
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'
import { BACKUP_EXTENSION } from '../backup/backup-format.js'

const EXPORT_FILTERS = [{ name: 'eTty backup', extensions: [BACKUP_EXTENSION] }]
const IMPORT_FILTERS = [{ name: 'eTty backup', extensions: [BACKUP_EXTENSION, 'json'] }]
const MIN_PASSPHRASE_LENGTH = 8

function defaultBackupFileName() {
  const date = new Date().toISOString().slice(0, 10)
  return `etty-backup-${date}.${BACKUP_EXTENSION}`
}

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {{ loadSettings, saveSettings, settingsBackup: typeof import('../settings-backup.js') }} deps
 */
export function registerSettingsHandlers(ipcMain, { loadSettings, saveSettings, settingsBackup }) {
  ipcMain.handle(IPC_CHANNELS.SETTINGS_LOAD, () => loadSettings())
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SAVE, (_, settings) => saveSettings(settings))

  // Резервная копия: диалоги файла и запись/чтение на диске — в main (renderer не имеет доступа к
  // fs); парольная фраза обязательна только вместе с SSH-подключениями (файл тогда шифруется).
  ipcMain.handle(IPC_CHANNELS.SETTINGS_BACKUP_EXPORT, async (event, opts = {}) => {
    const { includeConnections = false, includePrivateKeys = false, passphrase = '' } = opts
    if (includeConnections && (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH)) {
      return { success: false, error: `Парольная фраза должна быть не короче ${MIN_PASSPHRASE_LENGTH} символов` }
    }

    const win = BrowserWindow.fromWebContents(event.sender)
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Экспорт настроек eTty',
      defaultPath: defaultBackupFileName(),
      filters: EXPORT_FILTERS
    })
    if (canceled || !filePath) return { success: false, canceled: true }

    // Linux не всегда дописывает расширение из фильтра — путь без него не должен «потеряться»
    const targetPath = filePath.endsWith(`.${BACKUP_EXTENSION}`) ? filePath : `${filePath}.${BACKUP_EXTENSION}`

    try {
      const { payload, themesCount, connectionsCount, warnings } = await settingsBackup.createBackup({
        includeConnections,
        includePrivateKeys
      })
      const contents = settingsBackup.serializeBackupFile(payload, includeConnections ? passphrase : '')
      await writeFile(targetPath, contents, 'utf-8')
      return { success: true, path: targetPath, themesCount, connectionsCount, warnings }
    } catch (e) {
      log.error('settings-handlers: failed to export backup', e.message)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_BACKUP_PICK_IMPORT, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Импорт настроек eTty',
      properties: ['openFile'],
      filters: IMPORT_FILTERS
    })
    if (canceled || !filePaths.length) return { canceled: true }

    const path = filePaths[0]
    try {
      const contents = await readFile(path, 'utf-8')
      const { encrypted } = settingsBackup.inspectBackupFile(contents)
      return { path, encrypted }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_BACKUP_IMPORT, async (_, { path, passphrase = '' } = {}) => {
    if (typeof path !== 'string' || !path) return { success: false, error: 'Файл не выбран' }
    try {
      const summary = await settingsBackup.applyBackupFile({ path, passphrase })
      return { success: true, ...summary }
    } catch (e) {
      log.error('settings-handlers: failed to import backup', e.message)
      return {
        success: false,
        error: e.message,
        needPassphrase: e.code === 'PASSPHRASE_REQUIRED'
      }
    }
  })
}
