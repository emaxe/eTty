# Правила проекта

<!-- Мигрировано из корневых файлов ИИ-агентов -->

## Из CLAUDE.md

# CLAUDE.md — контекст для AI-агентов

## Проект

eTty — Electron-приложение-обёртка терминала. Stack: **Electron 33**, **electron-vite**, **xterm.js**, **node-pty**, **CodeMirror 6**, **simple-git**.

## Структура директорий

```
src/
  main/                      — main-процесс Electron
    index.js                 — bootstrap: сервисы, IPC handlers, запуск AppService (~58 строк)
    services/
      app-service.js         — жизненный цикл: окно, меню, автообновление, сохранение состояния
    ipc-handlers/            — регистрация IPC-обработчиков по доменам
      index.js             — barrel export всех register*Handlers
      pty-handlers.js      — PTY create/write/resize/kill
      fs-handlers.js       — файловые операции
      window-handlers.js   — окно: position/move
      app-handlers.js      — системные: homedir, open external
      tabs-handlers.js     — вкладки: save/load/restore dialog
      settings-handlers.js — настройки: load/save
      agents-handlers.js   — агенты: status/refresh
      history-handlers.js  — история: cleanup
      git-handlers.js      — Git операции (из git-service.js)
    pty-manager.js           — управление PTY-сессиями (node-pty + zsh)
    file-manager.js          — файловые операции с path traversal защитой
    git-service.js           — чистая утилита countDiffLines (IPC убран)
    history-manager.js       — история команд (глобальная + per-tab, мержинг, мьютекс)
    tab-state.js             — сохранение/восстановление вкладок между сессиями
    settings-store.js        — настройки приложения (JSON, deep merge)
    agent-service.js         — авто-детект CLI ИИ-агентов (Claude, Codex, Copilot, Cursor, OpenCode)
  preload/                   — contextBridge API (~50 методов)
    index.js                 — IPC-мост: pty, fs, window, tabs, settings, git, agents
  renderer/                  — UI
    index.js                 — bootstrap: DI Container, EventBus, State Store, компоненты
    core/                    — инфраструктура renderer
      event-bus.js           — централизованная шина событий
      state-store.js         — глобальное состояние с подписками
      container.js           — DI-контейнер
      adapters/
        electron-api.js      — адаптер window.electronAPI
      config/
        app-config.js        — константы приложения (debounce, интервалы, размеры)
        terminal-config.js   — константы терминала (font, scrollback)
        ui-dimensions.js     — размеры UI элементов
    features/terminal/         — терминальные фичи
      terminal-keyboard-handler.js — Kitty protocol + кириллица
      terminal-osc-handler.js      — OSC 7 (cwd), OSC 133 (busy)
    components/base/           — UI-kit
      button/button.js
      context-menu/context-menu.js
      tabs/draggable-tabs.js   — generic drag-and-drop для вкладок
    tab-bar.js               — вкладки терминала (на DraggableTabs)
    file-tree.js             — дерево файлов с lazy-load, DnD, multi-select, undo
    editor-panel.js          — CodeMirror 6 редактор с подсветкой (20+ языков)
    editor-languages.js        — динамическая загрузка языков (code-splitting)
    editor-theme.js            — построение темы CodeMirror из THEMES
    git-panel.js             — UI Git: ветки, diff, commit, push, discard
    status-bar.js            — статус-бар: Git ±, cwd, node, AI-агенты, proxy toggle
    settings-page.js         — страница настроек (overlay)
    context-menu.js            — legacy контекстное меню (deprecated, используй base/)
    themes.js                  — 7 тем (Catppuccin Mocha, Monokai, Dracula, One Dark, Nord, Solarized, Gruvbox)
    styles.css                 — CSS variables + стили всех компонентов
    index.html                 — HTML-разметка
  shared/
    ipc-channels.js          — константы имён IPC каналов (единый источник истины)
out/                         — артефакты electron-vite build (НЕ редактировать вручную)
dist/                        — артефакты electron-builder (НЕ коммитить)
build/                       — ресурсы для сборки (иконки, entitlements)
docs/                        — спецификации, планы, чеклисты по фичам
```

## Архитектурные принципы (после рефакторинга Блоков 1–4)

- **DI Container** (`core/container.js`) — все компоненты получают зависимости через constructor
- **EventBus** (`core/event-bus.js`) — коммуникация между компонентами через события
- **StateStore** (`core/state-store.js`) — централизованное состояние с подписками
- **IPC_CHANNELS** (`shared/ipc-channels.js`) — все имена каналов в одном месте, нет строковых литералов
- **IPC handlers split** — каждая доменная группа в своём файле `main/ipc-handlers/`
- **AppService** — жизненный цикл приложения в main процессе вынесен из `index.js`

## Реализованные фичи

### Терминал
- Множественные вкладки с независимыми PTY-сессиями (zsh)
- WebGL-ускорение рендеринга (fallback на canvas)
- Kitty keyboard protocol (Shift+Enter, Ctrl+Enter, Ctrl+Shift+Enter)
- Корректная обработка кириллицы и non-ASCII символов
- OSC 7 — синхронизация директории shell → UI
- OSC 133 — отслеживание занятости (preexec/precmd)
- Scrollback **2500** строк (было 10000, снижено для performance)

### История команд
- Глобальная история (5000 строк, `~/.config/eTty/history/global.zsh_history`)
- Per-tab история: при создании — копия глобальной, при закрытии — мержинг новых команд
- Мьютекс для предотвращения race conditions при записи
- Восстановление истории при восстановлении вкладок
- Cleanup сиротских файлов

### Файловое дерево (sidebar)
- Lazy-load поддиректорий
- Фильтрация скрытых файлов (toggle)
- Кнопки навигации: cd .., cd ~
- fs.watch для автообновления (debounce **500мс**, было 300мс)
- Контекстные меню: новый файл/папка, rename, delete, copy, paste, копирование относительного пути, меню корневого узла
- Path traversal защита в FileManager
- Resizable sidebar (150–600px)
- Multi-select: Ctrl/Cmd+Click, Shift+Click range, Ctrl+A
- Drag-and-drop перемещение файлов/папок
- Undo (Ctrl+Z) для move-операций
- Hover overlay с кнопкой cd

### Редактор файлов (CodeMirror 6)
- Подсветка синтаксиса: JS/TS, Python, Go, Rust, HTML, CSS/SCSS, JSON, YAML, Markdown, Vue, C#
- Cmd+S — сохранение, Cmd+E — toggle панели
- Отправка выделенного кода в терминал (Cmd+Enter)
- Индикация несохранённых изменений
- Resizable панель

### Git-интеграция
- Статус-бар: `± +N -N` с polling каждые 5s
- Git panel: ветки (switch/create/delete), diff, commit, push, discard
- Подсчёт additions/deletions per file
- Поддержка untracked, modified, staged, deleted, renamed файлов

### ИИ-агенты
- Авто-детект CLI агентов в статус-баре (Claude Code, Codex, Copilot, Cursor Agent, OpenCode)
- Запуск агента в активный терминал одним кликом
- Подсветка активного агента и блокировка кнопок при busy
- Force-disable агентов в настройках
- Прокси URL для ИИ-агентов (с toggle в статус-баре)
- Quick replies — настраиваемые быстрые команды per-agent
- **Double-click** для ручного назначения активного агента

### Настройки
- Тема оформления (7 встроенных)
- Индикатор фокуса: glow, border, line, none
- Collapse children on close (file tree)
- File open mode: double-click / single-click
- Стиль промпта zsh для новых вкладок: default, short, minimal, arrow
- Сохранение в `~/.config/eTty/settings.json`

### Сохранение состояния
- Tab state: сохранение при закрытии, диалог восстановления при запуске
- Состояние дерева файлов per-tab (expanded dirs, scroll position)
- Состояние редактора per-tab (открытые файлы, активный файл)
- Состояние git-панели per-tab
- Версионирование формата (backward compat v1 → v2)

### Окно
- Frameless с кастомным drag titlebar
- hiddenInset на macOS
- Минимальные размеры 400x300
- Перетаскивание окна за titlebar даже когда табы занимают всю ширину

## IPC-каналы

| Префикс | Каналы | Назначение |
|---------|--------|-----------|
| `pty:*` | create, write, resize, kill, data, exit | PTY-сессии |
| `fs:*` | read-dir, create-file, create-dir, rename, delete, copy, move, read-file, write-file, get-cwd, set-root, watch-dir, unwatch-dir, dir-changed | Файловые операции |
| `git:*` | get-status, get-root, get-diff, get-branches, checkout, create-branch, delete-branch, commit, push, discard | Git |
| `tabs:*` | export-state, has-saved-state, load-saved-state, delete-saved-state, show-restore-dialog, trigger-restore, state-changed | Вкладки |
| `agents:*` | get-status, refresh, settings-updated | AI-агенты (детект, кэш) |
| `settings:*` | load, save | Настройки |
| `history:*` | cleanup | История |
| `window:*` | get-position, move, fullscreen-change | Окно |
| `app:*` | homedir, open-external | Системные |

## Команды

| Команда | Что делает |
|---------|-----------|
| `npm run dev` | Запустить в режиме разработки |
| `npm run build` | Скомпилировать через electron-vite → `out/` |
| `npm run dist` | Собрать macOS .dmg → `dist/` (требует предварительного `build`) |
| `npm run dist:win` | Собрать Windows NSIS (только на Windows) |
| `npm run dist:linux` | Собрать Linux AppImage/deb (только на Linux) |

## Горячие клавиши

| Комбинация | Действие |
|-----------|---------|
| `Cmd+E` / `Ctrl+E` | Toggle панели редактора |
| `Cmd+S` / `Ctrl+S` | Сохранить файл в редакторе |
| `Cmd+Enter` | Отправить выделенное из редактора в терминал |
| `Shift+Enter` | Kitty protocol: `\x1b[13;2u` |
| `Ctrl+Enter` | Kitty protocol: `\x1b[13;5u` |
| `Ctrl+Shift+Enter` | Kitty protocol: `\x1b[13;6u` |

## Зависимости (ключевые)

| Пакет | Версия | Роль |
|-------|--------|------|
| electron | 33.x | Desktop shell |
| electron-vite | 2.3.0 | Build tooling |
| xterm.js | 5.5.0 | Terminal UI (+4 addon) |
| node-pty | 1.0.0 | PTY backend (native) |
| CodeMirror | 6.x | Code editor (13 lang packages) |
| simple-git | 3.27.0 | Git operations |
| electron-builder | 26.8.1 | Packaging |
| electron-log | 5.4.3 | Logging |
| electron-updater | 6.8.3 | Auto-update (stub) |

## Сборка дистрибутива — важные детали

### node-pty (нативный модуль)

`node-pty` должен быть пересобран под целевую версию Electron **перед упаковкой**.
electron-builder делает это автоматически через `"npmRebuild": true` в секции `"build"` package.json.
`electron-rebuild` в `postinstall` — для dev-режима, не трогать.

### Конфиг electron-builder

Весь конфиг — в `package.json`, секция `"build"`. Отдельный yml не используется.

Ключевые поля:
- `appId`: `com.etty.app`
- `mac.hardenedRuntime`: `true` — обязательно для нотаризации
- `mac.entitlements` / `mac.entitlementsInherit`: `build/entitlements.mac.plist`
- `mac.notarize`: `false` по умолчанию; задай объект `{ teamId: "..." }` для реальной нотаризации
- `npmRebuild`: `true` — пересборка нативных модулей

### Entitlements для node-pty (`build/entitlements.mac.plist`)

Обязательные права для hardened runtime:
- `com.apple.security.cs.allow-jit`
- `com.apple.security.cs.allow-unsigned-executable-memory`
- `com.apple.security.cs.disable-library-validation`

Без них `node-pty` не запустится в подписанном .app.

### Переменные окружения для подписи (production)

| Переменная | Назначение |
|-----------|-----------|
| `APPLE_ID` | Apple ID для нотаризации |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | Team ID (10 символов) |
| `CSC_LINK` | Путь или base64 к .p12 сертификату |
| `CSC_KEY_PASSWORD` | Пароль к .p12 |

Если переменные не заданы — сборка использует ad-hoc подпись (smoke-test допустимо, production нельзя).

### electron-updater

В `src/main/services/app-service.js` — заглушка: импорт `autoUpdater`, `autoUpdater.logger = log`, `checkForUpdatesAndNotify()` в try/catch. Не падает без настроенного update-сервера. Полная реализация авто-обновления — отдельная фича.

## Правила работы с кодом

- Не коммитить `dist/`, `out/`, `.DS_Store`, `*.log`
- Не хранить credentials и ключи в репозитории
- Конфиг electron-builder — только в `package.json`, не создавать `electron-builder.yml`
- Entitlements — только в `build/`
- Изменения в нативных модулях требуют `npm run postinstall` (electron-rebuild)
- Ветки по фичам: `feature/<slug>`, merge в `main`
- CSS-переменные для тем определены в `styles.css :root` и переключаются через `themes.js`
- **Все IPC каналы** определяются в `shared/ipc-channels.js` — не используй строковые литералы
- **Новые компоненты** используют DI Container + EventBus, не зависят напрямую от `window.electronAPI`
- **Новые IPC handlers** добавляются в `main/ipc-handlers/` с `register*Handlers(ipcMain, deps)` сигнатурой

## Документация фич

Каждая фича имеет директорию `docs/features/<slug>/` с файлами:
- `spec.md` — требования
- `plan.md` — задачи и стратегия
- `checklist.md` — прогресс
- `starter-prompt.md` — промпт для новой сессии

Текущие фичи: `init`, `sidebar-file-tree`, `tab-persistence`, `git-panel`, `app-packaging`, `config`, `fs-watch-recursive`, `file-tree-dnd`, `quick-reply-settings`.

## Хранилище данных

| Файл | Путь | Назначение |
|------|------|-----------|
| tabs-state.json | `~/.config/eTty/` | Состояние вкладок |
| settings.json | `~/.config/eTty/` | Настройки |
| global.zsh_history | `~/.config/eTty/history/` | Глобальная история команд |
| `<tabId>.zsh_history` | `~/.config/eTty/history/tabs/` | Per-tab история |
