# Спецификация: Выбор tmux-сессий, папка запуска и скрытые файлы (mobile)

## Контекст

Мобильное приложение eTty (`mobile/`, Flutter, ветка `feature/mobile-app`) уже умеет подключаться по SSH, открывать вкладки терминала поверх персистентных tmux-сессий и показывать удалённое дерево файлов. Три пробела:

1. **Выбор сессии.** `TmuxSessionsSheet` (`lib/ui/connections/tmux_sessions_sheet.dart`) показывает сессии сервера (метка «активна · N» у attached, kill, rename), но открывается только из списка подключений и не позволяет открыть сессию тапом. Сессию, созданную другим клиентом, подключить нельзя.
2. **Папка запуска.** Новая tmux-сессия всегда стартует в `$HOME`: `RemoteShellHooks.buildRemoteInitCommand` не принимает стартовый каталог.
3. **Скрытые файлы.** `readDir` отдаёт все записи, дерево показывает дотфайлы всегда, отключить нельзя.

Как это вписывается в существующую архитектуру:
- `TabController(sessionName: …)` уже принимает имя сессии; команда запуска содержит `new-session -A -D -s "$n"`, то есть открытие вкладки с именем существующей сессии = attach с отцепкой прежнего клиента (REQ-12 исходного плана `docs/plans/mob/plan.md`). Прежняя вкладка получает статус `intercepted`.
- Дерево файлов открывается отдельным экраном (`RemoteFileTreeScreen`) со своим подключением и возвращается в `TerminalPage`.
- Настройки уровня приложения живут в `AppSettingsStore` (`SecureAppSettingsStore`, поверх Keychain/Keystore), провайдеры — в `lib/app/providers/`.

Выбранный подход к стартовой папке (согласован с пользователем): параметр `startDir` в `buildRemoteInitCommand`, путь кодируется побайтово в `printf '\ooo…'`; при `startDir == null` вывод не меняется ни на байт.

## Требования

### Выбор сессий

- **REQ-1.** `TmuxSessionsSheet` принимает колбэк `onSelect(String sessionName)`. Тап по строке сессии вызывает его (тап по кнопкам rename/kill строку не выбирает).
- **REQ-2.** Сессии с `attached > 0` визуально выделены (цвет фона плитки + метка «активна · N»); свободные выглядят как раньше.
- **REQ-3.** Тап по активной сессии (`attached > 0`) сначала показывает диалог «Перехватить сессию? Прежний клиент будет отключён» с кнопками «Отмена» / «Перехватить»; `onSelect` вызывается только после подтверждения. Свободная сессия выбирается без диалога.
- **REQ-4.** Сессии, чьё имя не проходит `SshSessionConfig.sessionNameRe` (`^[A-Za-z0-9_-]{1,64}$`), в списке остаются, но не выбираются: плитка неактивна, в подзаголовке пометка «имя не поддерживается». `buildRemoteInitCommand` бросает `ArgumentError` на таких именах — до этого доводить нельзя.
- **REQ-5.** В AppBar `TerminalPage` рядом с кнопкой «Файлы» добавлена кнопка «Сессии» (скрыта, если `profile.persistence != 'tmux'`). Она открывает `TmuxSessionsSheet` с сервисом, построенным на уже открытом `SshConnection` терминала — без второго подключения; закрытие панели не закрывает общее подключение.
- **REQ-6.** Вход из списка подключений остаётся. Выбор сессии там открывает `TerminalPage` с новым параметром `initialSessionName`: первая вкладка создаётся с этой сессией вместо автоимени.
- **REQ-7.** `TerminalPage` открывает выбранную сессию методом `_openSession(name)`: если вкладка с таким `sessionName` уже есть — переключается на неё (дубль не создаётся, иначе `-D` отцепит собственную вкладку); иначе создаёт вкладку `TabController(sessionName: name)`.

### Папка запуска

- **REQ-8.** `RemoteShellHooks.buildRemoteInitCommand` получает необязательный `String? startDir`. Действует только при `persistence == 'tmux'`: к `new-session` добавляется `-c "$d"`, где `d` — путь, закодированный как `printf` с восьмеричными escape-последовательностями каждого байта UTF-8. При `startDir == null` вывод побайтово равен текущему (golden-фикстуры не меняются).
- **REQ-9.** Валидация `startDir`: абсолютный POSIX-путь, без NUL и перевода строки/возврата каретки; иначе `ArgumentError`. Инвариант L0 (`_assertL0Safe`: нет `'` и `!` в INNER) сохраняется для любого допустимого пути, включая `'`, `!`, пробел, `$`, кириллицу.
- **REQ-10.** `TabController` принимает необязательный `startDir` и передаёт его в `buildRemoteInitCommand`. Авто-ретрай без хуков (`_hooksForThisAttempt`) и переподключение сохраняют `startDir`. Для уже существующей сессии `-c` tmux игнорирует — это ожидаемо.
- **REQ-11.** В меню узла-папки дерева файлов (и для корня) есть пункт «Запустить tmux-сессию здесь». Он закрывает `RemoteFileTreeScreen` через `Navigator.pop(path)`; `TerminalPage` создаёт вкладку с `startDir: path` и свободным автоименем (`pickFreeSessionName`). Для файлов пункта нет; при `persistence != 'tmux'` — скрыт.

### Скрытые файлы

- **REQ-12.** `FileTreeController.showHidden` (по умолчанию `false`). Узел скрыт, если его `name` начинается с `.`. Фильтрация клиентская: `readDir`/`SshFsProvider` не меняются, переключение мгновенное и без запроса к серверу. Скрытие применяется ко всем уровням и к файлам, и к папкам; корневой узел не скрывается никогда.
- **REQ-13.** В AppBar `RemoteFileTreeScreen` есть переключатель (иконка «глаз»/«глаз перечёркнутый», tooltip «Показать скрытые» / «Скрыть скрытые»).
- **REQ-14.** Значение запоминается между запусками и общее для всех подключений: `AppSettingsStore.getShowHiddenFiles/setShowHiddenFiles` (ключ `etty.settings.showHiddenFiles`, значение `'true'`/отсутствует = `false`) + `showHiddenFilesProvider` (`AsyncNotifier<bool>`, по образцу `biometricLockEnabledProvider`). Новая зависимость (`shared_preferences`) не добавляется.
- **REQ-15.** Состояние раскрытия узлов не теряется при переключении: скрытая папка при повторном показе остаётся раскрытой, если была раскрыта.

## Ограничения

- Не входит: отдельный диалог выбора папки (только пункт меню дерева), фильтр по `.gitignore`, правка десктопа (`src/`), создание сессии с произвольным именем при выборе папки, серверный фильтр скрытых (`find ! -name '.*'`).
- Не менять протокол/вывод `buildRemoteInitCommand` при `startDir == null` (паритет с десктопом, REQ-2/инвариант L0 исходного плана; сверка `node scripts/gen-remote-fixtures.mjs --check` должна проходить).
- `lib/remote/` и `lib/core/config/` остаются чистым Dart без `package:flutter`.
- tmux `new-session -c` поддерживается всеми поддерживаемыми версиями tmux (≥ 1.9); отдельной проверки версии не требуется.
- Папка запуска — только для новой сессии; при совпадении имён поведение определяет `-A`.
- Секреты и host keys не затрагиваются.

## Макеты и референсы

Не применимо: макетов нет. Образцы поведения и визуала — существующий `TmuxSessionsSheet` (плитки, чип «активна»), `FileTree` (PopupMenu узла), настройка «Биометрическая блокировка» в `SettingsScreen`.

## Кодстайл и конвенции

- Dart: `flutter analyze` без замечаний; стиль файла-соседа (доки `///` на русском, объясняющие «почему», `key: Key('…')` у элементов, на которые ссылаются тесты).
- Слои проекта: логика — `domain/`, `remote/`; хранилища — `data/`; провайдеры — `app/providers/`; UI — `ui/*` (виджеты тонкие, логика тестируется отдельно, как `FileTreeController`).
- Валидация имён/путей на обеих сторонах границы (как `sessionNameRe` в `TmuxSessionsService._validateName`): ошибки — `ArgumentError`/типизированные исключения, а не молчаливые фоллбеки.
- Тесты: golden-тесты `test/golden/remote_shell_hooks_golden_test.dart` не менять; новые тесты на `startDir` — отдельный файл `test/remote/remote_shell_hooks_start_dir_test.dart`. Виджет-тесты — рядом с существующими (`test/ui/connections/`, `test/ui/files/`) на фейковом `RemoteExec`.
- Коммиты: без упоминаний Claude/Anthropic (глобальное правило пользователя); формат `feat: …`.

## Переиспользуемые решения

- `lib/ui/connections/tmux_sessions_sheet.dart` — `TmuxSessionsSheet`, `TmuxSessionsHandle`, `_SessionTile`: расширяются, не переписываются; тест `test/ui/connections/tmux_sessions_sheet_test.dart` — образец фабрики с фейковым сервисом.
- `lib/ui/connections/connections_screen.dart` — `_openTmuxSessions`, `_createTmuxSessionsHandle`: точка входа из списка подключений.
- `lib/domain/tmux_sessions.dart` — `TmuxSessionsService` без изменений.
- `lib/remote/remote_parse.dart` — `TmuxSessionInfo.attached`.
- `lib/remote/remote_shell_hooks.dart` — `buildRemoteInitCommand`, `posixDquote`, `_assertL0Safe`.
- `lib/remote/session_name.dart` — `pickFreeSessionName`, `buildSessionNameBase`.
- `lib/domain/tab_controller.dart` — `TabController` (параметр `sessionName` уже есть).
- `lib/ui/terminal/terminal_page.dart` — `_addTab`, `_TerminalTab`, `IndexedStack` вкладок, кнопка «Файлы» в AppBar (образец для кнопки «Сессии»).
- `lib/ui/files/file_tree.dart`, `file_tree_controller.dart` — `_NodeMenuAction`/PopupMenu, `_visibleNodes()`; `remote_file_tree_screen.dart` — AppBar и возврат результата.
- `lib/data/app_settings_store.dart` + `lib/app/providers/app_lock_providers.dart` — образец настройки (`SecureAppSettingsStore`, `AsyncNotifier`).
- `lib/main.dart` — `_RootShell`: открытие `TerminalPage(profile, onBack)`, место проброса `initialSessionName`.

## Критерии приёмки

- [ ] Из терминала кнопка «Сессии» открывает список сессий сервера; активные подсвечены; свободная открывается в новой вкладке тапом.
- [ ] Тап по активной сессии спрашивает подтверждение; после «Перехватить» сессия открывается в новой вкладке, а вкладка прежнего клиента показывает «перехвачено».
- [ ] Выбор уже открытой локально сессии переключает на её вкладку, дубль не создаётся.
- [ ] Из списка подключений выбор сессии открывает терминал сразу на ней.
- [ ] Сессии с неподдерживаемым именем видны, но не открываются и объясняют почему.
- [ ] «Запустить tmux-сессию здесь» на папке `/home/u/my dir` открывает вкладку, где `pwd` = эта папка; то же для пути с `'`, `!`, `$` и кириллицей.
- [ ] Для профиля с `persistence == off` кнопка «Сессии» и пункт «Запустить tmux-сессию здесь» отсутствуют.
- [ ] Дотфайлы в дереве по умолчанию скрыты; иконка «глаз» показывает/скрывает их мгновенно; выбор переживает перезапуск и общий для подключений; раскрытые папки не сворачиваются.
- [ ] `buildRemoteInitCommand` без `startDir` совпадает с golden-фикстурами; `node scripts/gen-remote-fixtures.mjs --check` проходит.
- [ ] `flutter analyze` чист, `flutter test` зелёный (включая новые тесты на `startDir`, sheet, дерево, `showHidden`).
- [ ] Ручная проверка на реальном сервере/телефоне по трём сценариям выше (tmux-сервер домашний, Tailscale).
- Визуальное соответствие макету: не применимо (макетов нет).

## Затронутые файлы

Изменяются:
- `mobile/lib/remote/remote_shell_hooks.dart` — `startDir`, кодирование пути, `-c`.
- `mobile/lib/domain/tab_controller.dart` — параметр `startDir`.
- `mobile/lib/ui/connections/tmux_sessions_sheet.dart` — `onSelect`, подсветка, диалог перехвата, неподдерживаемые имена.
- `mobile/lib/ui/connections/connections_screen.dart` — выбор сессии → открытие терминала.
- `mobile/lib/main.dart` — `initialSessionName` в `TerminalPage`.
- `mobile/lib/ui/terminal/terminal_page.dart` — кнопка «Сессии», `_openSession`, приём результата дерева (`startDir`), `initialSessionName`.
- `mobile/lib/ui/files/file_tree.dart`, `file_tree_controller.dart` — `showHidden`, пункт меню «Запустить tmux-сессию здесь», колбэк.
- `mobile/lib/ui/files/remote_file_tree_screen.dart` — переключатель, `Navigator.pop(path)`.
- `mobile/lib/data/app_settings_store.dart` — `get/setShowHiddenFiles`.
- `mobile/lib/app/providers/app_lock_providers.dart` или новый `app/providers/file_tree_providers.dart` — `showHiddenFilesProvider`.

Новые тесты:
- `mobile/test/remote/remote_shell_hooks_start_dir_test.dart`
- дополнения: `test/ui/connections/tmux_sessions_sheet_test.dart`, `test/ui/connections/connections_screen_test.dart`, `test/ui/files/file_tree_test.dart`, `test/domain/tab_controller_test.dart`.
