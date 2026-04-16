# Спецификация: Боковая панель с деревом файлов

## Контекст

eTty — Electron-приложение (терминальный эмулятор) на базе xterm.js + node-pty. Текущий UI: кастомный titlebar (36px) + терминал на всю оставшуюся площадь. Стек: vanilla JS, CSS, без фреймворков. Тема — Catppuccin Mocha.

Фича добавляет боковую панель слева с деревом файлов для навигации по файловой системе и базовых файловых операций (создание, удаление, копирование, переименование). Панель несворачиваемая.

## Требования

### Layout

- **REQ-1:** Под titlebar добавляется flex-контейнер `#workspace` с `flex-direction: row`.
- **REQ-2:** Sidebar — фиксированная ширина 250px, слева. Вертикальный скролл (`overflow-y: auto`).
- **REQ-3:** Terminal — `flex: 1`, занимает оставшееся пространство.
- **REQ-4:** Панель несворачиваемая (без toggle).
- **REQ-5:** При ресайзе окна `fitAddon.fit()` продолжает работать корректно.

### Дерево файлов

- **REQ-6:** Корень дерева — CWD, из которого запущен eTty. Получается через IPC `fs:get-cwd`.
- **REQ-7:** Lazy loading: при запуске читается только первый уровень CWD. Содержимое папки загружается при первом разворачивании.
- **REQ-8:** Клик по папке — toggle expand/collapse. Клик по файлу — ничего.
- **REQ-9:** Сортировка: папки сверху, затем файлы. Внутри каждой группы — алфавитно.
- **REQ-10:** Dotfiles показываются наравне с обычными файлами.
- **REQ-11:** Иконки — CSS-треугольники (стрелки ▶/▼) для папок. Без внешних иконок-пакетов.
- **REQ-12:** Отступ вложенности — `padding-left: depth * 16px`.

### Контекстное меню (right-click)

- **REQ-13:** Кастомный DOM-элемент, появляется по right-click на ноде или пустом месте sidebar.
- **REQ-14:** Пункты меню:
  - На файле: Новый файл, Новая папка, Переименовать, Удалить, Копировать, Копировать путь
  - На папке: Новый файл, Новая папка, Переименовать, Удалить, Копировать, Вставить, Копировать путь
  - На пустом месте sidebar: Новый файл, Новая папка, Вставить (всё в корне CWD)
- **REQ-15:** Закрытие меню — клик в любое место вне меню.

### Файловые операции

- **REQ-16:** Новый файл / папка — inline-input в дереве (внутри целевой папки). Enter — создаёт, Escape — отмена.
- **REQ-17:** Переименовать — имя ноды заменяется inline-input с текущим именем. Enter — сохраняет, Escape — отмена.
- **REQ-18:** Удалить — подтверждение через `dialog.showMessageBoxSync`. Рекурсивное удаление для папок.
- **REQ-19:** Копировать / Вставить — внутренний буфер (путь). Вставка — `fs.cp()` с рекурсией. Конфликт имён — суффикс `(copy)`.
- **REQ-20:** Копировать путь — абсолютный путь в системный clipboard (`navigator.clipboard.writeText`).

### IPC и бэкенд

- **REQ-21:** Новый модуль `src/main/file-manager.js` (класс FileManager, singleton, по образцу PtyManager).
- **REQ-22:** IPC-каналы (все invoke/handle):
  - `fs:read-dir` — `{ dirPath }` → `[{ name, path, isDirectory }]`
  - `fs:create-file` — `{ filePath }` → `{ success }`
  - `fs:create-dir` — `{ dirPath }` → `{ success }`
  - `fs:rename` — `{ oldPath, newPath }` → `{ success }`
  - `fs:delete` — `{ targetPath }` → `{ success }`
  - `fs:copy` — `{ srcPath, destDir }` → `{ newPath }`
  - `fs:get-cwd` — → `{ cwd }`
- **REQ-23:** Preload: расширяем `window.electronAPI` методами `fsReadDir`, `fsCreateFile`, `fsCreateDir`, `fsRename`, `fsDelete`, `fsCopy`, `getCwd`.
- **REQ-24:** Валидация путей в main-процессе — путь не должен выходить за пределы CWD (path traversal protection).
- **REQ-25:** Ошибки fs пробрасываются как `{ success: false, error: message }`.

## Ограничения

- Панель НЕ сворачиваемая (будет добавлено позже в настройках).
- Drag & drop НЕ поддерживается.
- File watcher (автообновление дерева при изменениях извне) НЕ входит в скоуп.
- Клик по файлу НЕ открывает его (пока без действия).
- Ширина sidebar фиксированная (без ресайза drag-ом).

## Макеты и референсы

Не применимо. Визуальный ориентир — sidebar VS Code (упрощённый вариант).

## Кодстайл и конвенции

- Vanilla JS, ES6 modules (import/export).
- Классы с чётким разделением ответственности (один файл — один класс).
- IPC: `ipcMain.handle()` для async-запросов (по образцу существующих `pty:*` хендлеров).
- Preload: `contextBridge.exposeInMainWorld` для API.
- CSS: vanilla, без препроцессоров. Цвета — захардкожены (Catppuccin Mocha hex).
- Нет CLAUDE.md, нет линтера — следуем паттернам существующего кода.

## Переиспользуемые решения

- `src/main/pty-manager.js` — образец singleton-класса для `FileManager` (Map-based, IPC-интеграция).
- `src/main/index.js` — паттерн регистрации IPC-хендлеров через `ipcMain.handle()`.
- `src/preload/index.js` — паттерн `contextBridge.exposeInMainWorld` для расширения API.
- `src/renderer/index.js` — паттерн инициализации модулей в renderer.
- `src/renderer/styles.css` — цветовая палитра Catppuccin Mocha, layout-подход (flex).

## Критерии приёмки

- [ ] Sidebar 250px отображается слева от терминала, терминал корректно занимает оставшееся пространство.
- [ ] Дерево файлов показывает содержимое CWD при запуске (первый уровень).
- [ ] Папки разворачиваются/сворачиваются по клику, содержимое загружается лениво.
- [ ] Dotfiles видны в дереве.
- [ ] Сортировка: папки вверху, файлы внизу, алфавитно.
- [ ] Контекстное меню появляется по right-click с корректным набором пунктов.
- [ ] Создание файла/папки через inline-input работает.
- [ ] Переименование через inline-input работает.
- [ ] Удаление с подтверждением работает (рекурсивно для папок).
- [ ] Копировать/Вставить работает (с суффиксом при конфликте).
- [ ] Копировать путь — путь в clipboard.
- [ ] Path traversal protection: нельзя выйти за CWD.
- [ ] fitAddon.fit() работает при ресайзе окна.
- [ ] Стилизация соответствует Catppuccin Mocha (sidebar, дерево, контекстное меню, inline-input).

## Затронутые файлы

### Новые

- `src/main/file-manager.js` — FileManager класс
- `src/renderer/file-tree.js` — FileTree класс (DOM-дерево, lazy loading, expand/collapse)
- `src/renderer/context-menu.js` — ContextMenu класс (кастомное контекстное меню)

### Модифицируемые

- `src/main/index.js` — импорт FileManager, регистрация IPC-хендлеров `fs:*`
- `src/preload/index.js` — новые методы в `electronAPI`
- `src/renderer/index.html` — обёртка `#workspace`, контейнер `#sidebar`
- `src/renderer/index.js` — инициализация FileTree
- `src/renderer/styles.css` — стили sidebar, дерева, контекстного меню, inline-input
