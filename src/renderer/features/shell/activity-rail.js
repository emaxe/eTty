import { formatHotkey, HOTKEYS } from '../../core/hotkeys.js'
import { Icons } from '../../icons.js'

/**
 * ActivityRail — вертикальная панель слева с переключателями панелей приложения.
 *
 * Разметка статична (index.html, #activity-rail); кнопки панелей (#btn-toggle-sidebar,
 * #btn-toggle-editor, #btn-toggle-ssh, #btn-settings) обслуживает index.js, как и раньше.
 * Компонент берёт на себя новые кнопки (поиск, Git), подсказки с хоткеями
 * и подсветку активной кнопки Git.
 *
 * Активная кнопка помечается линией акцента 2px у края панели (стиль в styles/shell.css).
 */
export class ActivityRail {
  /**
   * @param {Object} deps
   * @param {HTMLElement} deps.railEl
   * @param {{ emit: Function }} deps.eventBus
   * @param {{ get: Function, set: Function, subscribe: Function }} deps.store
   * @param {boolean} deps.isMac
   * @param {() => boolean} deps.isBlocked — true, когда открыт оверлей (настройки/Git) и переключения запрещены
   */
  constructor({ railEl, eventBus, store, isMac, isBlocked }) {
    this._rail = railEl
    this._bus = eventBus
    this._store = store
    this._isMac = isMac
    this._isBlocked = isBlocked
    this._cleanup = new AbortController()
    const signal = this._cleanup.signal

    this._searchBtn = railEl.querySelector('#btn-rail-search')
    this._gitBtn = railEl.querySelector('#btn-rail-git')
    this._searchBtn.innerHTML = Icons.search
    this._gitBtn.innerHTML = Icons.gitBranch

    this._applyTitles()

    this._searchBtn.addEventListener('click', () => {
      if (this._isBlocked()) return
      this._bus.emit('search.show')
    }, { signal })

    this._gitBtn.addEventListener('click', () => {
      this._store.set('ui.gitPanelVisible', !this._store.get('ui.gitPanelVisible'))
    }, { signal })

    this._unsubscribe = this._store.subscribe((state, path) => {
      if (path === 'ui.gitPanelVisible') {
        this._gitBtn.classList.toggle('active', !!state.ui.gitPanelVisible)
      }
    })
  }

  /** Подсказки: название и хоткей, например «Редактор (⌘E)». */
  _applyTitles() {
    const hint = (label, spec) => (spec ? `${label} (${formatHotkey(spec, this._isMac)})` : label)
    const set = (selector, text) => {
      const el = this._rail.querySelector(selector)
      if (!el) return
      el.title = text
      el.setAttribute('aria-label', text)
    }
    set('#btn-toggle-sidebar', hint('Файлы'))
    set('#btn-rail-search', hint('Поиск по проекту', HOTKEYS.searchProject))
    set('#btn-rail-git', hint('Git', HOTKEYS.toggleGit))
    set('#btn-toggle-editor', hint('Редактор', HOTKEYS.toggleEditor))
    set('#btn-toggle-ssh', hint('Подключения SSH'))
    set('#btn-settings', hint('Настройки', HOTKEYS.openSettings))
  }

  destroy() {
    this._cleanup.abort()
    this._unsubscribe?.()
    this._unsubscribe = null
  }
}
