# Чеклист реализации: Подсветка git diff

## Подготовка
- [x] Прочитать spec.md и plan.md
- [x] Создать ветку `feature/git-diff-highlight` и переключиться на неё

## Задачи
- [x] Задача #1: Добавить `GIT_STATUS_POLL_INTERVAL_MS` в app-config + начальные git-ключи в StateStore (index.js)
- [x] Задача #2: Создать `GitStatusService` (polling, EventBus, StateStore)
- [x] Задача #3: Зарегистрировать GitStatusService в DI + подписать на tab switch в index.js
- [x] Задача #4: Добавить CSS стили (файловое дерево + редактор gutter)
- [x] Задача #5: FileTree — подписка на git.fileStatuses, CSS-классы + dot-индикаторы папок
- [x] Задача #6: EditorPanel — diff gutter extension, парсинг diff, подписка на git:status-updated

## Оптимизации (после первой реализации)
- [x] Заменить построчный парсинг diff на `git diff --numstat` для tracked/staged файлов
- [x] Streaming подсчёт строк для untracked файлов с лимитами (50 MB / 200 файлов)
- [x] Guard на stale poll results при смене rootPath
- [x] Сохранять branch, totalAdditions, totalDeletions в StateStore

## Финализация
- [x] Все проверки пройдены
- [x] Код закоммичен
- [x] Статус в README.md обновлён на `Done`
