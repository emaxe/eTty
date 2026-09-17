import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

/**
 * Register file system IPC handlers. Каждый канал принимает опциональный `ctx`
 * (`{kind:'local'}` | `{kind:'ssh', sessionId}` | отсутствует) и резолвит нужный провайдер
 * через `fsProviderRegistry` (см. `fs/fs-provider-registry.js`) — отсутствие `ctx` означает
 * локальную ФС (обратная совместимость с любым не обновлённым на параметр вызовом).
 *
 * Нативные диалоги подтверждения удаления убраны — main не знает, к какому хосту относится
 * путь (`/home/user/x` может быть локальным или SSH), и не может отрендерить это осмысленно.
 * Подтверждение теперь на стороне renderer (`ConfirmDialog`, см. `file-tree.js`) — до вызова.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {{ fsProviderRegistry: import('../fs/fs-provider-registry.js').FsProviderRegistry }} deps
 */
export function registerFsHandlers(ipcMain, { fsProviderRegistry }) {
  ipcMain.handle(IPC_CHANNELS.FS_READ_DIR, async (_, { dirPath, ctx }) => {
    try { return await fsProviderRegistry.resolve(ctx).readDir(dirPath) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_CREATE_FILE, async (_, { filePath, ctx }) => {
    try { return await fsProviderRegistry.resolve(ctx).createFile(filePath) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_CREATE_DIR, async (_, { dirPath, ctx }) => {
    try { return await fsProviderRegistry.resolve(ctx).createDir(dirPath) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_RENAME, async (_, { oldPath, newPath, ctx }) => {
    try { return await fsProviderRegistry.resolve(ctx).rename(oldPath, newPath) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_DELETE, async (_, { targetPath, ctx }) => {
    try { return await fsProviderRegistry.resolve(ctx).delete(targetPath) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_COPY, async (_, { srcPath, destDir, ctx }) => {
    try { return await fsProviderRegistry.resolve(ctx).copy(srcPath, destDir) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_COPY_MANY, async (_, { srcPaths, destDir, ctx }) => {
    try { return await fsProviderRegistry.resolve(ctx).copyMany(srcPaths, destDir) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_MOVE, async (_, { srcPaths, destDir, ctx }) => {
    try { return await fsProviderRegistry.resolve(ctx).move(srcPaths, destDir) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_DELETE_MANY, async (_, { targetPaths, ctx }) => {
    try { return await fsProviderRegistry.resolve(ctx).deleteMany(targetPaths) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_READ_FILE, async (_, { filePath, ctx }) => {
    try { return await fsProviderRegistry.resolve(ctx).readFile(filePath) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_WRITE_FILE, async (_, { filePath, content, ctx }) => {
    try { return await fsProviderRegistry.resolve(ctx).writeFile(filePath, content) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_STAT_FILE, async (_, { filePath, ctx }) => {
    try { return await fsProviderRegistry.resolve(ctx).statFile(filePath) }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle(IPC_CHANNELS.FS_GET_CWD, (_, payload) => fsProviderRegistry.resolve(payload?.ctx).getCwd())

  ipcMain.handle(IPC_CHANNELS.FS_SET_ROOT, (_, { dirPath, ctx }) => {
    fsProviderRegistry.resolve(ctx).setRoot(dirPath)
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.FS_WATCH_DIR, (event, { dirPath, ctx }) => {
    return fsProviderRegistry.resolve(ctx).watchDir(dirPath, event.sender)
  })

  ipcMain.handle(IPC_CHANNELS.FS_UNWATCH_DIR, (_, { dirPath, ctx }) => {
    fsProviderRegistry.resolve(ctx).unwatchDir(dirPath)
  })
}
