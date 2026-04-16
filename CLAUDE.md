# CLAUDE.md — контекст для AI-агентов

## Проект

eTty — Electron-приложение-обёртка терминала. Stack: **Electron 33**, **electron-vite**, **xterm.js**, **node-pty** (нативный модуль).

## Структура директорий

```
src/
  main/       — main-процесс Electron (index.js, pty-manager.js, file-manager.js)
  preload/    — preload-скрипт с contextBridge API
  renderer/   — UI (xterm.js, вкладки, файловое дерево)
out/          — артефакты electron-vite build (НЕ редактировать вручную)
dist/         — артефакты electron-builder (НЕ коммитить)
build/        — ресурсы для сборки (entitlements.mac.plist)
docs/         — спецификации, планы, чеклисты по фичам
```

## Команды

| Команда | Что делает |
|---------|-----------|
| `npm run dev` | Запустить в режиме разработки |
| `npm run build` | Скомпилировать через electron-vite → `out/` |
| `npm run dist` | Собрать macOS .dmg → `dist/` (требует предварительного `build`) |
| `npm run dist:win` | Собрать Windows NSIS (только на Windows) |
| `npm run dist:linux` | Собрать Linux AppImage/deb (только на Linux) |

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

В `src/main/index.js` — заглушка: импорт `autoUpdater`, `autoUpdater.logger = log`, `checkForUpdatesAndNotify()` в try/catch в `app.whenReady()`. Не падает без настроенного update-сервера. Полная реализация авто-обновления — отдельная фича.

## Правила работы с кодом

- Не коммитить `dist/`, `out/`, `.DS_Store`, `*.log`
- Не хранить credentials и ключи в репозитории
- Конфиг electron-builder — только в `package.json`, не создавать `electron-builder.yml`
- Entitlements — только в `build/`
- Изменения в нативных модулях требуют `npm run postinstall` (electron-rebuild)
- Ветки по фичам: `feature/<slug>`, merge в `main`

## Документация фич

Каждая фича имеет директорию `docs/features/<slug>/` с файлами:
- `spec.md` — требования
- `plan.md` — задачи и стратегия
- `checklist.md` — прогресс
- `starter-prompt.md` — промпт для новой сессии
