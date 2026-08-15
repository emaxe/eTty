import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels.js'

/**
 * Preload-скрипт: мост между renderer и main процессом через contextBridge.
 * Все IPC-вызовы проксируются через window.electronAPI — renderer не имеет
 * прямого доступа к Node.js или Electron API (contextIsolation: true).
 *
 * invoke() — для request/response (handle в main)
 * send()   — для fire-and-forget (on в main)
 * on()     — для событий из main → renderer
 */

/** Helper: подписаться на IPC-событие и вернуть функцию отписки. */
function onIPC(channel, handler) {
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('electronAPI', {
  ptyCreate: (options) => ipcRenderer.invoke(IPC_CHANNELS.PTY_CREATE, options),
  ptyWrite: (pid, data) => ipcRenderer.send(IPC_CHANNELS.PTY_WRITE, { pid, data }),
  ptyResize: (pid, cols, rows) => ipcRenderer.send(IPC_CHANNELS.PTY_RESIZE, { pid, cols, rows }),
  ptyKill: (pid) => ipcRenderer.invoke(IPC_CHANNELS.PTY_KILL, pid),
  onPtyData: (cb) => onIPC(IPC_CHANNELS.PTY_DATA, (_, { pid, data }) => cb(pid, data)),
  onPtyExit: (cb) => onIPC(IPC_CHANNELS.PTY_EXIT, (_, info) => cb(info)),
  getHomedir: () => ipcRenderer.invoke(IPC_CHANNELS.APP_HOMEDIR),
  fsReadDir: (dirPath) => ipcRenderer.invoke(IPC_CHANNELS.FS_READ_DIR, { dirPath }),
  fsCreateFile: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.FS_CREATE_FILE, { filePath }),
  fsCreateDir: (dirPath) => ipcRenderer.invoke(IPC_CHANNELS.FS_CREATE_DIR, { dirPath }),
  fsRename: (oldPath, newPath) => ipcRenderer.invoke(IPC_CHANNELS.FS_RENAME, { oldPath, newPath }),
  fsDelete: (targetPath) => ipcRenderer.invoke(IPC_CHANNELS.FS_DELETE, { targetPath }),
  fsCopy: (srcPath, destDir) => ipcRenderer.invoke(IPC_CHANNELS.FS_COPY, { srcPath, destDir }),
  fsCopyMany: (srcPaths, destDir) => ipcRenderer.invoke(IPC_CHANNELS.FS_COPY_MANY, { srcPaths, destDir }),
  fsMove: (srcPaths, destDir) => ipcRenderer.invoke(IPC_CHANNELS.FS_MOVE, { srcPaths, destDir }),
  fsDeleteMany: (targetPaths) => ipcRenderer.invoke(IPC_CHANNELS.FS_DELETE_MANY, { targetPaths }),
  fsReadFile: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.FS_READ_FILE, { filePath }),
  fsWriteFile: (filePath, content) => ipcRenderer.invoke(IPC_CHANNELS.FS_WRITE_FILE, { filePath, content }),
  fsStatFile: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.FS_STAT_FILE, { filePath }),
  getCwd: () => ipcRenderer.invoke(IPC_CHANNELS.FS_GET_CWD),
  fsSetRoot: (dirPath) => ipcRenderer.invoke(IPC_CHANNELS.FS_SET_ROOT, { dirPath }),
  fsWatchDir: (dirPath) => ipcRenderer.invoke(IPC_CHANNELS.FS_WATCH_DIR, { dirPath }),
  fsUnwatchDir: (dirPath) => ipcRenderer.invoke(IPC_CHANNELS.FS_UNWATCH_DIR, { dirPath }),
  onFsDirChanged: (cb) => onIPC(IPC_CHANNELS.FS_DIR_CHANGED, (_, data) => cb(data)),
  windowGetPosition: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_GET_POSITION),
  windowMove: (x, y) => ipcRenderer.send(IPC_CHANNELS.WINDOW_MOVE, { x, y }),
  onFullscreenChange: (cb) => onIPC(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGE, (_, isFullscreen) => cb(isFullscreen)),
  tabsHasSavedState: () => ipcRenderer.invoke(IPC_CHANNELS.TABS_HAS_SAVED_STATE),
  tabsLoadSavedState: () => ipcRenderer.invoke(IPC_CHANNELS.TABS_LOAD_SAVED_STATE),
  tabsDeleteSavedState: () => ipcRenderer.invoke(IPC_CHANNELS.TABS_DELETE_SAVED_STATE),
  tabsShowRestoreDialog: (tabCount) => ipcRenderer.invoke(IPC_CHANNELS.TABS_SHOW_RESTORE_DIALOG, tabCount),
  historyCleanup: (activeTabIds) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_CLEANUP, activeTabIds),
  tabsStateChanged: () => ipcRenderer.send(IPC_CHANNELS.TABS_STATE_CHANGED),
  tabsAutoSave: (tabs) => ipcRenderer.send(IPC_CHANNELS.TABS_AUTO_SAVE, tabs),
  onTabsTriggerRestore: (cb) => onIPC(IPC_CHANNELS.TABS_TRIGGER_RESTORE, () => cb()),
  settingsLoad: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_LOAD),
  settingsSave: (settings) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SAVE, settings),
  agentsGetStatus: () => ipcRenderer.invoke(IPC_CHANNELS.AGENTS_GET_STATUS),
  agentsRefresh: (customAgents) => ipcRenderer.invoke(IPC_CHANNELS.AGENTS_REFRESH, customAgents),
  onAgentsSettingsUpdated: (cb) => onIPC(IPC_CHANNELS.AGENTS_SETTINGS_UPDATED, (_, data) => cb(data)),
  gitGetRoot: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_ROOT, rootPath),
  gitGetStatus: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_STATUS, rootPath),
  gitGetDiff: (rootPath, filePath, opts) => ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_DIFF, rootPath, filePath, opts),
  gitGetBranches: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_BRANCHES, rootPath),
  gitCheckout: (rootPath, branch) => ipcRenderer.invoke(IPC_CHANNELS.GIT_CHECKOUT, rootPath, branch),
  gitCreateBranch: (rootPath, name) => ipcRenderer.invoke(IPC_CHANNELS.GIT_CREATE_BRANCH, rootPath, name),
  gitDeleteBranch: (rootPath, name) => ipcRenderer.invoke(IPC_CHANNELS.GIT_DELETE_BRANCH, rootPath, name),
  gitCommit: (rootPath, message, opts) => ipcRenderer.invoke(IPC_CHANNELS.GIT_COMMIT, rootPath, message, opts),
  gitPush: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.GIT_PUSH, rootPath),
  gitDiscard: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.GIT_DISCARD, rootPath),
  gitStage: (rootPath, paths) => ipcRenderer.invoke(IPC_CHANNELS.GIT_STAGE, rootPath, paths),
  gitUnstage: (rootPath, paths) => ipcRenderer.invoke(IPC_CHANNELS.GIT_UNSTAGE, rootPath, paths),
  gitDiscardFile: (rootPath, paths, opts) => ipcRenderer.invoke(IPC_CHANNELS.GIT_DISCARD_FILE, rootPath, paths, opts),
  nodeVersion: process.versions.node,
  platform: process.platform,
  nodeVersionGetCurrent: (cwd) => ipcRenderer.invoke(IPC_CHANNELS.NODE_VERSION_GET_CURRENT, { cwd }),
  nodeVersionDetectManager: () => ipcRenderer.invoke(IPC_CHANNELS.NODE_VERSION_DETECT_MANAGER),
  nodeVersionListInstalled: () => ipcRenderer.invoke(IPC_CHANNELS.NODE_VERSION_LIST_INSTALLED),
  nodeVersionListRemote: () => ipcRenderer.invoke(IPC_CHANNELS.NODE_VERSION_LIST_REMOTE),
  nodeVersionInstall: (version) => ipcRenderer.invoke(IPC_CHANNELS.NODE_VERSION_INSTALL, { version }),
  nodeVersionUse: (version, cwd) => ipcRenderer.invoke(IPC_CHANNELS.NODE_VERSION_USE, { version, cwd }),
  nodeVersionUninstall: (version) => ipcRenderer.invoke(IPC_CHANNELS.NODE_VERSION_UNINSTALL, { version }),
  nodeVersionInstallManager: () => ipcRenderer.invoke(IPC_CHANNELS.NODE_VERSION_INSTALL_MANAGER),
  appOpenExternal: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.APP_OPEN_EXTERNAL, filePath),
  searchQuery: (dirPath, query, options) => ipcRenderer.invoke(IPC_CHANNELS.SEARCH_QUERY, { dirPath, query, options }),
  windowMinimize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE),
  windowMaximize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE),
  windowClose: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE),
  windowIsMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),
  onMaximizedChange: (cb) => onIPC(IPC_CHANNELS.WINDOW_MAXIMIZED_CHANGE, (_, isMaximized) => cb(isMaximized)),
})
