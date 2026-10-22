import { fuzzyMatch } from './fuzzy.js'

/**
 * @typedef {Object} Command
 * @property {string} id            уникальный идентификатор ("view.toggle-editor")
 * @property {string} title         название в палитре ("Показать/скрыть редактор")
 * @property {string} [group]       группа ("Вид", "Вкладки", "Тема")
 * @property {{ key: string, mod?: boolean, shift?: boolean, alt?: boolean }} [hotkey]
 * @property {string[]} [keywords]  дополнительные слова для поиска
 * @property {() => boolean} [when] команда доступна, только если вернул true
 * @property {() => void|Promise<void>} run
 */

/**
 * Реестр команд приложения — источник для командной палитры и списка горячих клавиш в настройках.
 * Команды регистрируют те, кто ими владеет; реестр ничего не знает о панелях и вкладках.
 */
export class CommandRegistry {
  constructor() {
    /** @type {Map<string, Command>} */
    this._commands = new Map()
  }

  /**
   * @param {Command} command
   * @returns {() => void} отмена регистрации
   */
  register(command) {
    if (!command?.id || !command.title || typeof command.run !== 'function') {
      throw new Error('Command requires id, title and run()')
    }
    if (this._commands.has(command.id)) {
      throw new Error(`Command already registered: ${command.id}`)
    }
    this._commands.set(command.id, command)
    return () => this._commands.delete(command.id)
  }

  /** Все зарегистрированные команды, включая сейчас недоступные (для справки по горячим клавишам). */
  all() {
    return [...this._commands.values()]
  }

  /** Доступные сейчас команды в порядке регистрации. */
  list() {
    return [...this._commands.values()].filter(c => !c.when || c.when())
  }

  /**
   * Доступные команды, подходящие под запрос, лучшие первыми. Пустой запрос — весь список.
   * @param {string} query
   * @returns {Array<{ command: Command, indices: number[] }>} indices — совпавшие позиции в title
   */
  search(query) {
    const commands = this.list()
    if (!query.trim()) return commands.map(command => ({ command, indices: [] }))

    const found = []
    for (const command of commands) {
      const inTitle = fuzzyMatch(query, command.title)
      if (inTitle) {
        found.push({ command, indices: inTitle.indices, score: inTitle.score + 20 })
        continue
      }
      // Группа и ключевые слова находят команду, но подсветки в названии нет
      const extra = [command.group, ...(command.keywords || [])].filter(Boolean).join(' ')
      const inExtra = extra && fuzzyMatch(query, extra)
      if (inExtra) found.push({ command, indices: [], score: inExtra.score })
    }
    return found.sort((a, b) => b.score - a.score).map(({ command, indices }) => ({ command, indices }))
  }

  /** @param {string} id */
  async run(id) {
    const command = this._commands.get(id)
    if (!command || (command.when && !command.when())) return false
    await command.run()
    return true
  }
}
