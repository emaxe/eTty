import fs from 'fs/promises'
import path from 'path'

export class FileManager {
  constructor() {
    this.cwd = process.cwd()
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

  getCwd() {
    return { cwd: this.cwd }
  }
}
