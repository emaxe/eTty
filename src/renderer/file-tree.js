import { ContextMenu } from './context-menu.js'

export class FileTree {
  constructor(container, writeToPty = null) {
    this._container = container
    this._writeToPty = writeToPty
    this._cwd = null
    this._rootContainer = null
    this._contextMenu = new ContextMenu()
    this._clipboard = null // { path }
  }

  getCwd() {
    return this._cwd
  }

  async setRoot(newPath) {
    if (this._cwd === newPath) return
    this._cwd = newPath

    const labelEl = this._rootNodeRow?.querySelector('.tree-root-label')
    if (labelEl) {
      const parts = newPath.replace(/\/$/, '').split('/')
      labelEl.textContent = parts[parts.length - 1] || newPath
    }

    await this._refreshList(this._rootContainer, newPath, 1)
  }

  async init(startPath = null) {
    const cwd = startPath ?? (await window.electronAPI.getCwd()).cwd
    this._cwd = cwd
    this._container.innerHTML = ''

    const { row, children } = this._renderRootNode(cwd)
    this._rootNodeRow = row
    this._container.appendChild(row)

    this._rootContainer = children
    this._container.appendChild(children)
    await this._refreshList(this._rootContainer, cwd, 1)

    this._container.addEventListener('contextmenu', (e) => {
      const rootUl = this._rootContainer.querySelector(':scope > ul')
      if (e.target === this._container || e.target === this._rootContainer || e.target === rootUl) {
        e.preventDefault()
        this._showMenuEmpty(e.clientX, e.clientY, this._cwd, this._rootContainer, 1)
      }
    })
  }

  _renderRootNode(dirPath) {
    const parts = dirPath.replace(/\/$/, '').split('/')
    const name = parts[parts.length - 1] || dirPath

    const row = document.createElement('div')
    row.className = 'tree-root-node-row'

    const arrow = document.createElement('span')
    arrow.className = 'tree-arrow expanded'
    arrow.textContent = '▶'

    const label = document.createElement('span')
    label.className = 'tree-root-label'
    label.textContent = name

    row.appendChild(arrow)
    row.appendChild(label)

    const children = document.createElement('div')
    children.className = 'tree-root-children open'

    row.addEventListener('click', (e) => {
      e.stopPropagation()
      const isOpen = children.classList.toggle('open')
      arrow.classList.toggle('expanded', isOpen)
    })

    return { row, children }
  }

  async _loadDir(dirPath) {
    const result = await window.electronAPI.fsReadDir(dirPath)
    if (!result || result.error) return null
    return result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  _buildList(entries, parentPath, depth) {
    const ul = document.createElement('ul')
    ul.style.listStyle = 'none'
    ul.style.padding = '0'
    ul.style.margin = '0'
    for (const entry of entries) {
      ul.appendChild(this._buildNode(entry, depth))
    }
    return ul
  }

  _buildNode(entry, depth) {
    const li = document.createElement('li')
    li.className = 'tree-node'
    li.dataset.path = entry.path
    li.dataset.isDir = entry.isDirectory ? '1' : '0'

    const row = document.createElement('div')
    row.className = 'tree-node-row'
    row.style.paddingLeft = `${depth * 16 + 8}px`

    const arrow = document.createElement('span')
    arrow.className = 'tree-arrow'
    arrow.textContent = entry.isDirectory ? '▶' : ''
    row.appendChild(arrow)

    const icon = document.createElement('span')
    icon.className = 'tree-icon'
    icon.textContent = entry.isDirectory ? '📁' : '📄'
    row.appendChild(icon)

    const name = document.createElement('span')
    name.className = 'tree-name'
    name.textContent = entry.name
    row.appendChild(name)

    li.appendChild(row)

    let childrenEl = null
    let loaded = false

    if (entry.isDirectory) {
      childrenEl = document.createElement('div')
      childrenEl.className = 'tree-children'
      li.appendChild(childrenEl)

      row.addEventListener('click', async (e) => {
        e.stopPropagation()
        const isOpen = childrenEl.classList.contains('open')
        if (isOpen) {
          childrenEl.classList.remove('open')
          arrow.classList.remove('expanded')
        } else {
          if (!loaded) {
            const entries = await this._loadDir(entry.path)
            if (entries) {
              childrenEl.appendChild(this._buildList(entries, entry.path, depth + 1))
            }
            loaded = true
          }
          childrenEl.classList.add('open')
          arrow.classList.add('expanded')
        }
      })
    }

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this._selectRow(row)
      if (entry.isDirectory) {
        this._showMenuDir(e.clientX, e.clientY, entry, childrenEl, arrow, depth + 1, row)
      } else {
        this._showMenuFile(e.clientX, e.clientY, entry, row)
      }
    })

    return li
  }

  _selectRow(row) {
    const prev = this._container.querySelector('.tree-node-row.selected')
    if (prev) prev.classList.remove('selected')
    row.classList.add('selected')
  }

  // ── Context menus ────────────────────────────────────────────────

  _parentDir(filePath) {
    return filePath.replace(/\/[^/]+$/, '')
  }

  _showMenuFile(x, y, entry, row) {
    const parentDir = this._parentDir(entry.path)
    const parentContainer = this._findContainerForDir(parentDir)
    this._contextMenu.show([
      { label: 'Новый файл', action: () => this._createInline('file', parentDir, parentContainer, 0) },
      { label: 'Новая папка', action: () => this._createInline('dir', parentDir, parentContainer, 0) },
      { separator: true },
      { label: 'Переименовать', action: () => this._renameInline(entry, row) },
      { label: 'Удалить', action: () => this._deleteEntry(entry, row) },
      { separator: true },
      { label: 'Копировать', action: () => { this._clipboard = { path: entry.path } } },
      { label: 'Копировать путь', action: () => navigator.clipboard.writeText(entry.path) }
    ], x, y)
  }

  _showMenuDir(x, y, entry, childrenEl, arrow, childDepth, row) {
    this._contextMenu.show([
      { label: 'Новый файл', action: () => this._createInlineInDir('file', entry.path, childrenEl, arrow, childDepth) },
      { label: 'Новая папка', action: () => this._createInlineInDir('dir', entry.path, childrenEl, arrow, childDepth) },
      { separator: true },
      { label: 'Переименовать', action: () => this._renameInline(entry, row) },
      { label: 'Удалить', action: () => this._deleteEntry(entry, row) },
      { separator: true },
      { label: 'Копировать', action: () => { this._clipboard = { path: entry.path } } },
      { label: 'Вставить', action: () => this._paste(entry.path, childrenEl, childDepth) },
      { label: 'Копировать путь', action: () => navigator.clipboard.writeText(entry.path) },
      { separator: true },
      { label: 'cd в директорию', action: () => {
          const escaped = entry.path.replace(/'/g, "'\\''")
          this._writeToPty?.(`cd '${escaped}'\r`)
        }
      }
    ], x, y)
  }

  _showMenuEmpty(x, y, dirPath, container, depth = 0) {
    const items = [
      { label: 'Новый файл', action: () => this._createInline('file', dirPath, container, depth) },
      { label: 'Новая папка', action: () => this._createInline('dir', dirPath, container, depth) }
    ]
    if (this._clipboard) {
      items.push({ separator: true })
      items.push({ label: 'Вставить', action: () => this._paste(dirPath, container, depth) })
    }
    this._contextMenu.show(items, x, y)
  }

  // ── Inline input helpers ─────────────────────────────────────────

  // Create inline input inside a container div (root or tree-children div after expand)
  _createInline(kind, parentPath, container, depth) {
    this._appendInlineInput(kind, parentPath, container, depth)
  }

  // Create inline input inside a dir's childrenEl, expanding it first
  _createInlineInDir(kind, parentPath, childrenEl, arrow, depth) {
    if (!childrenEl.classList.contains('open')) {
      childrenEl.classList.add('open')
      arrow.classList.add('expanded')
    }
    this._appendInlineInput(kind, parentPath, childrenEl, depth)
  }

  _appendInlineInput(kind, parentPath, container, depth) {
    // Find or create the ul inside the container
    let ul = container.querySelector(':scope > ul')
    if (!ul) {
      ul = document.createElement('ul')
      ul.style.listStyle = 'none'
      ul.style.padding = '0'
      ul.style.margin = '0'
      container.appendChild(ul)
    }

    const li = document.createElement('li')
    li.className = 'tree-node'

    const row = document.createElement('div')
    row.className = 'tree-node-row'
    row.style.paddingLeft = `${depth * 16 + 8}px`

    const input = document.createElement('input')
    input.className = 'tree-inline-input'
    input.placeholder = kind === 'file' ? 'filename' : 'folder name'
    row.appendChild(input)
    li.appendChild(row)
    ul.appendChild(li)

    const cleanup = () => li.remove()

    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') { cleanup(); return }
      if (e.key !== 'Enter') return
      const name = input.value.trim()
      if (!name) { cleanup(); return }

      const targetPath = parentPath.replace(/\/$/, '') + '/' + name
      let result
      if (kind === 'file') {
        result = await window.electronAPI.fsCreateFile(targetPath)
      } else {
        result = await window.electronAPI.fsCreateDir(targetPath)
      }

      if (result && result.success === false) {
        input.style.borderColor = '#f38ba8'
        return
      }

      cleanup()
      this._refreshList(container, parentPath, depth)
    })

    input.addEventListener('blur', cleanup)
    input.focus()
  }

  _renameInline(entry, row) {
    const nameEl = row.querySelector('.tree-name')
    const original = nameEl.textContent

    const input = document.createElement('input')
    input.className = 'tree-inline-input'
    input.value = original
    nameEl.replaceWith(input)
    input.select()

    const restore = () => input.replaceWith(nameEl)

    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') { restore(); return }
      if (e.key !== 'Enter') return
      const newName = input.value.trim()
      if (!newName || newName === original) { restore(); return }

      const dir = this._parentDir(entry.path)
      const newPath = dir + '/' + newName
      const result = await window.electronAPI.fsRename(entry.path, newPath)

      if (result && result.success === false) {
        input.style.borderColor = '#f38ba8'
        return
      }

      nameEl.textContent = newName
      restore()
      const li = row.closest('li')
      if (li) li.dataset.path = newPath
    })

    input.addEventListener('blur', restore)
  }

  async _deleteEntry(entry, row) {
    const result = await window.electronAPI.fsDelete(entry.path)
    if (result && result.success === false) return
    row.closest('li').remove()
  }

  async _paste(destDir, container, depth) {
    if (!this._clipboard) return
    const result = await window.electronAPI.fsCopy(this._clipboard.path, destDir)
    if (!result || result.success === false) return
    this._refreshList(container, destDir, depth)
  }

  // ── List refresh ─────────────────────────────────────────────────

  // container is always a div; replaces its ul child
  async _refreshList(container, dirPath, depth) {
    const entries = await this._loadDir(dirPath)
    if (!entries) return
    const newUl = this._buildList(entries, dirPath, depth)
    const existingUl = container.querySelector(':scope > ul')
    if (existingUl) {
      existingUl.replaceWith(newUl)
    } else {
      container.appendChild(newUl)
    }
  }

  // Find the container div for a given dir path in the tree
  _findContainerForDir(dirPath) {
    if (dirPath === this._cwd) return this._rootContainer
    const li = this._container.querySelector(`li[data-path="${CSS.escape(dirPath)}"]`)
    if (li) {
      const childrenEl = li.querySelector('.tree-children')
      if (childrenEl) return childrenEl
    }
    return this._rootContainer
  }
}
