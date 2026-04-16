# Спецификация: Инициализация проекта

## Контекст

Первый шаг Stage 1 проекта eTty — создание скелета Electron-приложения. На этом этапе создаётся инфраструктура проекта: package.json с зависимостями, конфигурация сборщика electron-vite, .gitignore, директории src/. Git-репозиторий инициализируется, создаётся первый коммит.

Фича не создаёт рабочий код приложения — только фундамент, на который далее ложатся pty-manager, main process, preload, renderer.

**Родительский план:** `docs/plans/2026-04-15-terminal-wrapper-stage1.md` (Task 1)
**Design-spec:** `docs/superpowers/specs/2026-04-15-terminal-wrapper-stage1-design.md`

## Требования

- **REQ-1:** Создать `package.json` с корректными полями: name `etty`, version `0.1.0`, main `./out/main/index.js`, скрипты `dev`, `build`, `postinstall`.
- **REQ-2:** В dependencies включить: `@xterm/xterm ^5.5.0`, `@xterm/addon-fit ^0.10.0`, `@xterm/addon-webgl ^0.18.0`, `@xterm/addon-web-links ^0.11.0`, `@xterm/addon-search ^0.15.0`, `node-pty ^1.0.0`.
- **REQ-3:** В devDependencies включить: `electron ^33.0.0`, `electron-vite ^2.4.0`, `electron-rebuild ^3.2.0`.
- **REQ-4:** `npm install` должен успешно установить все зависимости; `postinstall` (`electron-rebuild`) должен пересобрать node-pty под Electron без ошибок.
- **REQ-5:** Создать `electron.vite.config.mjs` с `externalizeDepsPlugin()` для main и preload (исключение нативных модулей из бандла).
- **REQ-6:** Создать `.gitignore` с записями: `node_modules/`, `out/`, `dist/`, `.DS_Store`, `*.log`.
- **REQ-7:** Создать директории `src/main/`, `src/preload/`, `src/renderer/`.
- **REQ-8:** Инициализировать git-репозиторий и создать первый коммит с файлами: `package.json`, `package-lock.json`, `electron.vite.config.mjs`, `.gitignore`.

## Ограничения

- Не создавать файлы исходного кода приложения (index.js, pty-manager.js и т.д.) — это задачи последующих фич.
- Не менять версии пакетов относительно указанных в design-spec без явной причины (например, уязвимость).
- macOS — целевая платформа. Xcode Command Line Tools должны быть установлены до запуска.

## Макеты и референсы

> не применимо

## Кодстайл и конвенции

- Конфигурационные файлы в корне проекта.
- `electron.vite.config.mjs` — ES-модуль (import/export).
- `package.json` — стандартное форматирование npm (2 пробела отступ).
- Commit message: формат `{type}: {description}` (например `init: project setup with electron-vite, xterm.js, node-pty`).

## Переиспользуемые решения

- **electron-vite:** `defineConfig` + `externalizeDepsPlugin` — стандартный паттерн из документации electron-vite.
- **electron-rebuild:** запуск через `postinstall` скрипт — описано в `docs/kb/02_setup_and_build.md`.
- **Структура директорий:** `src/main/`, `src/preload/`, `src/renderer/` — каноническая структура electron-vite проекта.

## Критерии приёмки

- [ ] `package.json` содержит все зависимости и скрипты из REQ-1..REQ-3
- [ ] `npm install` выполняется без ошибок
- [ ] `electron-rebuild` (postinstall) завершается с `Rebuild Complete`
- [ ] `electron.vite.config.mjs` создан и корректен (REQ-5)
- [ ] `.gitignore` покрывает node_modules, out, dist, .DS_Store, *.log (REQ-6)
- [ ] Директории `src/main/`, `src/preload/`, `src/renderer/` существуют (REQ-7)
- [ ] Git-репозиторий инициализирован, первый коммит содержит package.json, package-lock.json, electron.vite.config.mjs, .gitignore (REQ-8)

## Затронутые файлы

- `package.json` — создание
- `electron.vite.config.mjs` — создание
- `.gitignore` — создание
- `src/main/` — создание директории
- `src/preload/` — создание директории
- `src/renderer/` — создание директории
