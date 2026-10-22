import { registerModal } from '../../components/base/modal/modal.js'
import { formatHotkey } from '../../core/hotkeys.js'

/**
 * CommandPalette — поиск и запуск команд приложения с клавиатуры.
 *
 * Открывается хоткеем; ↑/↓ — выбор, Enter — выполнить, Esc — закрыть. Список строится из
 * CommandRegistry при каждом открытии: команды с `when() === false` не показываются.
 */
export class CommandPalette {
  /**
   * @param {Object} deps
   * @param {import('../../core/command-registry.js').CommandRegistry} deps.registry
   * @param {boolean} deps.isMac
   */
  constructor({ registry, isMac }) {
    this._registry = registry
    this._isMac = isMac
    this._results = []
    this._selected = 0
    this._release = null
    this._isOpen = false
    this._buildDOM()
  }

  _buildDOM() {
    const overlay = document.createElement('div')
    overlay.className = 'palette-overlay hidden'

    const dialog = document.createElement('div')
    dialog.className = 'palette'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-label', 'Командная палитра')

    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'palette__input'
    input.placeholder = 'Введите команду…'
    input.setAttribute('role', 'combobox')
    input.setAttribute('aria-expanded', 'true')
    input.setAttribute('aria-controls', 'palette-list')
    input.setAttribute('aria-autocomplete', 'list')
    input.spellcheck = false
    input.autocomplete = 'off'

    const list = document.createElement('ul')
    list.className = 'palette__list'
    list.id = 'palette-list'
    list.setAttribute('role', 'listbox')

    dialog.append(input, list)
    overlay.appendChild(dialog)
    document.body.appendChild(overlay)

    this._overlay = overlay
    this._dialog = dialog
    this._input = input
    this._list = list

    input.addEventListener('input', () => {
      this._selected = 0
      this._refresh()
    })
    input.addEventListener('keydown', (e) => this._onKeyDown(e))
    list.addEventListener('mousemove', (e) => {
      const row = e.target.closest('.palette__item')
      if (!row) return
      const index = Number(row.dataset.index)
      if (index !== this._selected) this._select(index, false)
    })
    list.addEventListener('click', (e) => {
      const row = e.target.closest('.palette__item')
      if (row) this._run(Number(row.dataset.index))
    })
  }

  isVisible() {
    return this._isOpen
  }

  open() {
    if (this._isOpen) return
    this._isOpen = true
    this._input.value = ''
    this._selected = 0
    this._overlay.classList.remove('hidden')
    this._refresh()
    this._release = registerModal(this._overlay, this._dialog, {
      onClose: () => this.close(),
      initialFocus: this._input
    })
  }

  close() {
    if (!this._isOpen) return
    this._isOpen = false
    this._overlay.classList.add('hidden')
    this._release?.()
    this._release = null
  }

  toggle() {
    if (this._isOpen) this.close()
    else this.open()
  }

  _refresh() {
    this._results = this._registry.search(this._input.value)
    this._list.replaceChildren()

    if (this._results.length === 0) {
      const empty = document.createElement('li')
      empty.className = 'palette__empty'
      empty.textContent = 'Ничего не найдено'
      this._list.appendChild(empty)
      this._input.removeAttribute('aria-activedescendant')
      return
    }

    this._results.forEach(({ command, indices }, index) => {
      const row = document.createElement('li')
      row.className = 'palette__item'
      row.id = `palette-item-${index}`
      row.dataset.index = String(index)
      row.setAttribute('role', 'option')

      const title = document.createElement('span')
      title.className = 'palette__title'
      this._appendHighlighted(title, command.title, indices)
      row.appendChild(title)

      if (command.group) {
        const group = document.createElement('span')
        group.className = 'palette__group'
        group.textContent = command.group
        row.appendChild(group)
      }
      if (command.hotkey) {
        const hint = document.createElement('span')
        hint.className = 'palette__hotkey'
        hint.textContent = formatHotkey(command.hotkey, this._isMac)
        row.appendChild(hint)
      }
      this._list.appendChild(row)
    })
    this._select(this._selected, true)
  }

  /** Совпавшие символы выделяются жирным (textContent: названия не интерпретируются как HTML). */
  _appendHighlighted(parent, text, indices) {
    if (indices.length === 0) {
      parent.textContent = text
      return
    }
    const matched = new Set(indices)
    let run = ''
    let runMatched = false
    const flush = () => {
      if (!run) return
      if (runMatched) {
        const mark = document.createElement('mark')
        mark.textContent = run
        parent.appendChild(mark)
      } else {
        parent.appendChild(document.createTextNode(run))
      }
      run = ''
    }
    for (let i = 0; i < text.length; i++) {
      const isMatch = matched.has(i)
      if (isMatch !== runMatched) {
        flush()
        runMatched = isMatch
      }
      run += text[i]
    }
    flush()
  }

  _select(index, scroll) {
    if (this._results.length === 0) return
    this._selected = (index + this._results.length) % this._results.length
    for (const row of this._list.querySelectorAll('.palette__item')) {
      const isSelected = Number(row.dataset.index) === this._selected
      row.classList.toggle('selected', isSelected)
      row.setAttribute('aria-selected', String(isSelected))
      if (isSelected) {
        this._input.setAttribute('aria-activedescendant', row.id)
        if (scroll) row.scrollIntoView({ block: 'nearest' })
      }
    }
  }

  _onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      this._select(this._selected + 1, true)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      this._select(this._selected - 1, true)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      this._run(this._selected)
    }
  }

  _run(index) {
    const result = this._results[index]
    if (!result) return
    // Сначала закрываем (фокус возвращается), затем выполняем команду
    this.close()
    this._registry.run(result.command.id)
  }

  destroy() {
    this.close()
    this._overlay?.remove()
    this._overlay = null
  }
}
