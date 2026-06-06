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

  // — FS —
  fsReadDir(path) { return this._api.fsReadDir(path) }
  fsReadFile(path) { return this._api.fsReadFile(path) }
  fsWriteFile(path, content) { return this._api.fsWriteFile(path, content) }
  fsStatFile(path) { return this._api.fsStatFile(path) }
  fsCreateFile(path) { return this._api.fsCreateFile(path) }
  fsCreateDir(path) { return this._api.fsCreateDir(path) }
  fsRename(oldPath, newPath) { return this._api.fsRename(oldPath, newPath) }
  fsDelete(path) { return this._api.fsDelete(path) }
  fsDeleteMany(paths) { return this._api.fsDeleteMany(paths) }
  fsCopy(src, dest) { return this._api.fsCopy(src, dest) }
  fsCopyMany(srcPaths, destDir) { return this._api.fsCopyMany(srcPaths, destDir) }
  fsSetRoot(path) { this._api.fsSetRoot(path) }
  fsWatchDir(path) { return this._api.fsWatchDir(path) }
  fsUnwatchDir(path) { return this._api.fsUnwatchDir(path) }
  fsMove(srcPaths, destDir) { return this._api.fsMove(srcPaths, destDir) }
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
  gitGetRoot(cwd) { return this._api.gitGetRoot(cwd) }
  gitGetStatus(cwd) { return this._api.gitGetStatus(cwd) }
  gitGetDiff(cwd, filePath) { return this._api.gitGetDiff(cwd, filePath) }
  gitGetBranches(cwd) { return this._api.gitGetBranches(cwd) }
  gitCheckout(cwd, branch) { return this._api.gitCheckout(cwd, branch) }
  gitCreateBranch(cwd, name) { return this._api.gitCreateBranch(cwd, name) }
  gitDeleteBranch(cwd, name) { return this._api.gitDeleteBranch(cwd, name) }
  gitCommit(cwd, message) { return this._api.gitCommit(cwd, message) }
  gitPush(cwd) { return this._api.gitPush(cwd) }
  gitDiscard(cwd, filePath) { return this._api.gitDiscard(cwd, filePath) }

  // — Agents —
  agentsGetStatus() { return this._api.agentsGetStatus() }
  agentsRefresh(customAgents) { return this._api.agentsRefresh(customAgents) }
  onAgentsSettingsUpdated(fn) { return this._on('agentsSettingsUpdated', fn) }

  // — History —
  historyCleanup(activeTabIds) { this._api.historyCleanup(activeTabIds) }

  // — App —
  getCwd() { return this._api.getCwd() }
  getHomedir() { return this._api.getHomedir() }
  get nodeVersion() { return this._api.nodeVersion }
  get platform() { return this._api.platform }
  openExternal(path) { return this._api.appOpenExternal(path) }

  // — Node Version Manager —
  nodeVersionGetCurrent(cwd) { return this._api.nodeVersionGetCurrent(cwd) }
  nodeVersionDetectManager() { return this._api.nodeVersionDetectManager() }
  nodeVersionListInstalled() { return this._api.nodeVersionListInstalled() }
  nodeVersionListRemote() { return this._api.nodeVersionListRemote() }
  nodeVersionInstall(version) { return this._api.nodeVersionInstall(version) }
  nodeVersionUse(version, cwd) { return this._api.nodeVersionUse(version, cwd) }
  nodeVersionUninstall(version) { return this._api.nodeVersionUninstall(version) }
  nodeVersionInstallManager() { return this._api.nodeVersionInstallManager() }

  // — Search —
  searchQuery(dirPath, query, options) { return this._api.searchQuery(dirPath, query, options) }

  _on(channel, fn) {
    const unsub = this._api[`on${channel.charAt(0).toUpperCase() + channel.slice(1)}`]?.(fn)
    return unsub || (() => {})
  }
}
