# Чеклист реализации: Конфиг (Внешний конфиг + темы)

## Подготовка
- [x] Прочитать spec.md и plan.md
- [x] Создать ветку `feature/config` и переключиться на неё

## Задачи

### Блок 1 — Загрузчики (параллельно)
- [x] Задача #1: Создать `src/main/config-loader.js` — чтение `config.json`, валидация, deep merge, fallback, alert
- [x] Задача #2: Создать `src/main/theme-loader.js` — сканирование `themes/`, парсинг `.json`, валидация полей, skip невалидных, skip дублей `id`, fallback на built-in

### Блок 2 — Оркестрация и темы (последовательно после #1, #2)
- [x] Задача #3: Рефакторинг `src/main/settings-store.js` в оркестратор
- [x] Задача #4: Урезать `src/renderer/themes.js` до 2-х built-in тем (`dark`, `light`)

### Блок 3 — IPC и renderer (последовательно после #3)
- [x] Задача #5: Обновить `src/preload/index.js` — `settings:load` возвращает `{config, themes, warnings}`, `settings:save` пишет только `config`
- [x] Задача #6: Адаптировать `src/renderer/settings-page.js` — dropdown тем строится динамически
- [x] Задача #7: Обновить `src/renderer/index.js` — приём нового формата от `settings:load`

### Блок 4 — Финализация
- [x] Задача #8: Полная интеграционная проверка: удалить `config.json` и `themes/` → старт → проверить recreation, валидацию, fallback, UI

## Финализация
- [x] Все проверки пройдены
- [x] Код закоммичен
- [x] Статус в README.md обновлён на `Done`
