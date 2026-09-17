import log from 'electron-log'
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'
import { SSH_FS_CONFIG } from '../../shared/ssh-fs-config.js'
import {
  READ_DIR_SCRIPT, READ_DIR_FALLBACK_SCRIPT, CREATE_FILE_SCRIPT, CREATE_DIR_SCRIPT,
  RENAME_SCRIPT, DELETE_MANY_SCRIPT, COPY_SCRIPT, COPY_MANY_SCRIPT, MOVE_SCRIPT,
  READ_FILE_SCRIPT, WRITE_FILE_SCRIPT, STAT_FILE_GNU_SCRIPT, STAT_FILE_BSD_SCRIPT,
  POLL_MTIME_GNU_SCRIPT, POLL_MTIME_BSD_SCRIPT
} from '../ssh/remote-scripts.js'
import { parseReadDir, parseMoveOrCopyMany, parseSinglePathResult, parseStatFile, parsePollMtimes } from '../ssh/remote-parse.js'

// argv одного exec() вызова физически ограничен (ARG_MAX на удалённой стороне, обычно
// несколько сотен КБ) — чанкуем пакетные операции (delete/move/copy) по путям.
const BATCH_SIZE = 150

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Человекочитаемая ошибка из неуспешного exec() — единая точка форматирования. */
function execError(result, fallback = 'Remote command failed') {
  if (result.error) return result.error
  if (result.timedOut) return 'Timed out'
  const stderr = result.stderr?.toString('utf-8').trim()
  return stderr || `${fallback} (exit ${result.code})`
}

/**
 * `FsProvider` (см. `fs-provider.js`) для удалённой ФС по SSH — операции идут через
 * `SshControlChannel.exec()` (короткоживущие non-interactive `ssh` по ControlMaster-каналу,
 * см. `ssh/ssh-control-channel.js`) и скрипты из `ssh/remote-scripts.js`.
 *
 * `fs.watch` по SSH невозможен — `watchDir`/`unwatchDir` реализованы через собственный
 * polling: раз в `SSH_FS_CONFIG.POLL_INTERVAL_MS` один exec() опрашивает mtime всех
 * зарегистрированных каталогов и шлёт `fs:dir-changed` для изменившихся.
 */
export class SshFsProvider {
  /**
   * @param {{ channel: import('../ssh/ssh-control-channel.js').SshControlChannel,
   *   root: string, caps: { statFlavor: 'gnu'|'bsd', find0: boolean },
   *   pathUtils: ReturnType<import('../../shared/path-utils.js').createPathUtils> }} params
   */
  constructor({ channel, root, caps, pathUtils }) {
    this._channel = channel
    this._root = root
    this._caps = caps
    this._path = pathUtils
    /** @type {Map<string, Electron.WebContents>} путь → webContents, для push fs:dir-changed */
    this._watched = new Map()
    this._pollTimer = null
    this._pollInFlight = false
    this._mtimeCache = new Map()
    this._rootWatchPath = null
  }

  _statScript() {
    return this._caps.statFlavor === 'gnu' ? STAT_FILE_GNU_SCRIPT : STAT_FILE_BSD_SCRIPT
  }

  _pollScript() {
    return this._caps.statFlavor === 'gnu' ? POLL_MTIME_GNU_SCRIPT : POLL_MTIME_BSD_SCRIPT
  }

  async readDir(dirPath) {
    const script = this._caps.find0 ? READ_DIR_SCRIPT : READ_DIR_FALLBACK_SCRIPT
    const result = await this._channel.exec(script, [dirPath], { timeoutMs: SSH_FS_CONFIG.OP_TIMEOUT_MS })
    if (result.code === 3) return { success: false, error: 'No such directory' }
    if (result.code !== 0) return { success: false, error: execError(result, 'readDir failed') }
    return parseReadDir(result.stdout, dirPath, this._path.join)
  }

  async createFile(filePath) {
    const result = await this._channel.exec(CREATE_FILE_SCRIPT, [this._root, filePath])
    if (result.code === 13) return { success: false, error: 'Path traversal denied: path is outside CWD' }
    if (result.code !== 0) return { success: false, error: execError(result, 'File already exists') }
    return { success: true }
  }

  async createDir(dirPath) {
    const result = await this._channel.exec(CREATE_DIR_SCRIPT, [this._root, dirPath])
    if (result.code === 13) return { success: false, error: 'Path traversal denied: path is outside CWD' }
    if (result.code !== 0) return { success: false, error: execError(result, 'createDir failed') }
    return { success: true }
  }

  async rename(oldPath, newPath) {
    const result = await this._channel.exec(RENAME_SCRIPT, [this._root, oldPath, newPath])
    if (result.code === 13) return { success: false, error: 'Path traversal denied: path is outside CWD' }
    if (result.code === 17) return { success: false, error: 'Destination already exists' }
    if (result.code !== 0) return { success: false, error: execError(result, 'rename failed') }
    return { success: true }
  }

  async delete(targetPath) {
    return this.deleteMany([targetPath])
  }

  async deleteMany(targetPaths) {
    for (const batch of chunk(targetPaths, BATCH_SIZE)) {
      const result = await this._channel.exec(DELETE_MANY_SCRIPT, [this._root, ...batch])
      if (result.code !== 0) return { success: false, error: execError(result, 'delete failed') }
    }
    this._touchAffectedDirs(targetPaths.map((p) => this._path.dirname(p)))
    return { success: true }
  }

  async copy(srcPath, destDir) {
    const result = await this._channel.exec(COPY_SCRIPT, [this._root, srcPath, destDir])
    if (result.code === 13) return { success: false, error: 'Path traversal denied: path is outside CWD' }
    if (result.code !== 0) return { success: false, error: execError(result, 'copy failed') }
    const newPath = parseSinglePathResult(result.stdout)
    this._touchAffectedDirs([destDir])
    return { newPath }
  }

  async copyMany(srcPaths, destDir) {
    const results = []
    for (const batch of chunk(srcPaths, BATCH_SIZE)) {
      const result = await this._channel.exec(COPY_MANY_SCRIPT, [this._root, destDir, ...batch])
      if (result.code !== 0) {
        for (const p of batch) results.push({ path: p, success: false, error: execError(result, 'copy failed') })
        continue
      }
      results.push(...parseMoveOrCopyMany(result.stdout, batch).map((r) => ({ path: r.path, newPath: r.newPath })))
    }
    this._touchAffectedDirs([destDir])
    return { results }
  }

  async move(srcPaths, destDir) {
    const results = []
    for (const batch of chunk(srcPaths, BATCH_SIZE)) {
      const result = await this._channel.exec(MOVE_SCRIPT, [this._root, destDir, ...batch])
      if (result.code !== 0) {
        for (const p of batch) results.push({ path: p, success: false, error: execError(result, 'move failed') })
        continue
      }
      results.push(...parseMoveOrCopyMany(result.stdout, batch))
    }
    this._touchAffectedDirs([destDir, ...srcPaths.map((p) => this._path.dirname(p))])
    return { results }
  }

  async readFile(filePath, maxSize = 5 * 1024 * 1024) {
    const result = await this._channel.exec(READ_FILE_SCRIPT, [filePath, String(maxSize)], { timeoutMs: SSH_FS_CONFIG.IO_TIMEOUT_MS })
    if (result.code === 2) return { success: false, error: 'No such file' }
    if (result.code === 9) {
      const size = Number(result.stderr.toString('utf-8').trim()) || undefined
      return { success: false, error: 'File too large', size }
    }
    if (result.code !== 0) return { success: false, error: execError(result, 'readFile failed') }
    return { success: true, content: result.stdout.toString('utf-8'), size: result.stdout.length }
  }

  async writeFile(filePath, content) {
    const result = await this._channel.exec(WRITE_FILE_SCRIPT, [filePath], {
      stdin: Buffer.from(content, 'utf-8'),
      timeoutMs: SSH_FS_CONFIG.IO_TIMEOUT_MS
    })
    if (result.code !== 0) return { success: false, error: execError(result, 'writeFile failed') }
    this._touchAffectedDirs([this._path.dirname(filePath)])
    return { success: true }
  }

  async statFile(filePath) {
    const result = await this._channel.exec(this._statScript(), [filePath])
    if (result.code !== 0) return { success: false, error: execError(result, 'statFile failed') }
    const stat = parseStatFile(result.stdout.toString('utf-8'))
    if (!stat) return { success: false, error: 'Unexpected stat output' }
    return { success: true, ...stat }
  }

  getCwd() {
    return { cwd: this._root }
  }

  setRoot(newPath) {
    this._root = newPath
  }

  // — Polling-watcher взамен fs.watch (недоступен по SSH) —

  watchDir(dirPath, webContents, isRoot = false) {
    this._watched.set(dirPath, webContents)
    if (isRoot) this._rootWatchPath = dirPath
    this._ensurePolling()
    return dirPath
  }

  unwatchDir(dirPath) {
    this._watched.delete(dirPath)
    this._mtimeCache.delete(dirPath)
    if (this._rootWatchPath === dirPath) this._rootWatchPath = null
    if (this._watched.size === 0) this._stopPolling()
  }

  unwatchAll() {
    this._watched.clear()
    this._mtimeCache.clear()
    this._rootWatchPath = null
    this._stopPolling()
  }

  /** Форсирует немедленный push fs:dir-changed для затронутых мутацией каталогов — не ждёт цикла. */
  _touchAffectedDirs(dirPaths) {
    for (const dir of dirPaths) {
      const webContents = this._watched.get(dir)
      if (webContents && !webContents.isDestroyed()) {
        webContents.send(IPC_CHANNELS.FS_DIR_CHANGED, { dirPath: dir, eventType: 'change', filename: null })
      }
    }
  }

  _ensurePolling() {
    if (this._pollTimer) return
    this._pollTimer = setInterval(() => this._pollOnce(), SSH_FS_CONFIG.POLL_INTERVAL_MS)
  }

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
  }

  async _pollOnce() {
    if (this._pollInFlight || this._watched.size === 0) return
    this._pollInFlight = true
    try {
      // Лимит каталогов за цикл: корень + до POLL_MAX_DIRS-1 последних зарегистрированных
      const all = [...this._watched.keys()]
      const dirs = this._rootWatchPath
        ? [this._rootWatchPath, ...all.filter((d) => d !== this._rootWatchPath)].slice(0, SSH_FS_CONFIG.POLL_MAX_DIRS)
        : all.slice(-SSH_FS_CONFIG.POLL_MAX_DIRS)

      const result = await this._channel.exec(this._pollScript(), dirs, { timeoutMs: SSH_FS_CONFIG.OP_TIMEOUT_MS })
      if (result.code !== 0) return
      const mtimes = parsePollMtimes(result.stdout.toString('utf-8'), dirs)
      for (const [dir, mtime] of mtimes) {
        const prev = this._mtimeCache.get(dir)
        this._mtimeCache.set(dir, mtime)
        if (prev !== undefined && prev !== mtime) {
          const webContents = this._watched.get(dir)
          if (webContents && !webContents.isDestroyed()) {
            webContents.send(IPC_CHANNELS.FS_DIR_CHANGED, { dirPath: dir, eventType: 'change', filename: null })
          }
        }
      }
    } catch (e) {
      log.warn('ssh-fs-provider: poll cycle failed', e.message)
    } finally {
      this._pollInFlight = false
    }
  }
}
