# Спецификация: App Packaging

## Контекст

eTty сейчас запускается только через `npm run dev` или `npx electron .`. Нужно настроить сборку полноценного дистрибутива через **electron-builder**: подписанный macOS `.dmg`, с архитектурой, готовой к поддержке Windows/Linux и auto-update в будущем.

## Требования

- **REQ-1** — Добавить `electron-builder` и настроить базовый конфиг для macOS (`.dmg`, universal или arm64+x64).
- **REQ-2** — Настроить подпись кода (code signing) для macOS: hardened runtime, entitlements для `node-pty`, notarization.
- **REQ-3** — Архитектура конфига должна предусматривать будущие платформы: Windows (NSIS installer) и Linux (AppImage/deb) — секции в конфиге присутствуют, но не активируются в текущей сборке.
- **REQ-4** — Установить `electron-updater` и подключить базовую заглушку в main-процессе (логирование + placeholder), чтобы авто-обновление можно было включить позже без переработки архитектуры.
- **REQ-5** — Добавить скрипты в `package.json`: `dist` (сборка для macOS), `dist:win`, `dist:linux` (на будущее).
- **REQ-6** — Корректно пересобирать нативный модуль `node-pty` для target Electron-версии перед упаковкой (`electron-builder`'s afterPack или rebuild hook).
- **REQ-7** — Обновить `.gitignore` для артефактов electron-builder (`dist/`, `release/`).

## Ограничения

- Auto-update **не реализуется** в этой фиче — только заглушка и зависимость.
- Windows и Linux сборки **не тестируются** — только конфиг присутствует.
- Mac App Store не в скоупе.
- Credentials для подписи (Apple Developer ID, API ключи нотаризации) хранятся в переменных окружения, не в репозитории.

## Макеты и референсы

> не применимо

## Кодстайл и конвенции

- Конфиг electron-builder — в `package.json` в секции `"build"` (не отдельный yml — для единого места конфигурации).
- Entitlements — отдельные файлы в `build/` директории.
- Переменные окружения для подписи: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD`.

## Переиспользуемые решения

- `electron-rebuild` уже установлен и запускается в `postinstall` — electron-builder умеет его вызывать через `npmRebuild: true`.
- `node-pty` уже имеет prebuilds для `darwin-arm64`, `darwin-x64`, `win32-arm64`, `win32-x64` — electron-builder подберёт нужный.

## Критерии приёмки

- [ ] `npm run dist` собирает `.dmg` в `dist/`
- [ ] Приложение запускается из `.app` без ошибок (терминал открывается, ввод работает)
- [ ] Приложение подписано (проверка: `codesign -dv --verbose=4 eTty.app`)
- [ ] Нотаризировано (проверка: `spctl -a -vvv -t install eTty.app`)
- [ ] В main-процессе есть заглушка `electron-updater` с логом при старте
- [ ] В `package.json` есть скрипты `dist`, `dist:win`, `dist:linux`
- [ ] Конфиг содержит секции для Windows и Linux (даже если не активны)
- [ ] `.gitignore` содержит `dist/` и `release/`

## Затронутые файлы

- `package.json` — зависимости, скрипты, секция `"build"`
- `src/main/index.js` — заглушка electron-updater
- `build/entitlements.mac.plist` — новый файл
- `.gitignore` — добавить артефакты
