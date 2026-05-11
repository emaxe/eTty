import fs from 'fs/promises'
import { watch } from 'fs'
import path from 'path'
import os from 'os'
import { IPC_CHANNELS } from '../shared/ipc-channels.js'

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
   * Проверяет, что путь не выходит за пределы CWD (path traversal + symlink защита).
   *
   * Использует `fs.realpath()` для разрешения символических ссылок перед проверкой.
   *
   * Ограничения:
   * - Не защищает от race condition (TOCTOU): symlink может быть создан
   *   между проверкой и фактической операцией
   * - Не защищает от hard links (fs.realpath() не различает их)
   * - Требует, чтобы CWD и targetPath существовали на момент проверки
   *
   * @param {string} targetPath
   * @returns {Promise<string>} resolved real path
   * @throws {Error} если путь (после разрешения symlinks) за пределами CWD
   */
  async validatePath(targetPath) {
    const real = await fs.realpath(targetPath)
    // Нормализуем CWD: добавляем trailing slash для точной проверки
    const cwdNormalized = this.cwd.endsWith(path.sep) ? this.cwd : this.cwd + path.sep
    if (!real.startsWith(cwdNormalized) && real !== this.cwd) {
      throw new Error('Path traversal denied: path is outside CWD')
    }
    return real
  }

  setRoot(newPath) {
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
    const resolved = await this.validatePath(filePath)
    await fs.writeFile(resolved, '', { flag: 'wx' })
    return { success: true }
  }

  async createDir(dirPath) {
    const resolved = await this.validatePath(dirPath)
    await fs.mkdir(resolved, { recursive: true })
    return { success: true }
  }

  async rename(oldPath, newPath) {
    const resolvedOld = await this.validatePath(oldPath)
    const resolvedNew = await this.validatePath(newPath)
    await fs.rename(resolvedOld, resolvedNew)
    return { success: true }
  }

  async delete(targetPath) {
    const resolved = await this.validatePath(targetPath)
    await fs.rm(resolved, { recursive: true, force: true })
    return { success: true }
  }

  async copy(srcPath, destDir) {
    const resolvedSrc = await this.validatePath(srcPath)
    const resolvedDestDir = await this.validatePath(destDir)
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

    await this.validatePath(destPath)
    await fs.cp(resolvedSrc, destPath, { recursive: true })
    return { newPath: destPath }
  }

  async move(srcPaths, destDir) {
    const resolvedDestDir = await this.validatePath(destDir)
    const results = []

    for (const srcPath of srcPaths) {
      const resolvedSrc = await this.validatePath(srcPath)
      const baseName = path.basename(resolvedSrc)
      let destPath = path.join(resolvedDestDir, baseName)

      // Prevent moving a directory into itself or its children
      if (resolvedSrc === resolvedDestDir || resolvedDestDir.startsWith(resolvedSrc + path.sep)) {
        results.push({ path: srcPath, success: false, error: 'Cannot move into itself' })
        continue
      }

      // Resolve collision: filename (1).ext, filename (2).ext...
      try {
        await fs.access(destPath)
        destPath = this._resolveCollision(destPath)
      } catch {
        // dest doesn't exist, use original name
      }

      await this.validatePath(destPath)
      try {
        await fs.rename(resolvedSrc, destPath)
      } catch (err) {
        if (err.code === 'EXDEV') {
          // Cross-device move fallback: copy + delete
          await fs.cp(resolvedSrc, destPath, { recursive: true, force: true })
          await fs.rm(resolvedSrc, { recursive: true, force: true })
        } else {
          throw err
        }
      }
      results.push({ path: srcPath, success: true, newPath: destPath })
    }

    return { results }
  }

  _resolveCollision(destPath) {
    const dir = path.dirname(destPath)
    const ext = path.extname(destPath)
    const baseName = path.basename(destPath, ext)
    let counter = 1
    let newPath = destPath

    while (true) {
      const suffix = ` (${counter})`
      newPath = path.join(dir, `${baseName}${suffix}${ext}`)
      try {
        fs.accessSync(newPath)
        counter++
      } catch {
        break
      }
    }

    return newPath
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

  async statFile(filePath) {
    const resolved = path.resolve(filePath)
    const st = await fs.stat(resolved)
    return { success: true, mtimeMs: st.mtimeMs, size: st.size }
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
    if (this._watchers.has(dirPath)) {
      console.log('[FileManager] Watcher already exists for:', dirPath)
      return dirPath
    }

    // Проверка лимита watchers
    if (this._watchers.size >= MAX_WATCHERS) {
      console.warn(`[FileManager] Watcher limit reached (${MAX_WATCHERS}). Not watching: ${dirPath}`)
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
            webContents.send(IPC_CHANNELS.FS_DIR_CHANGED, { dirPath, eventType, filename })
          }
        }, 500)
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
      if (err.code === 'EMFILE') {
        console.error(`[FileManager] EMFILE: too many open files for ${dirPath}. Pruning non-root watchers...`)
        this._pruneNonRootWatchers()
        return null
      }
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
      this.unwatchDir(dirPath)
    }
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

  /**
   * Рекурсивный поиск файлов по имени и содержимому внутри директории.
   * @param {string} dirPath — абсолютный путь к корневой директории поиска
   * @param {string} query — поисковый запрос
   * @param {Object} options — настройки поиска
   * @returns {Promise<{nameMatches: Array, contentMatches: Array}>}
   */
  async searchFiles(dirPath, query, options = {}) {
    const {
      caseSensitive = false,
      wholeWord = false,
      regex = false,
      includePatterns = '',
      excludePatterns = 'node_modules,.git,dist,out,build'
    } = options

    if (!query || query.trim().length === 0) {
      return { nameMatches: [], contentMatches: [], totalCount: 0 }
    }

    const resolvedDir = path.resolve(dirPath)
    await this.validatePath(resolvedDir)

    const flags = caseSensitive ? '' : 'i'
    let pattern
    if (regex) {
      try {
        pattern = new RegExp(query, flags)
      } catch (e) {
        throw new Error('Invalid regex: ' + e.message)
      }
    } else {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (wholeWord) {
        pattern = new RegExp(`\\b${escaped}\\b`, flags)
      } else {
        pattern = new RegExp(escaped, flags)
      }
    }

    const includeList = includePatterns.split(',').map(s => s.trim()).filter(Boolean)
    const excludeList = excludePatterns.split(',').map(s => s.trim()).filter(Boolean)

    const nameMatches = []
    const contentMatches = []
    let contentMatchCount = 0
    const MAX_CONTENT_MATCHES = 500
    const MAX_FILE_SIZE = 1024 * 1024

    const binaryExts = new Set([
      '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.webp',
      '.mp3', '.mp4', '.avi', '.mov', '.wav', '.ogg',
      '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.exe', '.dll', '.so', '.dylib', '.bin',
      '.ttf', '.otf', '.woff', '.woff2', '.eot',
      '.sqlite', '.db', '.o', '.a', '.class', '.pyc',
      '.node', '.wasm'
    ])

    const isBinaryFile = (fileName) => {
      const ext = path.extname(fileName).toLowerCase()
      return binaryExts.has(ext)
    }

    const matchGlob = (str, globPattern) => {
      if (globPattern === '*') return true
      if (!globPattern.includes('*') && !globPattern.includes('?')) {
        return str === globPattern || path.basename(str) === globPattern
      }
      const regexPattern = globPattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')
      const re = new RegExp(`^${regexPattern}$`)
      return re.test(path.basename(str)) || re.test(str)
    }

    const shouldInclude = (relPath, isDir) => {
      for (const pat of excludeList) {
        if (matchGlob(relPath, pat)) return false
        if (isDir && matchGlob(path.basename(relPath), pat)) return false
      }
      if (includeList.length > 0 && !isDir) {
        let matched = false
        for (const pat of includeList) {
          if (matchGlob(relPath, pat)) { matched = true; break }
        }
        if (!matched) return false
      }
      return true
    }

    const walk = async (currentDir, relPrefix) => {
      const entries = await fs.readdir(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        const relPath = relPrefix ? path.join(relPrefix, entry.name) : entry.name
        const fullPath = path.join(currentDir, entry.name)

        if (!shouldInclude(relPath, entry.isDirectory())) continue

        if (entry.isDirectory()) {
          await walk(fullPath, relPath)
        } else {
          // Name match
          const nameToCheck = caseSensitive ? entry.name : entry.name.toLowerCase()
          const queryToCheck = caseSensitive ? query : query.toLowerCase()
          let nameHit = false
          if (!regex) {
            nameHit = nameToCheck.includes(queryToCheck)
          } else {
            nameHit = pattern.test(entry.name)
          }
          if (nameHit) {
            nameMatches.push({ path: fullPath, relPath, name: entry.name, matchType: 'name' })
          }

          // Content match
          if (contentMatchCount < MAX_CONTENT_MATCHES && !isBinaryFile(entry.name)) {
            try {
              const stat = await fs.stat(fullPath)
              if (stat.size <= MAX_FILE_SIZE && stat.size > 0) {
                const content = await fs.readFile(fullPath, 'utf-8')
                const lines = content.split('\n')
                const matchingLines = []
                for (let i = 0; i < lines.length; i++) {
                  if (pattern.test(lines[i])) {
                    matchingLines.push({ line: i + 1, text: lines[i].trim() })
                    if (matchingLines.length >= 5) break
                  }
                }
                if (matchingLines.length > 0) {
                  contentMatches.push({
                    path: fullPath,
                    relPath,
                    name: entry.name,
                    matchType: 'content',
                    lines: matchingLines
                  })
                  contentMatchCount++
                }
              }
            } catch (e) {
              // Skip unreadable files
            }
          }
        }
      }
    }

    await walk(resolvedDir, '')
    return { nameMatches, contentMatches, totalCount: nameMatches.length + contentMatches.length }
  }
}
