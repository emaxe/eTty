import { clipboard } from 'electron'
import crypto from 'crypto'
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'
import { SSH_FS_CONFIG } from '../../shared/ssh-fs-config.js'
import { UPLOAD_PASTE_IMAGE_SCRIPT } from '../ssh/remote-scripts.js'

const MAX_IMAGE_BYTES = 25 * 1024 * 1024

/**
 * Вставка изображения из буфера обмена в SSH-вкладку. CLI-агенты (claude, opencode, agy) читают
 * изображение из буфера той машины, где запущены, — для удалённого хоста это невозможно, поэтому
 * PNG из буфера Mac загружается на сервер, а в терминал вставляется удалённый путь к файлу.
 * @param {Electron.IpcMain} ipcMain
 * @param {{ sshSessionRegistry: import('../ssh/ssh-session-registry.js').SshSessionRegistry }} deps
 */
export function registerClipboardHandlers(ipcMain, { sshSessionRegistry }) {
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_UPLOAD_IMAGE, async (_event, { ctx } = {}) => {
    try {
      if (ctx?.kind !== 'ssh' || ctx.sessionId == null) return { success: false, error: 'Not an SSH context' }

      const image = clipboard.readImage()
      if (image.isEmpty()) return { success: false, empty: true }
      const png = image.toPNG()
      if (png.length > MAX_IMAGE_BYTES) return { success: false, error: 'Image is too large' }

      const session = sshSessionRegistry.get(ctx.sessionId)
      if (!session?.fsProvider) return { success: false, error: 'SSH session is not ready' }

      const name = `paste-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.png`
      const result = await session.channel.exec(UPLOAD_PASTE_IMAGE_SCRIPT, [name], {
        stdin: png,
        timeoutMs: SSH_FS_CONFIG.IO_TIMEOUT_MS
      })
      const remotePath = result.stdout.toString('utf-8').trim()
      if (result.code !== 0 || !remotePath) {
        const reason = result.error || (result.timedOut ? 'timeout' : result.stderr.toString('utf-8').trim())
        return { success: false, error: reason || 'Upload failed' }
      }
      return { success: true, path: remotePath }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
}
