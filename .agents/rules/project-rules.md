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
    index.js                 — bootstrap: сервисы, IPC handlers, запуск AppService
    services/
      app-service.js         — жизненный цикл: окно, меню, автообновление, сохранение состояния
      node-version-manager.js — nvm/fnm/asdf: детект менеджера, list/install/uninstall, версия по пути node (локально и по SSH); node-version-parse.js — парсеры/валидация
    ipc-handlers/            — регистрация IPC-обработчиков по доменам
      index.js               — barrel export всех register*Handlers
      pty-handlers.js        — PTY create/write/resize/kill
      fs-handlers.js         — файловые операции
      window-handlers.js     — окно: position/move
      app-handlers.js        — системные: homedir, open external
      tabs-handlers.js       — вкладки: save/load/restore dialog
      settings-handlers.js   — настройки: load/save
      agents-handlers.js     — агенты: status/refresh
      history-handlers.js    — история: cleanup
      git-handlers.js        — Git операции: status/diff/branches/commit/push/stage/discard
      search-handlers.js     — поиск по проекту: query/cancel
      node-version-handlers.js — менеджер версий Node: list/install/uninstall/resolve (ctx для SSH)
      ssh-handlers.js         — SSH-подключения: list/save/delete/reorder, ssh:fs-retry
    pty-manager.js            — управление PTY-сессиями (node-pty + shell); для SSH дополнительно
                                 поднимает SshControlChannel через sshSessionRegistry
    file-manager.js           — файловые операции с path traversal защитой (локальная ФС)
    fs/                       — абстракция FsProvider (локальный/SSH) поверх file-manager.js
      fs-provider.js          — JSDoc-контракт FsProvider (readDir/rename/copy/move/read/write/stat/watch...)
      local-fs-provider.js    — тонкая обёртка над FileManager
      ssh-fs-provider.js      — удалённая ФС по SSH: exec() из remote-scripts.js + polling-watcher
      fs-provider-registry.js — resolve(ctx) → провайдер; отсутствие ctx = локальный (совместимость)
    ssh-store.js               — хранилище SSH-подключений (ssh-connections.json), шифрование secret через safeStorage;
                                  поле persistence ('off'|'tmux', deprecated) — только fallback обратной совместимости,
                                  режим запуска выбирается в панели (см. shared/ssh-persistence.js); tmuxSocket — настройка подключения
    ssh-command.js             — сборка argv `ssh` (ControlMaster, remote-хуки, askpass) для node-pty
    ssh/
      ssh-control-channel.js  — служебный канал по ControlMaster: -O check/exit, exec() для remote-scripts
      ssh-session-registry.js — Map<pid, {channel, caps, fsProvider, connectionId}> — живёт вместе с PTY-сессией;
                                 findLiveChannelFor() — «одолженный» канал для SshConnectionMaster
      ssh-connection-master.js — служебный ControlMaster НА ПОДКЛЮЧЕНИЕ (не на PTY) — источник списка
                                 tmux-сессий для панели, см. docs/features/ssh-tmux-sessions-panel/
      ssh-connection-master-registry.js — реестр SshConnectionMaster по connectionId, acquire/release/exec
      askpass.js               — SSH_ASKPASS-скрипт + env, общий для интерактивных вкладок и панельного мастера
      remote-shell-hooks.js   — генерация remote-команды: OSC 7/133-хуки (zsh/bash) + персистентные
                                 tmux-сессии (persistence:'tmux', см. docs/features/ssh-persistent-sessions/)
      remote-scripts.js       — POSIX sh-скрипты для readDir/rename/copy/move/read/write/stat/tmux-сессий
                                 (list/kill/rename, argv-safe)
      remote-parse.js         — чистые парсеры вывода remote-scripts.js (NUL-разделённые списки и т.п.)
    history-manager.js        — история команд (глобальная + per-tab, мержинг, мьютекс)
    tab-state.js               — сохранение/восстановление вкладок между сессиями
    settings-store.js         — оркестратор настроек: агрегирует config-loader.js + theme-loader.js
    config-loader.js          — чтение/запись `config.json` (версионирование, deep merge с дефолтами)
    theme-loader.js           — встроенные темы + загрузка пользовательских тем из `themes/*.json`
    agent-service.js          — авто-детект CLI ИИ-агентов (Claude, Codex, Copilot, Cursor, OpenCode, Qwen, Agento) + кастомные
    shell-path-resolver.js    — резолв логин-шелла и его PATH кроссплатформенно (фикс запуска из GUI/Dock)
  preload/                    — contextBridge API (~90 методов)
    index.js                  — IPC-мост: pty, fs (+ctx для SSH), window, tabs, settings, git, agents, search, node-version, ssh
  renderer/                   — UI
    index.js                  — bootstrap: DI Container, EventBus, State Store, компоненты
    core/                     — инфраструктура renderer
      event-bus.js            — централизованная шина событий
      state-store.js          — глобальное состояние с подписками
      container.js             — DI-контейнер
      diagnostics.js          — perf-диагностика (выкл. по умолчанию, `window.__diagnostics.start()`)
      adapters/
        electron-api.js       — адаптер window.electronAPI
        scoped-fs-api.js      — Proxy над electron-api: дописывает ctx (local/ssh) во все fs*/getCwd
                                 по текущей вкладке (store.get('fs.context')) — 0 правок в file-tree.js
      config/
        app-config.js         — константы приложения (debounce, интервалы, размеры)
        terminal-config.js    — константы терминала (font, scrollback)
        ui-dimensions.js      — размеры UI элементов
    features/terminal/          — терминальные фичи
      terminal-keyboard-handler.js — Kitty protocol + кириллица
      terminal-osc-handler.js      — OSC 7 (cwd), OSC 133 (busy)
      terminal-scroll-button.js    — плавающая кнопка "прокрутить вниз"
    features/ssh/                — SSH-подключения
      ssh-panel.js               — боковая панель подключений: список, CRUD, drag-and-drop;
                                    сегмент SSH/tmux — режим клика по строке, в tmux раскрывается
                                    в список сессий (SshConnectionMaster) с автополлингом и
                                    внеочередным обновлением по событию `ssh.session.activity`
                                    (открытие/закрытие/обрыв tmux-вкладки)
      ssh-connection-dialog.js   — форма добавления/редактирования подключения (без режима —
                                    он выбирается в панели, не в форме)
      ssh-tab-overlay.js         — оверлей вкладки: подключение/ошибка/подключение удалено/перехвачено
    features/git/                — модульная Git-панель (мастер/деталь)
      git-panel.js               — оркестратор: overlay, ветки, commit/push/discard
      git-file-list.js           — левая панель: список файлов по группам, staging, контекстное меню
      git-diff-view.js           — правая панель: unified diff, номера строк, word-diff
      diff-parser.js             — чистый парсинг unified diff (без DOM)
      diff-highlighter.js        — статическая подсветка синтаксиса diff-строк (Lezer)
      git-status.js              — общая метадата статус-букв (M/A/D/R/U/?/I)
    services/
      git-status-service.js     — polling git-статуса (5с), пишет в StateStore (`git.*`)
    components/base/            — UI-kit
      button/button.js
      context-menu/context-menu.js
      tabs/draggable-tabs.js    — generic drag-and-drop для вкладок
    tab-bar.js                — вкладки терминала (на DraggableTabs); setTabTmux() — бейдж/класс
                                 tab-tmux для tmux-вкладок (persistence:'tmux')
    file-tree.js               — дерево файлов с lazy-load, DnD, multi-select, undo
    editor-panel.js            — CodeMirror 6 редактор с подсветкой (20+ языков)
    editor-languages.js        — динамическая загрузка языков (code-splitting)
    editor-theme.js            — построение темы CodeMirror из THEMES
    editor-file-links.js       — CodeMirror-расширение: кликабельные пути к файлам (Cmd/Ctrl+Click)
    status-bar.js              — статус-бар: Git ±, cwd, node-версия, AI-агенты, proxy toggle
    settings-page.js           — страница настроек (overlay)
    project-search.js          — модальный диалог поиска по проекту (файлы + содержимое)
    node-version-dialog.js     — диалог менеджера версий Node (nvm/fnm/asdf)
    confirm-dialog.js          — универсальный диалог подтверждения (напр. закрытие занятой вкладки)
    icons.js                   — inline SVG-иконки
    themes.js                  — 7 встроенных тем (Catppuccin Mocha, Monokai, Dracula, One Dark, Nord, Solarized, Gruvbox)
    styles.css                 — CSS variables + стили всех компонентов
    index.html                 — HTML-разметка
  shared/
    ipc-channels.js          — константы имён IPC каналов (единый источник истины)
    binary-extensions.js     — расширения файлов, открываемых во внешнем приложении вместо редактора
    path-utils.js            — POSIX/Windows-safe пути без node:path (createPathUtils(sep)) — общий
                                 для main (SshFsProvider) и renderer (FileTree._path)
    ssh-fs-config.js         — таймауты/интервалы транспорта удалённой ФС (main не видит renderer/core/config)
    ssh-session-config.js    — константы персистентных удалённых сессий (tmux): SESSION_NAME_RE,
                                 HOOK_DIR, версии tmux, интервалы ресинка, тайминги SshConnectionMaster
    ssh-persistence.js       — resolveSshPersistence(): режим запуска SSH-вкладки (явный
                                 options.ssh.persistence либо fallback на connection.persistence) —
                                 общая для main (pty-handlers.js) и renderer (index.js, синхронно
                                 до ответа pty:create)
    ssh-session-name.js      — buildSessionNameBase()/pickFreeSessionName() — имена tmux-сессий,
                                 общие для панели (ssh-panel.js) и наследования вкладки по "+"
out/                         — артефакты electron-vite build (НЕ редактировать вручную)
dist/                        — артефакты electron-builder (НЕ коммитить)
build/                       — ресурсы для сборки (иконки, entitlements)
docs/                        — спецификации, планы, чеклисты по фичам
mobile/                      — Flutter-приложение (iOS/Android): SSH/tmux-клиент, мобильный аналог
                               десктопа. `lib/remote/` и `lib/core/config/` — ЧИСТЫЙ DART (без
                               `package:flutter`), порт `src/main/ssh/*`/`shared/*.js`; побайтовая
                               сверка — `scripts/gen-remote-fixtures.mjs` + golden-тесты. Полная
                               спецификация и план — `docs/plans/mob/`
```

`src/renderer/components/base/context-menu/context-menu.js` — единственная реализация контекстного меню в проекте; отдельного legacy `context-menu.js` в корне `renderer/` больше нет.

## Архитектурные принципы (после рефакторинга Блоков 1–4)

- **DI Container** (`core/container.js`) — все компоненты получают зависимости через constructor
- **EventBus** (`core/event-bus.js`) — коммуникация между компонентами через события
- **StateStore** (`core/state-store.js`) — централизованное состояние с подписками
- **IPC_CHANNELS** (`shared/ipc-channels.js`) — все имена каналов в одном месте, нет строковых литералов
- **IPC handlers split** — каждая доменная группа в своём файле `main/ipc-handlers/`
- **AppService** — жизненный цикл приложения в main процессе вынесен из `index.js`

## Реализованные фичи

### Терминал
- Множественные вкладки с независимыми PTY-сессиями (zsh на macOS/Linux, cmd.exe на Windows — см. `shell-path-resolver.js`)
- WebGL-ускорение рендеринга (fallback на canvas)
- Kitty keyboard protocol (Shift+Enter, Ctrl+Enter, Ctrl+Shift+Enter), per-agent режим (Kitty / newline / Ctrl+J)
- Корректная обработка кириллицы и non-ASCII символов
- OSC 7 — синхронизация директории shell → UI (zsh локально; на SSH — инжектированные remote-хуки, см. ниже)
- OSC 133 — отслеживание занятости (preexec/precmd, zsh локально и на SSH через remote-хуки)
- Scrollback **2500** строк
- Хоткей переключения соседних вкладок (`Cmd+Option+←/→` / `Cmd+Shift+←/→`, выкл. по умолчанию) — `TabBar.switchRelative()`
- Подтверждение перед закрытием занятой вкладки (`tab.close.request` → `ConfirmDialog`, если `tab.isBusy`)
- Кнопка «прокрутить вниз» при скролле в историю (`TerminalScrollButton`)

### SSH-подключения
- Панель подключений (`features/ssh/ssh-panel.js`): список, CRUD, drag-and-drop reorder (только
  в режиме SSH); хранилище — `ssh-store.js` (`ssh-connections.json`, секрет через `safeStorage`).
  Сегмент **SSH | tmux** в шапке переключает режим клика по строке: SSH — обычная вкладка,
  tmux — строка раскрывается в список tmux-сессий сервера (см. «Персистентные удалённые сессии» ниже)
- SSH-вкладка — PTY, в котором node-pty напрямую спавнит системный `ssh` (`ssh-command.js`), не библиотека
- ControlMaster-мультиплексирование (`-o ControlMaster=auto`, сокет в `os.tmpdir()/etty-cm-*`): один
  параллельный служебный канал (`SshControlChannel`) для операций удалённой ФС без повторной
  аутентификации; недоступно на Windows (OpenSSH для Windows не поддерживает мультиплексирование).
  Отдельно — `SshConnectionMaster`/`SshConnectionMasterRegistry` (`main/ssh/`): служебный мастер
  НА ПОДКЛЮЧЕНИЕ (не на PTY), для листинга/kill/rename tmux-сессий панелью без открытой вкладки;
  сперва пробует «одолжить» канал уже живой вкладки этого подключения
- Remote-хуки (`remote-shell-hooks.js`): при подключении инжектируется remote-команда, которая на
  удалённой стороне воспроизводит логику локального `_createZdotdir` — временный rc с precmd/preexec
  для OSC 7/133 (zsh и bash отдельными ветками), fallback без хуков для прочих shell (fish/csh/...).
  Настройка per-connection `injectShellIntegration` (чекбокс в форме подключения), авто-реконнект без
  remote-команды при быстром падении PTY (конфликт с `RemoteCommand`/`ForceCommand`)
- Удалённая ФС (`SshFsProvider`, `remote-scripts.js`) — POSIX sh-скрипты через `SshControlChannel.exec()`;
  весь пользовательский ввод — только позиционные параметры argv (без интерполяции в текст скрипта),
  списки — NUL-разделённые (устойчиво к пробелам/кавычкам/переводам строк в именах)
- Lazy connect: восстановленная SSH-вкладка подключается при первом переключении на неё
- Разрыв соединения не закрывает вкладку — оверлей с кнопкой «Переподключиться» (`SshTabOverlay`)
- Наследование подключения по «+» на активной SSH-вкладке
- **Персистентные удалённые сессии** (`persistence:'off'|'tmux'` — режим КОНКРЕТНОГО ЗАПУСКА
  вкладки, выбирается сегментом SSH/tmux в панели, передаётся явно с каждым `pty:create`;
  `connection.persistence` в `ssh-store.js` — только deprecated-fallback для вкладок/подключений
  без явного значения, см. `shared/ssh-persistence.js` и `docs/features/ssh-tmux-sessions-panel/`):
  вкладка подключается к именованной tmux-сессии на выделенном сокете (`-L`, свой `tmux.conf` —
  `allow-passthrough`, `prefix None`, `mouse off` (выделение мышью — нативное xterm.js, как в
  локальной вкладке; колесо эмулируется мостом `TerminalWheelHandler` через синтетический
  CSI-u биндинг, см. `docs/features/ssh-persistent-sessions/spec.md#req-2a`), RGB) вместо голого
  login-shell; конфиг догоняется на уже поднятый сервер через `source-file` (`-f` учитывается
  только при старте); разрыв связи/сон/
  перезапуск eTty не убивают процессы на сервере. Имя сессии — `etty-<8 alnum connectionId>`,
  при занятости `-2`/`-3`/… (`shared/ssh-session-name.js`) — несколько независимых сессий на одно
  подключение, каждая в своей вкладке. OSC 7/133 наружу из tmux не проходят сами по себе —
  заворачиваются в DCS-passthrough (`_etty_emit`, tmux ≥ 3.3, `PROBE_SCRIPT` детектит версию);
  на более старых tmux/без passthrough — ресинк одним запросом сразу после attach
  (`TMUX_SESSION_STATE_SCRIPT` → `ssh:session-state`). Закрытие вкладки — detach (SIGHUP
  локальному `ssh`), не kill; перехват сессии другим клиентом (`new-session -A -D`) даёт
  `exitCode 0` — отдельная ветка `SshTabOverlay.showDetached()`. Список сессий сервера (включая
  созданные не через eTty), kill/rename — панель SSH/tmux (`SshConnectionMaster`, автополлинг,
  контекстное меню). tmux-вкладка индицируется бейджем/классом `tab-tmux` в tab-bar

### История команд (zsh, macOS/Linux)
- Глобальная история (5000 строк, `~/.config/eTty/history/global.zsh_history`)
- Per-tab история: при создании — копия глобальной, при закрытии — мержинг новых команд
- Мьютекс для предотвращения race conditions при записи
- Восстановление истории при восстановлении вкладок
- Cleanup сиротских файлов

### Файловое дерево (sidebar)
- Lazy-load поддиректорий
- Фильтрация скрытых файлов (toggle)
- Кнопки навигации: cd .., cd ~
- fs.watch для автообновления локальной ФС (debounce **500мс**); для SSH — polling mtime
  раскрытых каталогов (см. `SshFsProvider`, интервал `SSH_FS_CONFIG.POLL_INTERVAL_MS`) +
  форсированный push сразу после своих мутаций
- Контекстные меню: новый файл/папка, rename, delete, copy, paste, копирование относительного пути, меню корневого узла
  («Открыть в системном эксплорере» скрыт для SSH-контекста — `FileTree._isRemote()`)
- Path traversal защита: `FileManager.validatePath` (локально) / префикс-проверка в remote-скриптах (SSH)
- Resizable sidebar (150–600px)
- Multi-select: Ctrl/Cmd+Click, Shift+Click range, Ctrl+A
- Drag-and-drop перемещение файлов/папок
- Undo (Ctrl+Z) для move-операций
- Hover overlay с кнопкой cd
- **Удалённое дерево по SSH**: читает/пишет через `FsProvider` (`src/main/fs/*`), контекст
  вкладки (`{kind:'local'}`/`{kind:'ssh', sessionId}`) хранится в `StateStore` (`fs.context`) и
  подставляется автоматически через `scoped-fs-api.js` — сам `file-tree.js` не знает о контексте
  явно (кроме `_isRemote()` для гейтинга меню). Полный CRUD; на Windows недоступно (OpenSSH для
  Windows не поддерживает ControlMaster) — деградации к локальным файлам НЕТ, дерево просто не
  синхронизируется до появления реализации на этой платформе

### Редактор файлов (CodeMirror 6)
- Подсветка синтаксиса: JS/TS, Python, Go, Rust, HTML, CSS/SCSS, JSON, YAML, Markdown, Vue, C#
- Cmd+S — сохранение, Cmd+E — toggle панели
- Отправка выделенного кода в терминал (Cmd+Enter)
- Кликабельные пути к файлам (Cmd/Ctrl+Click) — `editor-file-links.js`
- Индикация несохранённых изменений
- Resizable панель
- Сохранение позиции скролла per-file при переключении вкладок редактора/терминала (CodeMirror `scrollSnapshot()`)

### Git-интеграция
- Статус-бар: `± +N -N` с polling каждые 5s (`GitStatusService`), клик по статистике открывает панель
- Git panel (`Cmd+Shift+G`, master/detail, `features/git/*`): ветки (switch/create/delete), diff, commit, push, discard, staging
- Подсчёт additions/deletions per file
- Поддержка untracked, modified, staged, deleted, renamed, ignored файлов
- Git diff highlighting — gutter bars в дереве файлов и редакторе, автообновление по polling + на `Cmd+S`

### Поиск по проекту
- Модальный диалог (`Cmd+F` / double-tap `Shift`), поиск по именам файлов и содержимому одновременно
- Опции: case sensitive, whole word, regex, include/exclude glob
- Отменяемые запросы: `SEARCH_QUERY` / `SEARCH_CANCEL`, live-превью с подсветкой совпадений

### ИИ-агенты
- Авто-детект CLI агентов в статус-баре (Claude Code, Codex, Copilot, Cursor Agent, OpenCode, Qwen, Agento) — только локально, для SSH-вкладок не выполняется
- Кастомные агенты (label, launchCommand, опциональный checkCommand) — доступны наравне со встроенными
- Запуск агента в активный терминал одним кликом
- Подсветка активного агента и блокировка кнопок при busy
- Double-click — ручное назначение активного агента, когда busy без авто-детекта
- Force-disable агентов в настройках
- Прокси URL для ИИ-агентов (с toggle в статус-баре)
- Quick replies — настраиваемые быстрые команды per-agent, drag-and-drop reorder, группировка (дерево с DnD в настройках, группа — кнопка с выпадающим меню в статус-баре, видимость наследуется от ответов)
- Per-agent режим Shift+Enter: Kitty protocol / newline / Ctrl+J
- **Отслеживание busy на SSH-вкладках**: честный сигнал — инжектированные remote-хуки (OSC 133,
  см. `remote-shell-hooks.js`), с авто-реконнектом без remote-команды при конфликте с
  `RemoteCommand`/`ForceCommand`. Пока хуки не подтвердились (таймаут `SSH_HOOK_DETECT_TIMEOUT_MS`)
  или инжект выключен в настройках подключения — оптимистичный busy при запуске агента с кнопкой
  ручного сброса «Агент завершён» в панели быстрых команд (`StatusBar._createClearOptimisticBusyButton`)

### Менеджер версий Node.js
- Определение установленного менеджера: nvm, fnm, asdf (`NodeVersionManager`)
- List/switch/install/uninstall версий из диалога (`NodeVersionDialog`)
- Индикатор текущей версии в статус-баре, клик открывает диалог

### Кроссплатформенность
- macOS, Windows, Linux — нативные оконные контролы (frameless на macOS, min/max/close на Windows/Linux)
- `ShellPathResolver` — резолв логин-шелла и его PATH независимо от способа запуска (Dock/Start Menu, а не только из терминала)
- Сборка: `npm run dist` (macOS), `dist:win` (NSIS), `dist:linux` (AppImage/deb)

### Настройки
- Тема оформления (7 встроенных + пользовательские из `themes/*.json`, `theme-loader.js`)
- Roboto — глобальный шрифт приложения (не настраивается пользователем)
- Индикатор фокуса: glow, border, line, none
- Collapse children on close (file tree)
- File open mode: double-click / single-click
- Стиль промпта для новых вкладок (zsh): default, short, minimal, arrow
- Размер статус-бара: compact / standard / large
- Размещение новой вкладки: `modifierAdjacent` / `modifierEnd`
- Сохранение в `~/.config/eTty/config.json` (версионируется, deep merge с дефолтами — `config-loader.js`)

### Сохранение состояния
- Tab state: сохранение при закрытии, диалог восстановления при запуске
- Состояние дерева файлов per-tab (expanded dirs, scroll position)
- Состояние редактора per-tab (открытые файлы, активный файл)
- Состояние git-панели per-tab
- Версионирование формата (backward compat v1 → v2)

### Окно
- Frameless с кастомным drag titlebar (macOS), нативные контролы на Windows/Linux
- hiddenInset на macOS
- Минимальные размеры 400x300
- Перетаскивание окна за titlebar даже когда табы занимают всю ширину

### Мобильное приложение (`mobile/`, Flutter — iOS/Android)
- Мобильный аналог десктопа: SSH/tmux-клиент на `dartssh2` + `xterm` (см. `mobile/README.md`,
  спецификация — `docs/plans/mob/plan.md`). State management / DI — `flutter_riverpod`
  (аналог DI Container + StateStore десктопа)
- **Персистентные tmux-сессии** — тот же сокет/конфиг/hooks, что на десктопе (REQ-2), поэтому одна
  сессия шарится между десктопом и телефоном; `lib/remote/` — побайтовый порт
  `remote-scripts`/`remote-parse`/`remote-shell-hooks`, сверяется golden-тестами
- **Единый «протокол eTty»**: `lib/remote/` и `lib/core/config/` не импортируют `package:flutter`
  (чистый Dart, тестируется и переносится независимо от UI). Golden-фикстуры
  (`mobile/test/fixtures/remote/`) генерируются из JS десктопа скриптом
  `scripts/gen-remote-fixtures.mjs` и коммитятся; CI сверяет их (`--check`)
- Удалённая ФС (`SshFsProvider`), редактор (`re_editor`), панель tmux-сессий сервера,
  биометрическая блокировка (`local_auth`), импорт профилей `.ettyx` (общий с десктопом
  PBKDF2 + AES-256-GCM формат)
- **Жесты терминала** (`ui/terminal/terminal_gestures.dart`) — скролл, свайп двумя пальцами
  (стрелки), тап (клик мышью в TUI), long-press (выделение). На alternate screen истории tmux нет,
  поэтому прокрутка транслируется в `PgUp`/`PgDn` (шаг — `TerminalGestureConfig.altBufferPageLines`)
- **Колесо быстрых действий** и **колесо своих команд** — круговые меню по долгому тапу и двойному
  тапу двумя пальцами (`ui/terminal/quick_action_wheel.dart`); состав/порядок редактируются в
  Настройки → «Быстрые действия» / «Быстрые команды» (`ui/settings/quick_actions_screen.dart`,
  `quick_commands_screen.dart`), конфиг — `core/config/quick_actions_config.dart`,
  домены — `domain/quick_actions.dart` / `domain/quick_commands.dart`
- **Вложение фото/файла** — `domain/attachment_upload.dart` грузит выбранный файл на сервер
  в `$TMPDIR/etty-paste/` и вставляет путь в терминал
- **Панель клавиш** (`ui/terminal/key_bar.dart`) — Esc/Tab/стрелки/модификаторы + Shift+Enter
  (kitty-последовательность `\x1b[13;2u`)
- Иконка/splash генерируются из desktop-иконки (`build/icon.png`) через `flutter_launcher_icons` /
  `flutter_native_splash` (`mobile/assets/icon/`, конфиг — в `mobile/pubspec.yaml`)

## IPC-каналы

Полный список констант — `src/shared/ipc-channels.js` (единственный источник истины, не дублировать строковыми литералами).

| Префикс | Каналы | Назначение |
|---------|--------|-----------|
| `pty:*` | create, write, resize, kill, data, exit | PTY-сессии |
| `fs:*` | read-dir, create-file, create-dir, rename, delete, delete-many, copy, copy-many, move, read-file, write-file, stat-file, get-cwd, set-root, watch-dir, unwatch-dir, dir-changed | Файловые операции (все каналы принимают опциональный `ctx` — `{kind:'local'}`/`{kind:'ssh', sessionId}`, см. `fs-provider-registry.js`) |
| `git:*` | get-status, get-root, get-diff, get-branches, checkout, create-branch, delete-branch, commit, push, discard, stage, unstage, discard-file | Git |
| `tabs:*` | export-state, has-saved-state, load-saved-state, delete-saved-state, show-restore-dialog, trigger-restore, state-changed, auto-save | Вкладки |
| `agents:*` | get-status, refresh, settings-updated | AI-агенты (детект, кэш, кастомные) |
| `settings:*` | load, save | Настройки (`config.json` + темы) |
| `history:*` | cleanup | История |
| `window:*` | get-position, move, fullscreen-change, minimize, maximize, close, is-maximized, maximized-change | Окно |
| `app:*` | homedir, open-external | Системные |
| `search:*` | query, cancel | Поиск по проекту |
| `node-version:*` | resolve, list-installed, list-remote, install, uninstall, detect-manager, install-manager (все с `ctx`) | Менеджер версий Node.js |
| `clipboard:upload-image` | upload-image | Загрузка изображения из буфера на SSH-хост (вставка картинок в SSH-вкладках) |
| `ssh:*` | list, save, delete, reorder, fs-ready (push), fs-retry, session-state (push), tmux-missing (push), master-acquire, master-release, sessions-list, session-kill, session-rename | SSH-подключения + готовность удалённой ФС + ресинк tmux-сессии + панель tmux-сессий (SshConnectionMaster) |

## Команды

| Команда | Что делает |
|---------|-----------|
| `npm run dev` | Запустить в режиме разработки |
| `npm run build` | Скомпилировать через electron-vite → `out/` |
| `npm run dist` | Собрать macOS .dmg → `dist/` (требует предварительного `build`) |
| `npm run dist:win` | Собрать Windows NSIS (только на Windows) |
| `npm run dist:linux` | Собрать Linux AppImage/deb (только на Linux) |

### Мобильное приложение (`mobile/`)

| Команда | Что делает |
|---------|-----------|
| `cd mobile && flutter pub get` | Установить зависимости |
| `cd mobile && flutter analyze` | Статический анализ |
| `cd mobile && flutter test` | Unit + golden тесты |
| `cd mobile && flutter run` | Запустить на устройстве/симуляторе |
| `node scripts/gen-remote-fixtures.mjs` | Перегенерировать golden-фикстуры из JS десктопа |
| `node scripts/gen-remote-fixtures.mjs --check` | Проверить, что фикстуры не разошлись (CI) |
| `cd mobile && dart run flutter_launcher_icons` | Перегенерировать иконки приложения |
| `cd mobile && dart run flutter_native_splash:create` | Перегенерировать splash |

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

**Troubleshooting:** терминал не открывается (сессия PTY не создаётся) — пересобрать `node-pty` вручную: `npx electron-rebuild`.

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

## Стиль кода

Нет ESLint/Prettier — соблюдай стиль вручную по образцу соседних файлов.

- **ES modules:** `import`/`export`, относительные импорты с явным расширением `.js` (`from '../file-manager.js'`)
- **Без точек с запятой** — ни в main, ни в renderer
- **Одинарные кавычки** для строк
- **2 пробела** отступ
- **JSDoc** — выборочно: обязателен на `register*Handlers(ipcMain, deps)` (описывает форму `deps`), необязателен на приватных методах компонентов
- **Комментарии** объясняют WHY (неочевидный инвариант, обходной путь, причина решения), не WHAT — не пересказывай то, что уже понятно из кода
- **Язык комментариев** в коде смешанный (RU/EN) — новый комментарий пиши на языке, преобладающем в файле, который редактируешь
- **Обработка ошибок в IPC handlers** — единого паттерна нет, соответствуй соседним хендлерам в том же файле:
  - `fs-handlers.js`, `search-handlers.js` — `try { return await ... } catch (e) { return { success: false, error: e.message } }`
  - `git-handlers.js` — `try { ... } catch (err) { return { error: err.message } }` или доменный fallback (`{ notARepo: true }`, `null`, `''`) для операций чтения
  - остальные домены — без try/catch, ошибка пробрасывается как rejected promise `ipcRenderer.invoke()`

## Документация фич

Каждая фича имеет директорию `docs/features/<slug>/` с файлами:
- `spec.md` — требования
- `plan.md` — задачи и стратегия
- `checklist.md` — прогресс
- `starter-prompt.md` — промпт для новой сессии

Текущие фичи: `init`, `sidebar-file-tree`, `tab-persistence`, `git-panel`, `app-packaging`, `config`, `fs-watch-recursive`, `file-tree-dnd`, `quick-reply-settings`, `project-search`, `git-diff-highlight`, `custom-ai-agents`, `editor-file-sync`, `statusbar-size`, `quick-reply-groups`, `ssh-persistent-sessions`, `ssh-tmux-sessions-panel`.

## Хранилище данных

| Файл | Путь | Назначение |
|------|------|-----------|
| tabs-state.json | `~/.config/eTty/` | Состояние вкладок |
| config.json | `~/.config/eTty/` | Настройки (версионируется, см. `config-loader.js`) |
| themes/*.json | `~/.config/eTty/themes/` | Пользовательские темы (см. `theme-loader.js`) |
| global.zsh_history | `~/.config/eTty/history/` | Глобальная история команд |
| `<tabId>.zsh_history` | `~/.config/eTty/history/tabs/` | Per-tab история |

## Архитектурные инварианты

Обязательны при **любом** изменении кода. Нарушение = замечание на code review.

| Инвариант | Правило | Где проверить |
|-----------|---------|---------------|
| DI | Зависимости через constructor, не через глобалы | `core/container.js` |
| EventBus | Коммуникация между компонентами — через события | `core/event-bus.js` |
| StateStore | Shared state — в сторе, не в приватных полях | `core/state-store.js` |
| IPC_CHANNELS | Все имена каналов — из `shared/ipc-channels.js` | `shared/ipc-channels.js` |
| Config | Константы (числа, интервалы) — в `core/config/` | `core/config/*.js` |
| Cleanup | Каждый компонент с подписками имеет `destroy()` | — |
| Адаптер | Нет прямых `window.electronAPI` — через `core/adapters/electron-api.js` | `core/adapters/` |
| Golden-паритет | `mobile/lib/remote/*` и `mobile/lib/core/config/*` побайтово совпадают с `src/main/ssh/*`/`shared/*.js` | `scripts/gen-remote-fixtures.mjs` |

## Чеклисты

При создании нового кода — следуй чеклисту соответствующего типа:

| Тип изменения | Чеклист |
|---------------|---------|
| Новый UI-компонент | [new-component.md](checklists/new-component.md) |
| Новый IPC-обработчик | [new-ipc-handler.md](checklists/new-ipc-handler.md) |
| Новая фича (общий) | [new-feature.md](checklists/new-feature.md) |
| Проверка качества | [code-quality.md](checklists/code-quality.md) |

## Скиллы проекта

| Скилл | Команда | Когда использовать |
|-------|---------|--------------------|
| Feature Planning | `/feature-planning` | Планирование новой фичи: от идеи до промпта |
| Feature Accept | `/feature-accept` | Принятие готовой фичи: merge, cleanup, документация |
| Code Review | `/code-review` | Проверка кода на соответствие архитектуре перед коммитом |
| Bugfix | `/bugfix` | Диагностика и исправление бага (без feature-planning) |
