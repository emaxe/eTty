import fs from 'fs/promises'
import { watch } from 'fs'
import path from 'path'
import os from 'os'

/**
 * Файловые операции с защитой от path traversal.
 * Все мутирующие методы валидируют путь через validatePath() — путь должен
 * находиться внутри текущего CWD. readDir и readFile/writeFile не ограничены
 * CWD, т.к. используются для просмотра/редактирования любых доступных файлов.
 */
const MAX_WATCHERS = 100

export class FileManager {
  constructor() {
    this.cwd = os.homedir()
    /** @type {Map<string, import('fs').FSWatcher>} */
    this._watchers = new Map()
    this._watcherIdCounter = 0
    this._rootWatcherPath = null
  }

  /**
   * Проверяет, что путь не выходит за пределы CWD (path traversal защита).
   * @throws {Error} если путь за пределами CWD
   */
  validatePath(targetPath) {
    const resolved = path.resolve(targetPath)
    if (!resolved.startsWith(this.cwd)) {
      throw new Error('Path traversal denied: path is outside CWD')
    }
    return resolved
  }

  setRoot(newPath) {
    // Очищаем все watchers при смене корневой директории
    this.unwatchAll()
    this.cwd = newPath
  }

  async readDir(dirPath) {
    const resolved = path.resolve(dirPath)
    const entries = await fs.readdir(resolved, { withFileTypes: true })
    return entries.map((entry) => ({
      name: entry.name,
      path: path.join(resolved, entry.name),
      isDirectory: entry.isDirectory()
    }))
  }

  async createFile(filePath) {
    const resolved = this.validatePath(filePath)
    await fs.writeFile(resolved, '', { flag: 'wx' })
    return { success: true }
  }

  async createDir(dirPath) {
    const resolved = this.validatePath(dirPath)
    await fs.mkdir(resolved, { recursive: true })
    return { success: true }
  }

  async rename(oldPath, newPath) {
    const resolvedOld = this.validatePath(oldPath)
    const resolvedNew = this.validatePath(newPath)
    await fs.rename(resolvedOld, resolvedNew)
    return { success: true }
  }

  async delete(targetPath) {
    const resolved = this.validatePath(targetPath)
    await fs.rm(resolved, { recursive: true, force: true })
    return { success: true }
  }

  async copy(srcPath, destDir) {
    const resolvedSrc = this.validatePath(srcPath)
    const resolvedDestDir = this.validatePath(destDir)
    const baseName = path.basename(resolvedSrc)
    let destPath = path.join(resolvedDestDir, baseName)

    try {
      await fs.access(destPath)
      const ext = path.extname(baseName)
      const nameWithoutExt = ext ? baseName.slice(0, -ext.length) : baseName
      destPath = path.join(resolvedDestDir, `${nameWithoutExt} (copy)${ext}`)
    } catch {
      // dest doesn't exist, use original name
    }

    this.validatePath(destPath)
    await fs.cp(resolvedSrc, destPath, { recursive: true })
    return { newPath: destPath }
  }

  async readFile(filePath, maxSize = 5 * 1024 * 1024) {
    const resolved = path.resolve(filePath)
    const stat = await fs.stat(resolved)
    if (stat.size > maxSize) {
      return { success: false, error: 'File too large', size: stat.size }
    }
    const content = await fs.readFile(resolved, 'utf-8')
    return { success: true, content, size: stat.size }
  }

  async writeFile(filePath, content) {
    const resolved = path.resolve(filePath)
    await fs.writeFile(resolved, content, 'utf-8')
    return { success: true }
  }

  getCwd() {
    return { cwd: this.cwd }
  }

  /**
   * Подписывается на изменения в директории через fs.watch.
   * Уведомления дебаунсятся (300ms) и отправляются в renderer через IPC.
   * @returns {string|null} watcher ID или null если достигнут лимит или ошибка
   */
  watchDir(dirPath, webContents, isRoot = false) {
    if (this._watchers.has(dirPath)) return dirPath

    // Проверка лимита watchers
    if (this._watchers.size >= MAX_WATCHERS) {
      console.warn(`[FileManager] Watcher limit reached (${MAX_WATCHERS}). Not watching: ${dirPath}`)
      // Если это корневая директория, сохраняем путь даже без watcher
      if (isRoot) {
        this._rootWatcherPath = dirPath
      }
      return null
    }

    let timer
    try {
      const watcher = watch(dirPath, { persistent: false }, (eventType, filename) => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          if (!webContents.isDestroyed()) {
            webContents.send('fs:dir-changed', { dirPath, eventType, filename })
          }
        }, 300)
      })

      watcher.on('error', (err) => {
        console.warn(`[FileManager] Watcher error for ${dirPath}:`, err.message)
        this.unwatchDir(dirPath)
      })

      watcher.on('close', () => {
        this._watchers.delete(dirPath)
      })

      this._watchers.set(dirPath, watcher)

      if (isRoot) {
        this._rootWatcherPath = dirPath
      }

      return dirPath
    } catch (err) {
      // Специфическая обработка EMFILE (too many open files)
      if (err.code === 'EMFILE') {
        console.error(`[FileManager] EMFILE: too many open files for ${dirPath}. Pruning non-root watchers...`)
        // При EMFILE отключаем все watchers кроме корневого
        this._pruneNonRootWatchers()
        return null
      }
      // ENOENT — директория была удалена до создания watcher
      if (err.code === 'ENOENT') {
        console.warn(`[FileManager] Directory not found (ENOENT): ${dirPath}`)
        return null
      }
      console.warn(`[FileManager] Failed to watch ${dirPath}:`, err.message)
      return null
    }
  }

  /**
   * Отключает все watchers кроме корневого при нехватке ресурсов (EMFILE)
   */
  _pruneNonRootWatchers() {
    const rootPath = this._rootWatcherPath
    const toUnwatch = []
    for (const [dirPath] of this._watchers) {
      if (dirPath !== rootPath) {
        toUnwatch.push(dirPath)
      }
    }
    for (const dirPath of toUnwatch) {
      console.log(`[FileManager] Pruning watcher: ${dirPath}`)
      this.unwatchDir(dirPath)
    }
    console.warn(`[FileManager] Pruned ${toUnwatch.length} watchers. Only root watcher remains.`)
  }

  unwatchDir(dirPath) {
    const w = this._watchers.get(dirPath)
    if (w) {
      w.close()
      this._watchers.delete(dirPath)
      if (this._rootWatcherPath === dirPath) {
        this._rootWatcherPath = null
      }
    }
  }

  unwatchAll() {
    for (const [dirPath] of this._watchers) {
      const w = this._watchers.get(dirPath)
      if (w) w.close()
    }
    this._watchers.clear()
    this._rootWatcherPath = null
  }

  getWatcherCount() {
    return this._watchers.size
  }

  getRootWatcherPath() {
    return this._rootWatcherPath
  }
}
