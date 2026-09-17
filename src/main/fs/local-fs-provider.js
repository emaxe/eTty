/**
 * Тонкая обёртка над существующим `FileManager` под общий контракт `FsProvider`
 * (см. `fs-provider.js`). Сам `FileManager` не меняется — здесь только делегирование,
 * чтобы `fs-handlers.js` мог работать с локальным и SSH-провайдером единообразно.
 */
export class LocalFsProvider {
  /** @param {import('../file-manager.js').FileManager} fileManager */
  constructor(fileManager) {
    this._fm = fileManager
  }

  readDir(dirPath) { return this._fm.readDir(dirPath) }
  createFile(filePath) { return this._fm.createFile(filePath) }
  createDir(dirPath) { return this._fm.createDir(dirPath) }
  rename(oldPath, newPath) { return this._fm.rename(oldPath, newPath) }
  delete(targetPath) { return this._fm.delete(targetPath) }
  deleteMany(targetPaths) { return this._fm.deleteMany(targetPaths) }
  copy(srcPath, destDir) { return this._fm.copy(srcPath, destDir) }
  copyMany(srcPaths, destDir) { return this._fm.copyMany(srcPaths, destDir) }
  move(srcPaths, destDir) { return this._fm.move(srcPaths, destDir) }
  readFile(filePath, maxSize) { return this._fm.readFile(filePath, maxSize) }
  writeFile(filePath, content) { return this._fm.writeFile(filePath, content) }
  statFile(filePath) { return this._fm.statFile(filePath) }
  getCwd() { return this._fm.getCwd() }
  setRoot(newPath) { return this._fm.setRoot(newPath) }
  watchDir(dirPath, webContents, isRoot) { return this._fm.watchDir(dirPath, webContents, isRoot) }
  unwatchDir(dirPath) { return this._fm.unwatchDir(dirPath) }
  unwatchAll() { return this._fm.unwatchAll() }
}
