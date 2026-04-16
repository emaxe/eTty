# Стартовый промпт для реализации фичи «App Packaging»

Скопируй целиком и вставь в новую сессию.

---

Реализуй фичу **App Packaging** по подготовленной документации.

## Документация

- Спецификация: `docs/features/app-packaging/spec.md` — прочитай перед началом
- План: `docs/features/app-packaging/plan.md` — следуй порядку задач, секциям «Стратегия выполнения» и «Ревью после каждого шага»
- Чеклист: `docs/features/app-packaging/checklist.md` — отмечай прогресс

## Инструкции

1. Прочитай `spec.md` и `plan.md` целиком.
2. Создай ветку `feature/app-packaging` и переключись на неё:
   ```
   git checkout -b feature/app-packaging
   ```
3. Отметь в `checklist.md` пункты «Подготовка» как выполненные.
4. Выполняй задачи согласно **стратегии выполнения** из `plan.md`:
   - Задачи #1, #2, #3 — параллельно в одной сессии (`parallel-same`)
   - Задачи #4 и #5 — параллельно после завершения #1
   - Задача #6 — строго после #2, #3, #4, #5
5. После каждой задачи: сверяйся с `plan.md` и `spec.md`, убедись что не вышел за скоуп.
6. Отмечай выполненные задачи в `checklist.md`.
7. Задача #6 — полная сборка: `npm run build && npm run dist`. Если падает — диагностировать до коммита.
8. Для подписи кода нужны переменные окружения: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD`. Если они не заданы — сборка без подписи (для smoke-test допустимо, пометить в checklist).
9. Коммит — после успешного прохождения задачи #6.
10. По завершении обнови статус в `docs/features/app-packaging/README.md` на `Done`.

## Важные детали

- `node-pty` — нативный модуль, electron-builder должен его пересобрать перед упаковкой. В секции `"build"` package.json укажи `"npmRebuild": true` и добавь `afterPack` хук или используй `"extraMetadata"` для правильного rebuild.
- entitlements для `node-pty` должны включать: `com.apple.security.cs.allow-jit`, `com.apple.security.cs.allow-unsigned-executable-memory`, `com.apple.security.cs.disable-library-validation`.
- Заглушка electron-updater: импортируй `autoUpdater` из `electron-updater`, добавь `autoUpdater.logger = log` и `autoUpdater.checkForUpdatesAndNotify()` в `app.whenReady()` обёрнутый в try/catch с логом — чтобы не падал без настроенного сервера.
- Базовая ветка для merge после завершения: `main`.
