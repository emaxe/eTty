/**
 * Adapter — единая точка доступа к Electron preload API.
 * Инжектируется в компоненты через DI-контейнер.
 *
 * @example
 * const api = container.resolve('api')
 * await api.fsReadFile('/path')
 */
export class ElectronApiAdapter {
  constructor() {
    if (!window.electronAPI) {
      throw new Error('ElectronApiAdapter: window.electronAPI not available')
    }
    this._api = window.electronAPI
  }

  // — PTY —
  ptyCreate(opts) { return this._api.ptyCreate(opts) }
  ptyWrite(pid, data) { this._api.ptyWrite(pid, data) }
  ptyResize(pid, cols, rows) { this._api.ptyResize(pid, cols, rows) }
  ptyKill(pid) { this._api.ptyKill(pid) }
  onPtyData(fn) { return this._on('ptyData', fn) }
  onPtyExit(fn) { return this._on('ptyExit', fn) }

  // — FS — ctx: {kind:'local'} | {kind:'ssh', sessionId} | undefined (см. scoped-fs-api.js,
  // который подставляет его автоматически для fileTree/editorPanel/projectSearch).
  fsReadDir(path, ctx) { return this._api.fsReadDir(path, ctx) }
  fsReadFile(path, ctx) { return this._api.fsReadFile(path, ctx) }
  fsWriteFile(path, content, ctx) { return this._api.fsWriteFile(path, content, ctx) }
  fsStatFile(path, ctx) { return this._api.fsStatFile(path, ctx) }
  fsCreateFile(path, ctx) { return this._api.fsCreateFile(path, ctx) }
  fsCreateDir(path, ctx) { return this._api.fsCreateDir(path, ctx) }
  fsRename(oldPath, newPath, ctx) { return this._api.fsRename(oldPath, newPath, ctx) }
  fsDelete(path, ctx) { return this._api.fsDelete(path, ctx) }
  fsDeleteMany(paths, ctx) { return this._api.fsDeleteMany(paths, ctx) }
  fsCopy(src, dest, ctx) { return this._api.fsCopy(src, dest, ctx) }
  fsCopyMany(srcPaths, destDir, ctx) { return this._api.fsCopyMany(srcPaths, destDir, ctx) }
  fsSetRoot(path, ctx) { this._api.fsSetRoot(path, ctx) }
  fsWatchDir(path, ctx) { return this._api.fsWatchDir(path, ctx) }
  fsUnwatchDir(path, ctx) { return this._api.fsUnwatchDir(path, ctx) }
  fsMove(srcPaths, destDir, ctx) { return this._api.fsMove(srcPaths, destDir, ctx) }
  onFsDirChanged(fn) { return this._on('fsDirChanged', fn) }

  // — Window —
  windowGetPosition() { return this._api.windowGetPosition() }
  windowMove(x, y) { this._api.windowMove(x, y) }
  windowMinimize() { this._api.windowMinimize() }
  windowMaximize() { this._api.windowMaximize() }
  windowClose() { this._api.windowClose() }
  windowIsMaximized() { return this._api.windowIsMaximized() }
  onFullscreenChange(fn) { return this._on('fullscreenChange', fn) }
  onMaximizedChange(fn) { return this._on('maximizedChange', fn) }

  // — Settings —
  settingsLoad() { return this._api.settingsLoad() }
  settingsSave(config) { return this._api.settingsSave(config) }

  // — Tabs —
  tabsHasSavedState() { return this._api.tabsHasSavedState() }
  tabsLoadSavedState() { return this._api.tabsLoadSavedState() }
  tabsDeleteSavedState() { return this._api.tabsDeleteSavedState() }
  tabsShowRestoreDialog(count) { return this._api.tabsShowRestoreDialog(count) }
  tabsStateChanged() { this._api.tabsStateChanged() }
  tabsAutoSave(tabs) { this._api.tabsAutoSave(tabs) }
  onTabsTriggerRestore(fn) { return this._on('tabsTriggerRestore', fn) }

  // — Git —
  gitGetRoot(cwd, ctx) { return this._api.gitGetRoot(cwd, ctx) }
  gitGetStatus(cwd, ctx) { return this._api.gitGetStatus(cwd, ctx) }
  gitGetDiff(cwd, filePath, opts, ctx) { return this._api.gitGetDiff(cwd, filePath, opts, ctx) }
  gitGetBranches(cwd, ctx) { return this._api.gitGetBranches(cwd, ctx) }
  gitCheckout(cwd, branch, ctx) { return this._api.gitCheckout(cwd, branch, ctx) }
  gitCreateBranch(cwd, name, ctx) { return this._api.gitCreateBranch(cwd, name, ctx) }
  gitDeleteBranch(cwd, name, ctx) { return this._api.gitDeleteBranch(cwd, name, ctx) }
  gitCommit(cwd, message, opts, ctx) { return this._api.gitCommit(cwd, message, opts, ctx) }
  gitPush(cwd, ctx) { return this._api.gitPush(cwd, ctx) }
  gitDiscard(cwd, ctx) { return this._api.gitDiscard(cwd, ctx) }
  gitStage(cwd, paths, ctx) { return this._api.gitStage(cwd, paths, ctx) }
  gitUnstage(cwd, paths, ctx) { return this._api.gitUnstage(cwd, paths, ctx) }
  gitDiscardFile(cwd, paths, opts, ctx) { return this._api.gitDiscardFile(cwd, paths, opts, ctx) }

  // — Clipboard —
  clipboardUploadImage(ctx) { return this._api.clipboardUploadImage(ctx) }

  // — Agents —
  agentsGetStatus() { return this._api.agentsGetStatus() }
  agentsRefresh(customAgents) { return this._api.agentsRefresh(customAgents) }
  onAgentsSettingsUpdated(fn) { return this._on('agentsSettingsUpdated', fn) }

  // — History —
  historyCleanup(activeTabIds) { this._api.historyCleanup(activeTabIds) }

  // — App —
  getCwd(ctx) { return this._api.getCwd(ctx) }
  getHomedir() { return this._api.getHomedir() }
  get nodeVersion() { return this._api.nodeVersion }
  get platform() { return this._api.platform }
  get pathSep() { return this._api.pathSep }
  openExternal(path) { return this._api.appOpenExternal(path) }

  // — Node Version Manager —
  nodeVersionResolve(nodePath, ctx) { return this._api.nodeVersionResolve(nodePath, ctx) }
  nodeVersionDetectManager(ctx) { return this._api.nodeVersionDetectManager(ctx) }
  nodeVersionListInstalled(ctx) { return this._api.nodeVersionListInstalled(ctx) }
  nodeVersionListRemote(ctx) { return this._api.nodeVersionListRemote(ctx) }
  nodeVersionInstall(version, ctx) { return this._api.nodeVersionInstall(version, ctx) }
  nodeVersionUninstall(version, ctx) { return this._api.nodeVersionUninstall(version, ctx) }
  nodeVersionInstallManager(ctx) { return this._api.nodeVersionInstallManager(ctx) }

  // — Search —
  searchQuery(dirPath, query, options) { return this._api.searchQuery(dirPath, query, options) }

  // — SSH —
  sshList() { return this._api.sshList() }
  sshSave(connection) { return this._api.sshSave(connection) }
  sshDelete(id) { return this._api.sshDelete(id) }
  sshReorder(ids) { return this._api.sshReorder(ids) }
  sshExportConnections(opts) { return this._api.sshExportConnections(opts) }
  sshImportPickFile() { return this._api.sshImportPickFile() }
  sshImportConnections(opts) { return this._api.sshImportConnections(opts) }
  onSshFsReady(fn) { return this._on('sshFsReady', fn) }
  sshFsRetry(sessionId) { return this._api.sshFsRetry(sessionId) }
  sshSessionResync(pid) { return this._api.sshSessionResync(pid) }
  onSshSessionState(fn) { return this._on('sshSessionState', fn) }
  onSshTmuxMissing(fn) { return this._on('sshTmuxMissing', fn) }
  sshMasterAcquire(connectionId) { return this._api.sshMasterAcquire(connectionId) }
  sshMasterRelease(connectionId) { return this._api.sshMasterRelease(connectionId) }
  sshSessionsList(connectionId, force) { return this._api.sshSessionsList(connectionId, force) }
  sshSessionKill(connectionId, name) { return this._api.sshSessionKill(connectionId, name) }
  sshSessionRename(connectionId, name, newName) { return this._api.sshSessionRename(connectionId, name, newName) }

  _on(channel, fn) {
    const unsub = this._api[`on${channel.charAt(0).toUpperCase() + channel.slice(1)}`]?.(fn)
    return unsub || (() => {})
  }
}
