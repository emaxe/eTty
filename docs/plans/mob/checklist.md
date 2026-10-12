# Чеклист реализации: eTty Mobile

Спецификация и план — [plan.md](./plan.md).

## Подготовка
- [x] Прочитан `AGENTS.md` и `.agents/rules/project-rules.md`
- [x] Прочитан `plan.md` целиком
- [x] Создана ветка `feature/mobile-app` (базовая ветка для merge — `main`)

## Блок 0 — Подготовка
- [x] #1 План и чеклист записаны в `docs/plans/mob/`, ветка создана
- [x] #2 Скаффолд Flutter-проекта `mobile/`, зависимости, README запуска

## Блок S — Спайки (после #2, до блока 2; код спайков не мержится)
- [x] S1 xterm.dart: OSC 7/133/52 доходят до `onPrivateOSC`; DCS-tmux НЕ парсится (мусор на экране без перехвата); soft-keyboard ввод минует `inputHandler` — sticky-Ctrl только через `onOutput`
- [x] S2 `execute(cmd, pty:)` vs `ssh -tt` — подтверждено на живом сервере для non-tmux (PTY/TERM/resize корректны); tmux-реаттач не проверялся (нужно разрешение на изменение состояния сервера)
- [x] S3 `onVerifyHostKey`/`onPasswordRequest`/`onUserInfoRequest` — все асинхронны (`FutureOr`), план Б отменён
- [x] S4 keepalive в dartssh2 подтверждён (встроенный, `SSHClient.done`); время жизни сокета в фоне на iOS — остаётся открытым (нужен реальный девайс)
- [x] S5 `re_editor`/`re_highlight` на файле ~1 МБ — 74/737/52 мс, без деградации; решение — `fromTextAsync` + индикатор
- [x] S6 бюджет параллельных каналов — подтверждён на живом сервере (`MaxSessions=10` дефолт, до 8 каналов стабильно), лимит 4 обоснован

## Блок 1 — Протокол и golden-тесты
- [x] #3 `scripts/gen-remote-fixtures.mjs` + первые fixtures
- [x] #4 Порт констант (`ssh_session_config`, `ssh_fs_config`) и `path_utils`
- [x] #5 Порт `remote_scripts.dart` + golden
- [x] #6 Порт `buildRemoteInitCommand` + `posix_quote` + golden (инвариант L0)
- [x] #7 Порт парсеров `remote_parse.dart` + golden
- [x] #8 Порт имён сессий и резолва режима + golden
- [x] #9 CI workflow `.github/workflows/mobile.yml`

## Блок 2 — Транспорт (не стартует до закрытия S1–S4)
- [x] #10 TOFU host keys + хранилище отпечатков (учесть вывод S3)
- [x] #11 `SshConnection` (dartssh2, аутентификация, verify host key, keepalive — учесть вывод S3/S4); проверено вручную на живом сервере
- [x] #12 `ExecChannel` (динамический семафор по формуле из S6, старт 4; таймауты, maxBuffer, stdin); PROBE_SCRIPT + 5 параллельных exec проверены на живом сервере
- [x] #13 `SshConnectionPool` (refcount, single-flight, idle-dispose, cooldown); 14 юнит-тестов + проверено на живом сервере
- [x] #14 `ShellSession` (execute с PTY, resize, exitCode); проверено на живом сервере (non-tmux) — tmux-реаттач отложен до разрешения на изменение состояния сервера

## Блок 3 — Домен и данные
- [x] #15 `osc_tap.dart` — DCS-passthrough + OSC 7/133/52 (не полагаться на `onPrivateOSC`, см. S1)
- [x] #16 Хранилище профилей + секреты в secure storage
- [x] #17 `SshFsProvider` (CRUD, батчи 150, polling-watcher 3 с / 40 каталогов); проверено на живом сервере (CRUD, коллизии имён, traversal exit 13, watcher)
- [x] #18 tmux-сессии: list/kill/rename + автополлинг; проверено на живом сервере (список совпадает с `tmux -L etty ls`, rename/kill, notFound, автополлинг)
- [x] #19 `TabController` (lifecycle, re-attach, перехват сессии, авто-ретрай); проверено на живом сервере (реальные OSC-хуки, REQ-11 detach/reattach, REQ-12 перехват)

## Блок 4 — UI
- [x] #20 Тема: порт палитр из `themes.js`, Roboto
- [x] #21 Экран подключений: список, CRUD, сегмент SSH | tmux
- [x] #22 Экран терминала: `TerminalView`, вкладки, resize под клавиатуру; проверено на iOS-симуляторе (реальный SSH-коннект, диалог TOFU host key)
- [x] #23 Панель модификаторов + залипающий Ctrl
- [x] #24 Мост скролла → `WHEEL_SCROLL_*_SEQ` в tmux-режиме
- [x] #25 Панель сессий сервера (kill/rename)
- [x] #26 Дерево удалённых файлов
- [x] #27 Просмотр/правка файла (`re_editor`, лимит размера по итогам S5)

## Блок 5 — Мобильная специфика
- [x] #28 Lifecycle: detach/reattach + ресинк состояния сессии (полный clear буфера перед реаттачем); grace-таймер перед детачем (значение эмпирическое, калибровка на реальном устройстве — открыта, см. plan.md)
- [x] #29 Android foreground service + iOS background-политика (iOS сознательно ограничен detach/reattach-циклом из #28, без background-режимов — см. риск App Store policy в plan.md); Kotlin-код не собран/не проверен на устройстве — в этой песочнице нет полного JDK (`jlink`) для `flutter build apk`, только офлайн-проверка манифеста и константы Android SDK (сверены побайтово в android.jar)
- [x] #30 Биометрическая блокировка

## Блок 6 — Перенос профилей
- [x] #31 Десктоп: экспорт/импорт `*.ettyx` (PBKDF2-600k + AES-256-GCM) — `ettyx-format.js` + `ssh-store.js` (export/import payload) + IPC-каналы + `EttyxDialog`/кнопки в `ssh-panel.js`; `npm run build` зелёный, `node src/main/__tests__/ettyx-format.test.mjs` (23 проверки) зелёный
- [x] #32 Мобилка: импорт `*.ettyx`, раскладка секретов — `connection_export.dart` (decrypt на `package:cryptography`) + `ettyx_import.dart` (file_picker + парольный диалог + upsert в `connectionsProvider`); **межъязыковая совместимость крипто-формата подтверждена реальным файлом**, сгенерированным `ettyx-format.js` (`test/fixtures/ettyx/sample.ettyx.json`, 9 тестов зелёных, включая password/privateKey/agent-профили и невалидные входы) — не раунд-трип внутри одного языка. Открыто: подключение импортированным профилем к живому серверу (пароль и ключ) — требует реального устройства/сервера, как остальные device-gated пункты плана

## Блок 7 — Финализация
- [x] #33 Иконка, splash, debug-сборка: `flutter_launcher_icons`/`flutter_native_splash` из `build/icon.png` (белый фон + символ), app name `eTty` на обеих платформах; `flutter build apk --debug` и `flutter build ios --debug --no-codesign` собираются. Установка/запуск на реальном устройстве и проверка App Store policy (2.5.2/4.7) на TestFlight — device-gated, остаются открытыми
- [x] #34 Раздел про `mobile/` в `.agents/rules/project-rules.md` (структура, фича, инвариант Golden-паритет, команды) + запись `[0.5.0]` в `CHANGELOG.md`

## Проверка (см. раздел «Проверка» в plan.md)
- [x] Fixtures совпадают: `node scripts/gen-remote-fixtures.mjs && git diff --exit-code mobile/test/fixtures` (после закрытия protocol-drift: OSC 6973 node-хук + `UPLOAD_PASTE_IMAGE_SCRIPT` портированы в Dart)
- [x] `cd mobile && flutter analyze && flutter test` — зелено (407 тестов)
- [ ] tmux-сессия с телефона видна на сервере под именем `etty-<8 alnum>`
- [ ] Перехват сессии десктопом и обратно отрабатывает, конфиг сессии не ломается
- [ ] 5 минут в фоне → сессия жива, cwd/busy ресинкнулись
- [ ] CRUD удалённой ФС на именах с пробелами и кириллицей; traversal отклоняется
- [ ] Правка файла сохраняется на сервер
- [ ] Экспорт с десктопа импортируется и подключается (пароль и ключ)
- [ ] Незнакомый host key спрашивает подтверждение, подменённый — блокирует
- [x] Регрессия десктопа: `npm run build` + все `src/main/__tests__/*.test.mjs` (7 файлов) — зелено

## Финализация
- [ ] Все проверки пройдены (device-gated пункты требуют реального устройства/сервера)
- [x] Код закоммичен
- [x] Статус в `plan.md` обновлён на `Done`
