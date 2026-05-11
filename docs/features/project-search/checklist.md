# Чеклист реализации: Поиск по проекту

## Подготовка
- [x] Прочитать spec.md и plan.md
- [x] Создать ветку `feature/project-search` и переключиться на неё

## Задачи

### Блок 1 — IPC и backend поиска (main + shared)
- [x] Задача #1: Добавить константы IPC-каналов в `shared/ipc-channels.js`
- [x] Задача #2: Добавить метод `searchFiles()` в `FileManager`
- [x] Задача #3: Создать `search-handlers.js` в main
- [x] Задача #4: Экспортировать search-handlers из barrel (`ipc-handlers/index.js`)
- [x] Задача #5: Регистрировать search-handlers в `main/index.js`
- [x] Задача #6: Добавить методы поиска в preload API
- [x] Задача #7: Добавить адаптерные методы в `ElectronApiAdapter`

### Блок 2 — Renderer-компонент ProjectSearch
- [x] Задача #8: Добавить иконку лупы в `icons.js`
- [x] Задача #9: Создать `project-search.js` — компонент диалога
- [x] Задача #10: Добавить константы поиска в `app-config.js`

### Блок 3 — Интеграция и bootstrap
- [x] Задача #11: Добавить кнопку лупы в `index.html`
- [x] Задача #12: Интегрировать ProjectSearch в `index.js` (DI, keyboard, events)

### Блок 4 — Стили и темы
- [x] Задача #13: Добавить CSS-переменные в `styles.css` и `themes.js`
- [x] Задача #14: Стилизовать диалог поиска

## Финализация
- [x] Все проверки пройдены
- [x] `npm run build` без ошибок
- [x] Код закоммичен
- [x] Статус в README.md обновлён на `Done`
