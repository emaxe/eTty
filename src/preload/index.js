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
  fsMove: (srcPaths, destDir) => ipcRenderer.invoke(IPC_CHANNELS.FS_MOVE, { srcPaths, destDir }),
  fsReadFile: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.FS_READ_FILE, { filePath }),
  fsWriteFile: (filePath, content) => ipcRenderer.invoke(IPC_CHANNELS.FS_WRITE_FILE, { filePath, content }),
  fsStatFile: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.FS_STAT_FILE, { filePath }),
  getCwd: () => ipcRenderer.invoke(IPC_CHANNELS.FS_GET_CWD),
  fsSetRoot: (dirPath) => ipcRenderer.invoke(IPC_CHANNELS.FS_SET_ROOT, { dirPath }),
  fsWatchDir: async (dirPath) => {
    console.log('[Preload] fsWatchDir called:', dirPath)
    const result = await ipcRenderer.invoke(IPC_CHANNELS.FS_WATCH_DIR, { dirPath })
    console.log('[Preload] fsWatchDir result:', dirPath, result)
    return result
  },
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
  onTabsTriggerRestore: (cb) => onIPC(IPC_CHANNELS.TABS_TRIGGER_RESTORE, () => cb()),
  settingsLoad: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_LOAD),
  settingsSave: (settings) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SAVE, settings),
  agentsGetStatus: () => ipcRenderer.invoke(IPC_CHANNELS.AGENTS_GET_STATUS),
  agentsRefresh: () => ipcRenderer.invoke(IPC_CHANNELS.AGENTS_REFRESH),
  onAgentsSettingsUpdated: (cb) => onIPC(IPC_CHANNELS.AGENTS_SETTINGS_UPDATED, (_, data) => cb(data)),
  gitGetRoot: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_ROOT, rootPath),
  gitGetStatus: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_STATUS, rootPath),
  gitGetDiff: (rootPath, filePath) => ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_DIFF, rootPath, filePath),
  gitGetBranches: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_BRANCHES, rootPath),
  gitCheckout: (rootPath, branch) => ipcRenderer.invoke(IPC_CHANNELS.GIT_CHECKOUT, rootPath, branch),
  gitCreateBranch: (rootPath, name) => ipcRenderer.invoke(IPC_CHANNELS.GIT_CREATE_BRANCH, rootPath, name),
  gitDeleteBranch: (rootPath, name) => ipcRenderer.invoke(IPC_CHANNELS.GIT_DELETE_BRANCH, rootPath, name),
  gitCommit: (rootPath, message) => ipcRenderer.invoke(IPC_CHANNELS.GIT_COMMIT, rootPath, message),
  gitPush: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.GIT_PUSH, rootPath),
  gitDiscard: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.GIT_DISCARD, rootPath),
  nodeVersion: process.versions.node,
  appOpenExternal: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.APP_OPEN_EXTERNAL, filePath),
  searchQuery: (dirPath, query, options) => ipcRenderer.invoke(IPC_CHANNELS.SEARCH_QUERY, { dirPath, query, options }),
})
