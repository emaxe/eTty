/**
 * @fileoverview Контракт провайдера файловой системы — общий для `LocalFsProvider`
 * (обёртка над существующим `FileManager`) и `SshFsProvider` (удалённая ФС по SSH, Этап 4+).
 * Чисто JSDoc — используется как `@param {import('./fs-provider.js').FsProvider}` в местах,
 * которые работают с произвольным провайдером (см. `fs-provider-registry.js`, `fs-handlers.js`).
 *
 * Формы ответов — 1:1 с уже существующими методами `FileManager` (`src/main/file-manager.js`),
 * чтобы `fs-handlers.js` не пришлось менять контракт на renderer-стороне.
 *
 * @typedef {Object} FsEntry
 * @property {string} name
 * @property {string} path
 * @property {boolean} isDirectory
 *
 * @typedef {Object} FsProvider
 * @property {(dirPath: string) => Promise<FsEntry[] | {success: false, error: string}>} readDir
 * @property {(filePath: string) => Promise<{success: true} | {success: false, error: string}>} createFile
 * @property {(dirPath: string) => Promise<{success: true} | {success: false, error: string}>} createDir
 * @property {(oldPath: string, newPath: string) => Promise<{success: true} | {success: false, error: string}>} rename
 * @property {(targetPath: string) => Promise<{success: true} | {success: false, error: string}>} delete
 * @property {(targetPaths: string[]) => Promise<{success: true} | {success: false, error: string}>} deleteMany
 * @property {(srcPath: string, destDir: string) => Promise<{newPath: string} | {success: false, error: string}>} copy
 * @property {(srcPaths: string[], destDir: string) => Promise<{results: Array<{path: string, newPath?: string, success?: boolean, error?: string}>}>} copyMany
 * @property {(srcPaths: string[], destDir: string) => Promise<{results: Array<{path: string, success: boolean, newPath?: string, error?: string}>}>} move
 * @property {(filePath: string, maxSize?: number) => Promise<{success: true, content: string, size: number} | {success: false, error: string, size?: number}>} readFile
 * @property {(filePath: string, content: string) => Promise<{success: true} | {success: false, error: string}>} writeFile
 * @property {(filePath: string) => Promise<{success: true, mtimeMs: number, size: number} | {success: false, error: string}>} statFile
 * @property {() => {cwd: string|null}} getCwd
 * @property {(newPath: string) => void} setRoot
 * @property {(dirPath: string, webContents: Electron.WebContents, isRoot?: boolean) => string|null} watchDir
 * @property {(dirPath: string) => void} unwatchDir
 * @property {() => void} unwatchAll
 */

export {}
