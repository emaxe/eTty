import { app } from 'electron'
import { join } from 'path'
import { mkdir, copyFile, readFile, writeFile, access, readdir, unlink, stat } from 'fs/promises'
import log from 'electron-log'

const GLOBAL_LIMIT = 5000

export class HistoryManager {
  constructor() {
    this._baseDir = join(app.getPath('userData'), 'history')
    this._tabsDir = join(this._baseDir, 'tabs')
    this._globalFile = join(this._baseDir, 'global.zsh_history')
    this._writeLock = Promise.resolve()
  }

  async ensureHistoryDir() {
    await mkdir(this._tabsDir, { recursive: true })
  }

  getTabHistoryPath(tabId) {
    return join(this._tabsDir, `${tabId}.zsh_history`)
  }

  getGlobalHistoryPath() {
    return this._globalFile
  }

  async tabHistoryExists(tabId) {
    try {
      await access(this.getTabHistoryPath(tabId))
      return true
    } catch {
      return false
    }
  }

  async getFileSize(filePath) {
    try {
      const s = await stat(filePath)
      return s.size
    } catch {
      return 0
    }
  }

  /**
   * Новая вкладка: копируем глобальную историю как стартовый HISTFILE
   */
  async prepareHistoryForNewTab(tabId) {
    const tabPath = this.getTabHistoryPath(tabId)
    try {
      await access(this._globalFile)
      await copyFile(this._globalFile, tabPath)
      log.info(`history: prepared new tab ${tabId} from global`)
    } catch {
      // Глобальной истории нет — создаём пустой файл, чтобы zsh не использовал ~/.zsh_history
      await writeFile(tabPath, '', 'utf-8')
      log.info(`history: prepared new tab ${tabId} (empty)`)
    }
  }

  /**
   * Восстановленная вкладка: если файл есть — дописываем новые строки из глобальной.
   * Если файла нет — fallback на prepareHistoryForNewTab.
   */
  async prepareHistoryForRestoredTab(tabId) {
    const tabPath = this.getTabHistoryPath(tabId)
    const exists = await this.tabHistoryExists(tabId)

    if (!exists) {
      return this.prepareHistoryForNewTab(tabId)
    }

    // Дописываем новые строки из глобальной истории, которых нет в файле вкладки
    try {
      await access(this._globalFile)
      const tabStat = await stat(tabPath)
      const globalStat = await stat(this._globalFile)

      // Если глобальная история обновилась после файла вкладки — дописываем новые строки
      if (globalStat.mtimeMs > tabStat.mtimeMs) {
        const tabContent = await readFile(tabPath, 'utf-8')
        const globalContent = await readFile(this._globalFile, 'utf-8')
        const tabLines = new Set(tabContent.split('\n').filter(Boolean))
        const globalLines = globalContent.split('\n').filter(Boolean)

        const newLines = globalLines.filter(line => !tabLines.has(line))
        if (newLines.length > 0) {
          await writeFile(tabPath, tabContent.trimEnd() + '\n' + newLines.join('\n') + '\n', 'utf-8')
          log.info(`history: appended ${newLines.length} global lines to restored tab ${tabId}`)
        }
      }
    } catch {
      // Глобальной нет — ничего не делаем, файл вкладки уже существует
    }

    log.info(`history: restored tab ${tabId}`)
  }

  /**
   * Мержит новые команды из вкладки в глобальную историю.
   * initialHistSize — размер HISTFILE в байтах на момент создания вкладки.
   * Использует мьютекс для предотвращения гонок при записи в глобальный файл.
   */
  async mergeTabToGlobal(tabId, initialHistSize) {
    this._writeLock = this._writeLock.then(() => this._doMerge(tabId, initialHistSize)).catch(() => {})
    return this._writeLock
  }

  async _doMerge(tabId, initialHistSize) {
    const tabPath = this.getTabHistoryPath(tabId)
    try {
      const tabBuffer = await readFile(tabPath)

      // Новый контент — байты, дописанные после начального размера файла
      const newLines = tabBuffer.subarray(initialHistSize).toString('utf-8').split('\n').filter(Boolean)
      if (newLines.length === 0) return

      let globalContent = ''
      try {
        globalContent = await readFile(this._globalFile, 'utf-8')
      } catch {
        // Файла нет — начинаем с пустого
      }

      const globalLines = globalContent.split('\n').filter(Boolean)
      globalLines.push(...newLines)

      // Обрезаем до лимита (убираем самые старые)
      const trimmed = globalLines.slice(-GLOBAL_LIMIT)
      await writeFile(this._globalFile, trimmed.join('\n') + '\n', 'utf-8')
      log.info(`history: merged ${newLines.length} lines from tab ${tabId} to global (total: ${trimmed.length})`)
    } catch (e) {
      log.error(`history: failed to merge tab ${tabId}`, e.message)
    }
  }

  /**
   * Мержит все активные вкладки в глобальную (при закрытии приложения)
   */
  async mergeAllTabsToGlobal(ptyManager) {
    for (const [, session] of ptyManager.sessions) {
      if (session.tabId) {
        await this.mergeTabToGlobal(session.tabId, session.initialHistSize)
      }
    }
  }

  /**
   * Удаляет файлы истории вкладок, которых нет в activeTabIds
   */
  async cleanupOrphanedHistories(activeTabIds) {
    try {
      const files = await readdir(this._tabsDir)
      const activeSet = new Set(activeTabIds)
      let removed = 0

      for (const file of files) {
        const tabId = file.replace('.zsh_history', '')
        if (!activeSet.has(tabId)) {
          await unlink(join(this._tabsDir, file))
          removed++
        }
      }

      if (removed > 0) {
        log.info(`history: cleaned up ${removed} orphaned history files`)
      }
    } catch (e) {
      log.error('history: cleanup failed', e.message)
    }
  }
}
