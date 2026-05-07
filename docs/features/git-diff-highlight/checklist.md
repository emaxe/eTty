# Чеклист реализации: Подсветка git diff

## Подготовка
- [x] Прочитать spec.md и plan.md
- [x] Создать ветку `feature/git-diff-highlight` и переключиться на неё

## Задачи
- [x] Задача #1: Добавить `GIT_STATUS_POLL_INTERVAL_MS` в app-config + начальные git-ключи в StateStore (index.js)
- [x] Задача #2: Создать `GitStatusService` (polling, EventBus, StateStore)
- [x] Задача #3: Зарегистрировать GitStatusService в DI + подписать на tab switch в index.js
- [ ] Задача #4: Добавить CSS стили (файловое дерево + редактор gutter)
- [ ] Задача #5: FileTree — подписка на git.fileStatuses, CSS-классы + dot-индикаторы папок
- [ ] Задача #6: EditorPanel — diff gutter extension, парсинг diff, подписка на git:status-updated

## Финализация
- [ ] Все проверки пройдены
- [ ] Код закоммичен
- [ ] Статус в README.md обновлён на `Done`
