import { app } from 'electron'
import { join } from 'path'
import { mkdir, copyFile, readFile, writeFile, access, readdir, unlink, stat } from 'fs/promises'
import log from 'electron-log'

const GLOBAL_LIMIT = 5000
/** Вид истории по умолчанию (zsh на macOS/Linux); на Windows — `pwsh` / `bash` (см. shell-integration). */
const DEFAULT_KIND = 'zsh'
/** Суффикс файла истории: `<tabId>.zsh_history`, `<tabId>.pwsh_history`, `<tabId>.bash_history`. */
const HISTORY_SUFFIX_RE = /\.[a-z]+_history$/

export class HistoryManager {
  constructor() {
    this._baseDir = join(app.getPath('userData'), 'history')
    this._tabsDir = join(this._baseDir, 'tabs')
    this._writeLock = Promise.resolve()
  }

  async ensureHistoryDir() {
    await mkdir(this._tabsDir, { recursive: true })
  }

  getTabHistoryPath(tabId, kind = DEFAULT_KIND) {
    return join(this._tabsDir, `${tabId}.${kind}_history`)
  }

  getGlobalHistoryPath(kind = DEFAULT_KIND) {
    return join(this._baseDir, `global.${kind}_history`)
  }

  async tabHistoryExists(tabId, kind = DEFAULT_KIND) {
    try {
      await access(this.getTabHistoryPath(tabId, kind))
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
  async prepareHistoryForNewTab(tabId, kind = DEFAULT_KIND) {
    const tabPath = this.getTabHistoryPath(tabId, kind)
    const globalFile = this.getGlobalHistoryPath(kind)
    try {
      await access(globalFile)
      await copyFile(globalFile, tabPath)
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
  async prepareHistoryForRestoredTab(tabId, kind = DEFAULT_KIND) {
    const tabPath = this.getTabHistoryPath(tabId, kind)
    const globalFile = this.getGlobalHistoryPath(kind)
    const exists = await this.tabHistoryExists(tabId, kind)

    if (!exists) {
      return this.prepareHistoryForNewTab(tabId, kind)
    }

    // Дописываем новые строки из глобальной истории, которых нет в файле вкладки
    try {
      await access(globalFile)
      const tabStat = await stat(tabPath)
      const globalStat = await stat(globalFile)

      // Если глобальная история обновилась после файла вкладки — дописываем новые строки
      if (globalStat.mtimeMs > tabStat.mtimeMs) {
        const tabContent = await readFile(tabPath, 'utf-8')
        const globalContent = await readFile(globalFile, 'utf-8')
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
  async mergeTabToGlobal(tabId, initialHistSize, kind = DEFAULT_KIND) {
    this._writeLock = this._writeLock.then(() => this._doMerge(tabId, initialHistSize, kind)).catch(() => {})
    return this._writeLock
  }

  async _doMerge(tabId, initialHistSize, kind) {
    const tabPath = this.getTabHistoryPath(tabId, kind)
    const globalFile = this.getGlobalHistoryPath(kind)
    try {
      const tabBuffer = await readFile(tabPath)

      // Новый контент — байты, дописанные после начального размера файла
      const newLines = tabBuffer.subarray(initialHistSize).toString('utf-8').split('\n').filter(Boolean)
      if (newLines.length === 0) return

      let globalContent = ''
      try {
        globalContent = await readFile(globalFile, 'utf-8')
      } catch {
        // Файла нет — начинаем с пустого
      }

      const globalLines = globalContent.split('\n').filter(Boolean)
      globalLines.push(...newLines)

      // Обрезаем до лимита (убираем самые старые)
      const trimmed = globalLines.slice(-GLOBAL_LIMIT)
      await writeFile(globalFile, trimmed.join('\n') + '\n', 'utf-8')
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
      // SSH-сессии (historyFile === null) не пишут в локальный zsh-history — нечего мержить
      if (session.tabId && session.historyFile) {
        await this.mergeTabToGlobal(session.tabId, session.initialHistSize, session.historyKind)
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
        const tabId = file.replace(HISTORY_SUFFIX_RE, '')
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
