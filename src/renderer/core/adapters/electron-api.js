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
  fsCreateFile(path) { return this._api.fsCreateFile(path) }
  fsCreateDir(path) { return this._api.fsCreateDir(path) }
  fsRename(oldPath, newPath) { return this._api.fsRename(oldPath, newPath) }
  fsDelete(path) { return this._api.fsDelete(path) }
  fsCopy(src, dest) { return this._api.fsCopy(src, dest) }
  fsSetRoot(path) { this._api.fsSetRoot(path) }
  fsWatchDir(path, fn) { return this._on('fsDirChanged', fn) }

  // — Window —
  windowGetPosition() { return this._api.windowGetPosition() }
  windowMove(x, y) { this._api.windowMove(x, y) }
  onFullscreenChange(fn) { return this._on('fullscreenChange', fn) }

  // — Settings —
  settingsLoad() { return this._api.settingsLoad() }
  settingsSave(config) { return this._api.settingsSave(config) }

  // — Tabs —
  tabsHasSavedState() { return this._api.tabsHasSavedState() }
  tabsLoadSavedState() { return this._api.tabsLoadSavedState() }
  tabsDeleteSavedState() { return this._api.tabsDeleteSavedState() }
  tabsShowRestoreDialog(count) { return this._api.tabsShowRestoreDialog(count) }
  tabsStateChanged() { this._api.tabsStateChanged() }
  onTabsTriggerRestore(fn) { return this._on('tabsTriggerRestore', fn) }

  // — Git —
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
  onAgentsSettingsUpdated(fn) { return this._on('agentsSettingsUpdated', fn) }

  // — History —
  historyCleanup(activeTabIds) { this._api.historyCleanup(activeTabIds) }

  // — App —
  getCwd() { return this._api.getCwd() }
  getHomedir() { return this._api.getHomedir() }
  openExternal(path) { return this._api.appOpenExternal(path) }

  _on(channel, fn) {
    const unsub = this._api[`on${channel.charAt(0).toUpperCase() + channel.slice(1)}`]?.(fn)
    return unsub || (() => {})
  }
}
