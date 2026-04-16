# Чеклист реализации: App Packaging

## Подготовка
- [x] Прочитать spec.md и plan.md
- [x] Создать ветку `feature/app-packaging` и переключиться на неё

## Задачи
- [x] Задача #1: Установить `electron-builder` и `electron-updater`
- [x] Задача #2: Создать `build/entitlements.mac.plist`
- [x] Задача #3: Обновить `.gitignore`
- [x] Задача #4: Добавить секцию `"build"` + скрипты в `package.json`
- [x] Задача #5: Добавить заглушку `electron-updater` в `src/main/index.js`
- [x] Задача #6: Сборка и smoke-test (`npm run build && npm run dist`)

## Финализация
- [x] Все проверки пройдены
- [x] Код закоммичен
- [ ] Статус в README.md обновлён на `Done`

## Заметки
- Подпись: ad-hoc (без Developer ID Application — `APPLE_ID`, `CSC_LINK` не заданы). Для production нотаризации задать переменные окружения.
- `.dmg` собраны: `dist/eTty-0.1.0-arm64.dmg` и `dist/eTty-0.1.0.dmg`
