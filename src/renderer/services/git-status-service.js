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
    this._unsubFileSaved = null  // для отписки от editor:file-saved

    this._unsubFileSaved = eventBus.on('editor:file-saved', () => {
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
      this._store.set('git.isRepo', false)
      this._store.set('git.rootPath', null)
      this._store.set('git.fileStatuses', {})
      return
    }

    const repoRoot = await this._api.gitGetRoot(rootPath)
    const isRepo = Boolean(repoRoot && repoRoot.length > 0)

    this._store.set('git.isRepo', isRepo)
    this._store.set('git.rootPath', isRepo ? repoRoot : null)

    if (isRepo) {
      this._startPolling()
      await this._poll()
    } else {
      this._store.set('git.fileStatuses', {})
    }
  }

  /**
   * Немедленно один раз опрашивает git:get-status и обновляет store + EventBus.
   */
  async _poll() {
    if (!this._rootPath || !this._store.get('git.isRepo')) return

    const result = await this._api.gitGetStatus(this._rootPath)

    if (result.error || result.notARepo) {
      this._store.set('git.isRepo', false)
      this._store.set('git.rootPath', null)
      this._store.set('git.fileStatuses', {})
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

    this._store.set('git.fileStatuses', fileStatuses)
    this._bus.emit('git:status-updated', { rootPath: this._rootPath, fileStatuses })
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
