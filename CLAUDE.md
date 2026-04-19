# CLAUDE.md — контекст для AI-агентов

## Проект

eTty — Electron-приложение-обёртка терминала. Stack: **Electron 33**, **electron-vite**, **xterm.js**, **node-pty**, **CodeMirror 6**, **simple-git**.

## Структура директорий

```
src/
  main/            — main-процесс Electron
    index.js         — точка входа, окно, IPC-обработчики, меню
    pty-manager.js   — управление PTY-сессиями (node-pty + zsh)
    file-manager.js  — файловые операции с path traversal защитой
    git-service.js   — Git-операции через simple-git
    history-manager.js — история команд (глобальная + per-tab, мержинг, мьютекс)
    tab-state.js     — сохранение/восстановление вкладок между сессиями
    settings-store.js — настройки приложения (JSON, deep merge)
  preload/           — contextBridge API (~45 методов)
    index.js         — IPC-мост: pty, fs, window, tabs, settings, git
  renderer/          — UI
    index.js         — инициализация, оркестрация компонентов
    tab-bar.js       — управление вкладками терминала
    file-tree.js     — дерево файлов с lazy-load, контекстными меню
    editor-panel.js  — CodeMirror 6 редактор с подсветкой (20+ языков)
    editor-languages.js — динамическая загрузка языков (code-splitting)
    editor-theme.js  — построение темы CodeMirror из THEMES
    git-panel.js     — UI Git: ветки, diff, commit, push, discard
    status-bar.js    — статус-бар с Git-статистикой (polling 5s)
    settings-page.js — страница настроек
    context-menu.js  — контекстное меню
    themes.js        — 7 тем (Catppuccin Mocha, Monokai, Dracula, One Dark, Nord, Solarized, Gruvbox)
    styles.css       — CSS variables + стили всех компонентов
    index.html       — HTML-разметка
out/               — артефакты electron-vite build (НЕ редактировать вручную)
dist/              — артефакты electron-builder (НЕ коммитить)
build/             — ресурсы для сборки (иконки, entitlements)
docs/              — спецификации, планы, чеклисты по фичам
```

## Реализованные фичи

### Терминал
- Множественные вкладки с независимыми PTY-сессиями (zsh)
- WebGL-ускорение рендеринга (fallback на canvas)
- Kitty keyboard protocol (Shift+Enter, Ctrl+Enter, Ctrl+Shift+Enter)
- Корректная обработка кириллицы и non-ASCII символов
- OSC 7 — синхронизация директории shell → UI
- OSC 133 — отслеживание занятости (preexec/precmd)
- Scrollback 10000 строк

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
- fs.watch для автообновления (debounce 300ms)
- Контекстные меню: новый файл/папка, rename, delete, copy, paste
- Path traversal защита в FileManager
- Resizable sidebar (150–600px)

### Редактор файлов (CodeMirror 6)
- Подсветка синтаксиса: JS/TS, Python, Go, Rust, HTML, CSS/SCSS, JSON, YAML, Markdown
- Cmd+S — сохранение, Cmd+E — toggle панели
- Отправка выделенного кода в терминал (Cmd+Enter)
- Индикация несохранённых изменений
- Resizable панель

### Git-интеграция
- Статус-бар: `± +N -N` с polling каждые 5s
- Git panel: ветки (switch/create/delete), diff, commit, push, discard
- Подсчёт additions/deletions per file
- Поддержка untracked, modified, staged, deleted, renamed файлов

### Настройки
- Тема оформления (7 встроенных)
- Collapse children on close (file tree)
- File open mode: double-click / single-click
- Сохранение в `~/.config/eTty/settings.json`

### Сохранение состояния
- Tab state: сохранение при закрытии, диалог восстановления при запуске
- Состояние дерева файлов per-tab (expanded dirs, scroll position)
- Версионирование формата (backward compat v1 → v2)

### Окно
- Frameless с кастомным drag titlebar
- hiddenInset на macOS
- Минимальные размеры 400x300

## IPC-каналы

| Префикс | Каналы | Назначение |
|---------|--------|-----------|
| `pty:*` | create, write, resize, kill, data, exit | PTY-сессии |
| `fs:*` | read-dir, create-file, create-dir, rename, delete, copy, read-file, write-file, get-cwd, set-root, watch-dir, unwatch-dir, dir-changed | Файловые операции |
| `git:*` | get-status, get-root, get-diff, get-branches, checkout, create-branch, delete-branch, commit, push, discard | Git |
| `tabs:*` | export-state, has-saved-state, load-saved-state, delete-saved-state, show-restore-dialog, trigger-restore, state-changed | Вкладки |
| `settings:*` | load, save | Настройки |
| `history:*` | cleanup | История |
| `window:*` | get-position, move | Окно |
| `app:*` | homedir | Системные |

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
| CodeMirror | 6.x | Code editor (12 lang packages) |
| simple-git | 3.27.0 | Git operations |
| electron-builder | 26.8.1 | Packaging |

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

В `src/main/index.js` — заглушка: импорт `autoUpdater`, `autoUpdater.logger = log`, `checkForUpdatesAndNotify()` в try/catch. Не падает без настроенного update-сервера. Полная реализация авто-обновления — отдельная фича.

## Правила работы с кодом

- Не коммитить `dist/`, `out/`, `.DS_Store`, `*.log`
- Не хранить credentials и ключи в репозитории
- Конфиг electron-builder — только в `package.json`, не создавать `electron-builder.yml`
- Entitlements — только в `build/`
- Изменения в нативных модулях требуют `npm run postinstall` (electron-rebuild)
- Ветки по фичам: `feature/<slug>`, merge в `main`
- CSS-переменные для тем определены в `styles.css :root` и переключаются через `themes.js`

## Документация фич

Каждая фича имеет директорию `docs/features/<slug>/` с файлами:
- `spec.md` — требования
- `plan.md` — задачи и стратегия
- `checklist.md` — прогресс
- `starter-prompt.md` — промпт для новой сессии

Текущие фичи: `init`, `sidebar-file-tree`, `tab-persistence`, `git-panel`, `app-packaging`.

## Хранилище данных

| Файл | Путь | Назначение |
|------|------|-----------|
| tabs-state.json | `~/.config/eTty/` | Состояние вкладок |
| settings.json | `~/.config/eTty/` | Настройки |
| global.zsh_history | `~/.config/eTty/history/` | Глобальная история команд |
| `<tabId>.zsh_history` | `~/.config/eTty/history/tabs/` | Per-tab история |
