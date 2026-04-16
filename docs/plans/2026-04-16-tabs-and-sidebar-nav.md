# План: Многовкладочный режим (tabs) + навигационные кнопки сайдбара

## Контекст

eTty — Electron-терминал с кастомным titlebar, sidebar (дерево файлов) и xterm.js. Сейчас поддерживается только одна PTY-сессия. Нужно добавить поддержку нескольких вкладок, каждая со своим PTY-процессом, своим корневым путём для сайдбара и синхронизацией через OSC 7. Дополнительно — кнопки навигации в сайдбаре (cd .. и cd ~).

---

## Архитектура

### Новый layout (HTML)
```
titlebar (36px)
tab-bar (32px)          ← новый #tab-bar
workspace (100vh - 68px)
  ├─ sidebar
  │   ├─ #sidebar-nav   ← новый блок с кнопками ↑ и ~
  │   └─ (file tree)
  ├─ resize-handle
  └─ #terminal-container ← содержит .terminal-pane divы (один на таб)
```

### Структура таба (объект в памяти)
```javascript
{
  pid: Number,          // PID PTY процесса
  term: Terminal,       // xterm.js инстанс
  fitAddon: FitAddon,
  container: HTMLElement, // .terminal-pane div
  element: HTMLElement,   // таб в #tab-bar
  rootPath: String,       // текущая корневая папка
  folderName: String,     // имя папки (из rootPath)
  termTitle: String,      // из term.onTitleChange
}
```

---

## Файлы для изменения

| Файл | Изменение |
|------|-----------|
| `src/renderer/index.html` | Добавить `#tab-bar`, `#sidebar-nav` |
| `src/renderer/styles.css` | Стили для tab-bar, табов, sidebar-nav, изменить высоту workspace |
| `src/renderer/index.js` | Рефакторинг: использовать TabBar, обновить IPC обработчики |
| `src/renderer/tab-bar.js` | **Новый файл** — класс TabBar |
| `src/main/pty-manager.js` | Добавить pid в payload `pty:data` |
| `src/preload/index.js` | Обновить `onPtyData` сигнатуру, добавить `ptyKill` |
| `src/main/index.js` | Добавить IPC handler `pty:kill` |

---

## Шаги реализации

### Шаг 1 — IPC: добавить pid в pty:data и ptyKill

**`src/main/pty-manager.js`:**
- Изменить `webContents.send('pty:data', data)` → `webContents.send('pty:data', { pid, data })`

**`src/main/index.js`:**
- Добавить handler: `ipcMain.handle('pty:kill', (_, pid) => ptyManager.kill(pid))`

**`src/preload/index.js`:**
- Обновить: `onPtyData: (cb) => ipcRenderer.on('pty:data', (_, { pid, data }) => cb(pid, data))`
- Добавить: `ptyKill: (pid) => ipcRenderer.invoke('pty:kill', pid)`

---

### Шаг 2 — HTML: добавить tab-bar и sidebar-nav

**`src/renderer/index.html`:**
```html
<!-- После #titlebar, перед #workspace -->
<div id="tab-bar">
  <!-- .tab элементы добавляются динамически -->
  <button id="tab-add">+</button>
</div>

<!-- Внутри #sidebar, перед деревом файлов -->
<div id="sidebar-nav">
  <button id="btn-up" title="На уровень выше">↑</button>
  <button id="btn-home" title="Домашняя директория">~</button>
</div>
```

---

### Шаг 3 — CSS: стили для новых элементов

**`src/renderer/styles.css`:**

```css
/* workspace — учёт tab-bar */
#workspace {
  height: calc(100vh - 36px - 32px); /* было: calc(100vh - 36px) */
}

/* Tab bar */
#tab-bar {
  height: 32px;
  background: #181825;
  display: flex;
  align-items: center;
  overflow-x: auto;
  overflow-y: hidden;
  border-bottom: 1px solid #313244;
  -webkit-app-region: no-drag;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 120px;
  max-width: 200px;
  height: 100%;
  padding: 0 10px;
  cursor: pointer;
  font-size: 12px;
  color: #6c7086;
  border-right: 1px solid #313244;
  flex-shrink: 0;
}

.tab.active {
  background: #1e1e2e;
  color: #cdd6f4;
  border-bottom: 2px solid #89b4fa;
}

.tab-folder { font-weight: 600; }
.tab-title { opacity: 0.6; }

.tab-close {
  margin-left: auto;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 11px;
  padding: 2px 4px;
  border-radius: 3px;
  opacity: 0;
}
.tab:hover .tab-close,
.tab.active .tab-close { opacity: 1; }
.tab-close:hover { background: #f38ba8; color: #1e1e2e; }

#tab-add {
  flex-shrink: 0;
  margin: 0 6px;
  background: none;
  border: none;
  color: #6c7086;
  font-size: 18px;
  cursor: pointer;
  padding: 0 6px;
  line-height: 1;
}
#tab-add:hover { color: #cdd6f4; }

/* Sidebar nav */
#sidebar-nav {
  display: flex;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid #313244;
}

#sidebar-nav button {
  background: #313244;
  border: none;
  color: #cdd6f4;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}
#sidebar-nav button:hover { background: #45475a; }
#sidebar-nav button:disabled { opacity: 0.3; cursor: default; }

/* Terminal panes */
.terminal-pane {
  width: 100%;
  height: 100%;
  display: none;
}
.terminal-pane.active { display: block; }
```

---

### Шаг 4 — Создать TabBar класс

**`src/renderer/tab-bar.js`** — новый файл:

```javascript
class TabBar {
  constructor({ tabBarEl, terminalContainerEl, onSwitch, onAddTab, onCloseTab }) {
    this.tabBarEl = tabBarEl;
    this.terminalContainerEl = terminalContainerEl;
    this.onSwitch = onSwitch;
    this.onAddTab = onAddTab;
    this.onCloseTab = onCloseTab;

    this.tabs = [];
    this.activeIndex = -1;

    // Кнопка +
    this.addBtn = tabBarEl.querySelector('#tab-add');
    this.addBtn.addEventListener('click', () => this.onAddTab());
  }

  addTab({ pid, term, fitAddon, rootPath }) {
    const folderName = rootPath.split('/').pop() || rootPath;
    const container = document.createElement('div');
    container.className = 'terminal-pane';
    this.terminalContainerEl.appendChild(container);
    term.open(container);

    const element = this._createTabEl(this.tabs.length, folderName, '');
    this.tabBarEl.insertBefore(element, this.addBtn);

    const tab = { pid, term, fitAddon, container, element, rootPath, folderName, termTitle: '' };
    this.tabs.push(tab);

    // term.onTitleChange
    term.onTitleChange((title) => {
      tab.termTitle = title;
      this._updateTabLabel(tab);
    });

    this.switchTo(this.tabs.length - 1);
    return tab;
  }

  removeTab(index) {
    const tab = this.tabs[index];
    tab.container.remove();
    tab.element.remove();
    this.tabs.splice(index, 1);

    if (this.tabs.length === 0) {
      window.close();
      return;
    }

    const nextIndex = Math.min(index, this.tabs.length - 1);
    this.switchTo(nextIndex);
  }

  switchTo(index) {
    // Скрыть старый
    if (this.activeIndex >= 0 && this.tabs[this.activeIndex]) {
      this.tabs[this.activeIndex].container.classList.remove('active');
      this.tabs[this.activeIndex].element.classList.remove('active');
    }

    this.activeIndex = index;
    const tab = this.tabs[index];
    tab.container.classList.add('active');
    tab.element.classList.add('active');

    // Fit + focus
    tab.fitAddon.fit();
    tab.term.focus();

    this.onSwitch(tab);
  }

  getActive() {
    return this.tabs[this.activeIndex];
  }

  updateRootPath(index, rootPath) {
    const tab = this.tabs[index];
    tab.rootPath = rootPath;
    tab.folderName = rootPath.split('/').pop() || rootPath;
    this._updateTabLabel(tab);
  }

  _createTabEl(index, folderName, termTitle) {
    const el = document.createElement('div');
    el.className = 'tab';
    el.innerHTML = `
      <span class="tab-folder">${folderName}</span>
      <span class="tab-title">${termTitle}</span>
      <button class="tab-close">✕</button>
    `;
    el.addEventListener('click', (e) => {
      if (!e.target.classList.contains('tab-close')) {
        this.switchTo(this.tabs.findIndex(t => t.element === el));
      }
    });
    el.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      const i = this.tabs.findIndex(t => t.element === el);
      this.onCloseTab(i);
    });
    return el;
  }

  _updateTabLabel(tab) {
    tab.element.querySelector('.tab-folder').textContent = tab.folderName;
    tab.element.querySelector('.tab-title').textContent = tab.termTitle;
  }
}
```

---

### Шаг 5 — Рефакторинг index.js

**Ключевые изменения:**

1. Убрать прямое создание `term` и `pid` на верхнем уровне.
2. Вынести логику инициализации PTY+xterm в функцию `createTab(cwd)`.
3. Инициализировать `TabBar` в `DOMContentLoaded`.
4. Обновить `onPtyData(pid, data)` — найти таб по pid и писать в него.
5. `onPtyExit(pid)` — найти таб и закрыть.
6. OSC 7 handler — обновлять только активный таб.
7. Кнопки `#btn-up` и `#btn-home` — `ptyWrite(activeTab.pid, 'cd ..\n')` / `ptyWrite(activeTab.pid, 'cd ~\n')`.
8. Disabled-логика для `#btn-up` — проверять `tab.rootPath === '/'`.
9. `onAddTab` callback — вызывает `createTab(activeTab.rootPath)`.
10. `onCloseTab(i)` — `ptyKill(tab.pid)` + `tabBar.removeTab(i)`.
11. `onSwitch(tab)` — `fileTree.setRoot(tab.rootPath)`, обновить disabled у `#btn-up`.
12. ResizeObserver — `tab.fitAddon.fit()` для активного таба.

---

## Верификация

1. Запустить приложение — должна появиться одна вкладка с текущей директорией.
2. Нажать `+` — появляется вторая вкладка с той же корневой папкой, отдельный PTY.
3. В первом табе выполнить `cd /tmp` — сайдбар первого таба обновляется, заголовок таба тоже.
4. Переключиться на второй таб — сайдбар показывает его папку.
5. Закрыть таб — PTY убивается, переключается на соседний.
6. Закрыть последний таб — приложение закрывается.
7. Кнопка `↑` — выполняет `cd ..` в терминале, сайдбар обновляется.
8. Кнопка `~` — выполняет `cd ~`, сайдбар обновляется.
9. Кнопка `↑` disabled при `rootPath === '/'`.
