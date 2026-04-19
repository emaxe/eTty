import { THEMES } from './themes.js'

/**
 * Страница настроек (overlay). Категории: оформление (тема), дерево файлов.
 * Auto-save с debounce 300ms. Тема применяется мгновенно через callback.
 */
export class SettingsPage {
  constructor({ onSettingsChanged }) {
    this._onSettingsChanged = onSettingsChanged
    this._settings = null
    this._overlay = null
    this._saveTimer = null
  }

  async init() {
    this._settings = await window.electronAPI.settingsLoad()
    this._buildDOM()
  }

  show() {
    this._overlay.classList.remove('hidden')
  }

  hide() {
    this._overlay.classList.add('hidden')
  }

  isVisible() {
    return !this._overlay.classList.contains('hidden')
  }

  _buildDOM() {
    const overlay = document.createElement('div')
    overlay.id = 'settings-overlay'
    overlay.classList.add('hidden')

    // Header
    const header = document.createElement('div')
    header.className = 'settings-header'

    const title = document.createElement('div')
    title.className = 'settings-title'
    title.textContent = 'Настройки'

    const closeBtn = document.createElement('button')
    closeBtn.className = 'settings-close-btn'
    closeBtn.title = 'Закрыть'
    closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/></svg>`
    closeBtn.addEventListener('click', () => this.hide())

    header.appendChild(title)
    header.appendChild(closeBtn)

    // Body
    const body = document.createElement('div')
    body.className = 'settings-body'

    body.appendChild(this._buildCategory('Дерево файлов', [
      {
        label: 'Сворачивать дочерние папки при закрытии родительской',
        control: this._createToggle(
          this._settings.fileTree.collapseChildrenOnClose,
          (val) => {
            this._settings.fileTree.collapseChildrenOnClose = val
            this._onSettingsChanged('fileTree.collapseChildrenOnClose', val)
            this._scheduleSave()
          }
        )
      },
      {
        label: 'Открытие файлов в редакторе',
        control: this._createSelect(
          [
            { key: 'double', name: 'Двойной клик' },
            { key: 'single', name: 'Одинарный клик' }
          ],
          this._settings.fileTree.fileOpenMode || 'double',
          (val) => {
            this._settings.fileTree.fileOpenMode = val
            this._onSettingsChanged('fileTree.fileOpenMode', val)
            this._scheduleSave()
          }
        )
      }
    ]))

    body.appendChild(this._buildCategory('Оформление', [
      {
        label: 'Тема',
        control: this._buildThemeRow()
      }
    ]))

    overlay.appendChild(header)
    overlay.appendChild(body)
    document.body.appendChild(overlay)
    this._overlay = overlay
  }

  _buildCategory(title, rows) {
    const category = document.createElement('div')
    category.className = 'settings-category'

    const categoryTitle = document.createElement('div')
    categoryTitle.className = 'settings-category-title'
    categoryTitle.textContent = title
    category.appendChild(categoryTitle)

    for (const row of rows) {
      const rowEl = document.createElement('div')
      rowEl.className = 'settings-row'

      const label = document.createElement('div')
      label.className = 'settings-label'
      label.textContent = row.label

      const control = document.createElement('div')
      control.className = 'settings-control'
      control.appendChild(row.control)

      rowEl.appendChild(label)
      rowEl.appendChild(control)
      category.appendChild(rowEl)
    }

    return category
  }

  _createToggle(value, onChange) {
    const label = document.createElement('label')
    label.className = 'settings-toggle'

    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = value
    input.addEventListener('change', () => onChange(input.checked))

    const track = document.createElement('span')
    track.className = 'settings-toggle-track'

    label.appendChild(input)
    label.appendChild(track)
    return label
  }

  _createSelect(options, value, onChange) {
    const select = document.createElement('select')
    select.className = 'settings-select'

    for (const { key, name } of options) {
      const option = document.createElement('option')
      option.value = key
      option.textContent = name
      if (key === value) option.selected = true
      select.appendChild(option)
    }

    select.addEventListener('change', () => onChange(select.value))
    return select
  }

  _buildThemeRow() {
    const wrapper = document.createElement('div')
    wrapper.className = 'settings-theme-row'

    // Color swatch preview
    const swatch = document.createElement('div')
    swatch.className = 'settings-theme-swatch'
    const swatchLeft = document.createElement('div')
    swatchLeft.className = 'settings-theme-swatch-half'
    const swatchRight = document.createElement('div')
    swatchRight.className = 'settings-theme-swatch-half'
    swatch.appendChild(swatchLeft)
    swatch.appendChild(swatchRight)

    const updateSwatch = (themeName) => {
      const theme = THEMES[themeName]
      if (!theme) return
      swatchLeft.style.background = theme.ui.bg
      swatchRight.style.background = theme.ui.accent
    }
    updateSwatch(this._settings.appearance.theme)

    const themeOptions = Object.entries(THEMES).map(([key, t]) => ({ key, name: t.name }))
    const select = this._createSelect(themeOptions, this._settings.appearance.theme, (val) => {
      this._settings.appearance.theme = val
      updateSwatch(val)
      this._onSettingsChanged('appearance.theme', val)
      this._scheduleSave()
    })

    wrapper.appendChild(swatch)
    wrapper.appendChild(select)
    return wrapper
  }

  _scheduleSave() {
    clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(() => {
      window.electronAPI.settingsSave(this._settings)
    }, 300)
  }
}
