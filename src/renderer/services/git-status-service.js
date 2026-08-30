import { APP_CONFIG } from '../core/config/app-config.js'

/**
 * GitStatusService — сервис polling'а git-статуса.
 * Периодически опрашивает git:get-root и git:get-status,
 * публикует результаты через EventBus, кладёт в StateStore.
 */
export class GitStatusService {
  constructor({ api, eventBus, store }) {
    this._api = api           // ElectronApiAdapter
    this._bus = eventBus      // EventBus
    this._store = store       // StateStore

    this._rootPath = null
    this._pollTimer = null
    this._isPolling = false
    this._unsubFileSaved = null  // для отписки от editor.file-saved

    this._unsubFileSaved = eventBus.on('editor.file-saved', () => {
      this._poll()
    })
  }

  /**
   * Устанавливает rootPath и запускает/останавливает polling.
   * Вызывается при переключении вкладки терминала.
   */
  async setRootPath(rootPath) {
    if (rootPath === this._rootPath) return

    this._rootPath = rootPath
    this._stopPolling()

    if (rootPath === null) {
      this._store.batch([
        { path: 'git.isRepo', value: false },
        { path: 'git.rootPath', value: null },
        { path: 'git.fileStatuses', value: {} },
        { path: 'git.branch', value: null },
        { path: 'git.totalAdditions', value: 0 },
        { path: 'git.totalDeletions', value: 0 },
        { path: 'git.ignoredTracked', value: new Set() },
        { path: 'git.ignoredPaths', value: [] },
      ])
      return
    }

    const repoRoot = await this._api.gitGetRoot(rootPath)
    if (this._rootPath !== rootPath) return // switched while awaiting

    const isRepo = Boolean(repoRoot && repoRoot.length > 0)
    if (!isRepo) {
      this._store.batch([
        { path: 'git.isRepo', value: false },
        { path: 'git.rootPath', value: null },
        { path: 'git.fileStatuses', value: {} },
        { path: 'git.branch', value: null },
        { path: 'git.totalAdditions', value: 0 },
        { path: 'git.totalDeletions', value: 0 },
        { path: 'git.ignoredTracked', value: new Set() },
        { path: 'git.ignoredPaths', value: [] },
      ])
      return
    }

    this._store.batch([
      { path: 'git.isRepo', value: true },
      { path: 'git.rootPath', value: repoRoot },
    ])

    this._startPolling()
    await this._poll()
  }

  /**
   * Немедленно один раз опрашивает git:get-status и обновляет store + EventBus.
   */
  async _poll() {
    if (!this._rootPath || !this._store.get('git.isRepo') || this._isPolling) return

    const pollPath = this._rootPath
    const repoRoot = this._store.get('git.rootPath')
    this._isPolling = true

    try {
      const result = await this._api.gitGetStatus(repoRoot || this._rootPath)

      // Guard: discard stale result if rootPath changed while awaiting
      if (this._rootPath !== pollPath) return

      if (result.error || result.notARepo) {
        this._store.batch([
          { path: 'git.isRepo', value: false },
          { path: 'git.rootPath', value: null },
          { path: 'git.fileStatuses', value: {} },
          { path: 'git.branch', value: null },
          { path: 'git.totalAdditions', value: 0 },
          { path: 'git.totalDeletions', value: 0 },
          { path: 'git.ignoredTracked', value: new Set() },
          { path: 'git.ignoredPaths', value: [] },
        ])
        return
      }

      const fileStatuses = {}
      for (const file of result.files) {
        if (file.status === '?' || file.status === 'A') {
          fileStatuses[file.path] = 'new'
        } else if (file.status === 'D') {
          fileStatuses[file.path] = 'deleted'
        } else {
          fileStatuses[file.path] = 'modified'
        }
      }

      this._store.batch([
        { path: 'git.fileStatuses', value: fileStatuses },
        { path: 'git.branch', value: result.branch || 'HEAD' },
        { path: 'git.totalAdditions', value: result.totalAdditions || 0 },
        { path: 'git.totalDeletions', value: result.totalDeletions || 0 },
        { path: 'git.ignoredTracked', value: new Set(result.ignoredTracked || []) },
        { path: 'git.ignoredPaths', value: result.ignoredPaths || [] },
      ])
      this._bus.emit('git.status-updated', { rootPath: this._rootPath, fileStatuses, ignoredPaths: result.ignoredPaths || [] })
    } finally {
      this._isPolling = false
    }
  }

  /**
   * Запускает периодический polling.
   */
  _startPolling() {
    this._stopPolling()
    this._pollTimer = setInterval(() => {
      this._poll()
    }, APP_CONFIG.GIT_STATUS_POLL_INTERVAL_MS)
  }

  /**
   * Останавливает polling.
   */
  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
  }

  /**
   * Очищает ресурсы. Вызывается при destroy приложения.
   */
  destroy() {
    this._stopPolling()
    if (this._unsubFileSaved) {
      this._unsubFileSaved()
      this._unsubFileSaved = null
    }
    this._rootPath = null
  }
}
