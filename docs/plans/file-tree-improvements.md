# План: улучшения файлового дерева и контекстного меню

## Контекст

Добавление четырёх улучшений в UI файлового дерева eTty:
1. Блокировка навигационных кнопок и пункта "cd в директорию" когда терминал занят
2. Перемещение "cd в директорию" на первое место в контекстном меню + разделитель после него
3. Новый пункт "Копировать относительный путь" в контекстном меню
4. Поддержка контекстного меню на корневом узле дерева

---

## Файлы для изменения

- `src/main/pty-manager.js` — добавить preexec/precmd хуки для OSC 133
- `src/renderer/index.js` — OSC 133 handler, обновление кнопок, передача busy-состояния в FileTree
- `src/renderer/file-tree.js` — новый порядок пунктов меню, disabled-состояние, копирование относительного пути, меню корневого узла
- `src/renderer/context-menu.js` — поддержка disabled-пунктов
- `src/renderer/styles.css` — стиль для disabled-пункта меню

---

## Шаги реализации

### Шаг 1 — OSC 133 в zsh-конфиге (`pty-manager.js`)

В `_createZdotdir()` добавить в массив строк `.zshrc` два хука:

```js
`_etty_preexec() { printf '\\033]133;C\\007' }`,
`_etty_precmd_state() { printf '\\033]133;A\\007' }`,
`add-zsh-hook preexec _etty_preexec`,
`add-zsh-hook precmd _etty_precmd_state`,
```

Разместить после существующих строк `_etty_cwd` / `add-zsh-hook precmd _etty_cwd`.

OSC 133;C = команда началась (busy), OSC 133;A = промпт показан (idle).

---

### Шаг 2 — Отслеживание busy-состояния (`index.js`)

**a. Инициализация busy-флага** — в `onAddTab` после `tabBar.addTab(tabData)`:
```js
tab.isBusy = false
```

**b. Хелпер `updateNavButtons()`** — заменить все прямые `btnUp.disabled = ...`:
```js
function updateNavButtons() {
  const tab = tabBar.getActive()
  const busy = tab?.isBusy ?? false
  btnUp.disabled = busy || (tab?.rootPath === '/')
  btnHome.disabled = busy
  fileTree.setIsBusy(busy)
}
```

Вызывать `updateNavButtons()` вместо `btnUp.disabled = newPath === '/'` в:
- OSC 7 handler (строка ~158)
- `onSwitch` callback

**c. OSC 133 handler** — в конце `setupTabHandlers(tab)`:
```js
tab.term.parser.registerOscHandler(133, (data) => {
  const wasBusy = tab.isBusy
  if (data.startsWith('C')) tab.isBusy = true
  else if (data.startsWith('A')) tab.isBusy = false
  if (wasBusy !== tab.isBusy && tabBar.getActive()?.pid === tab.pid) {
    updateNavButtons()
  }
  return false
})
```

**d. onSwitch** — при переключении табов обновлять busy-состояние fileTree через `updateNavButtons()`.

---

### Шаг 3 — Поддержка disabled-пунктов (`context-menu.js`)

В методе `show()`, при создании DOM-элемента пункта:
```js
if (item.disabled) {
  el.classList.add('disabled')
  el.addEventListener('click', (e) => e.stopPropagation()) // не закрывать меню
} else {
  el.addEventListener('click', () => {
    this.hide()
    item.action()
  })
}
```

---

### Шаг 4 — Стиль disabled (`styles.css`)

```css
.context-menu-item.disabled {
  opacity: 0.4;
  cursor: default;
}
```

---

### Шаг 5 — Обновление контекстного меню директории (`file-tree.js`)

**a. Добавить поле и сеттер:**
```js
// в конструкторе:
this._isBusy = false

// новый метод:
setIsBusy(busy) { this._isBusy = busy }
```

**b. Новый порядок пунктов в `_showMenuDir()`:**
```
1. cd в директорию   ← disabled: this._isBusy
2. ─── separator ───
3. Новый файл
4. Новая папка
5. ─── separator ───
6. Переименовать
7. Удалить
8. ─── separator ───
9. Копировать
10. Вставить
11. Копировать путь
12. Копировать относительный путь  ← НОВЫЙ
```

Относительный путь вычислять в renderer без Node.js `path`:
```js
const rel = entry.path.startsWith(this._cwd + '/')
  ? entry.path.slice(this._cwd.length + 1)
  : entry.path
navigator.clipboard.writeText(rel)
```

**c. Тот же пункт "Копировать относительный путь" добавить в `_showMenuFile()`** (в конец, после "Копировать путь").

---

### Шаг 6 — Контекстное меню корневого узла (`file-tree.js`)

**a. В `_renderRootNode()`** добавить обработчик:
```js
row.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  e.stopPropagation()
  this._showMenuRoot(e.clientX, e.clientY)
})
```

Сохранить ссылки на `children` (как `this._rootChildrenEl`) и `arrow` (как `this._rootArrow`) для передачи в меню — или добавить поля в constructor.

**b. Новый метод `_showMenuRoot(x, y)`:**
```js
_showMenuRoot(x, y) {
  this._contextMenu.show([
    { label: 'cd в директорию', disabled: this._isBusy, action: () => {
        const escaped = this._cwd.replace(/'/g, "'\\''")
        this._writeToPty?.(`cd '${escaped}'\r`)
    }},
    { separator: true },
    { label: 'Новый файл', action: () => this._createInline('file', this._cwd, this._rootContainer, 1) },
    { label: 'Новая папка', action: () => this._createInline('dir', this._cwd, this._rootContainer, 1) },
    { separator: true },
    { label: 'Копировать путь', action: () => navigator.clipboard.writeText(this._cwd) }
  ], x, y)
}
```

---

## Проверка

1. Запустить `npm run dev`
2. Запустить долгую команду (`sleep 10`):
   - кнопки "вверх" и "домой" должны стать disabled
   - пункт "cd в директорию" в контекстном меню — серый, клик не выполняет cd
3. После завершения команды — кнопки и пункт снова активны
4. ПКМ на папку — "cd в директорию" стоит первым, после него разделитель
5. ПКМ на файл или папку — присутствует "Копировать относительный путь", копирует путь относительно корня дерева
6. ПКМ на корневой узел (заголовок дерева) — появляется контекстное меню

---

## После реализации

Сохранить план в `docs/plans/file-tree-improvements.md`.
