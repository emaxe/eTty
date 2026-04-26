# Чеклист реализации: Настройки быстрых ответов

## Подготовка
- [x] Прочитать spec.md и plan.md
- [x] Создать ветку `feature/quick-reply-settings` и переключиться на неё

## Задачи
- [x] Задача #1: Добавить `quickReplies` в `getConfigDefaults` и `deepMergeConfig` (`src/main/config-loader.js`)
- [x] Задача #2: Добавить категорию «Быстрые ответы» в `SettingsPage` (`src/renderer/settings-page.js`)
- [x] Задача #3: Динамические кнопки в `StatusBar` + очистка HTML (`src/renderer/status-bar.js`, `src/renderer/index.html`)
- [x] Задача #4: Стили для новых элементов (`src/renderer/styles.css`)
- [x] Задача #5: Подключить `quickReplies` в `index.js` (`src/renderer/index.js`)

## Улучшения UX (пост-ревью)
- [x] Компактный UI: объединить label и command в одно поле, edit-диалог
- [x] Иконка карандаша вместо кнопки «Редактировать»
- [x] Drag-and-drop для изменения порядка с grip-иконкой и индикатором вставки
- [x] Фикс DnD: убрать preventDefault, поправить adjustedIndex после splice

## Финализация
- [x] Все проверки пройдены
- [x] Код закоммичен
- [x] README.md обновлён
- [x] CHANGELOG.md создан
