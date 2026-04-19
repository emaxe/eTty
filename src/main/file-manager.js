import fs from 'fs/promises'
import { watch } from 'fs'
import path from 'path'
import os from 'os'

export class FileManager {
  constructor() {
    this.cwd = os.homedir()
    this._watchers = new Map()
  }

  validatePath(targetPath) {
    const resolved = path.resolve(targetPath)
    if (!resolved.startsWith(this.cwd)) {
      throw new Error('Path traversal denied: path is outside CWD')
    }
    return resolved
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

  watchDir(dirPath, webContents) {
    if (this._watchers.has(dirPath)) return
    let timer
    try {
      const watcher = watch(dirPath, { persistent: false }, () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          if (!webContents.isDestroyed()) webContents.send('fs:dir-changed', { dirPath })
        }, 300)
      })
      watcher.on('error', () => this.unwatchDir(dirPath))
      this._watchers.set(dirPath, watcher)
    } catch {
      // directory inaccessible or deleted
    }
  }

  unwatchDir(dirPath) {
    const w = this._watchers.get(dirPath)
    if (w) { w.close(); this._watchers.delete(dirPath) }
  }

  unwatchAll() {
    for (const [dirPath] of this._watchers) this.unwatchDir(dirPath)
  }
}
