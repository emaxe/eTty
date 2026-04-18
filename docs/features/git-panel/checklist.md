# Чеклист реализации: Git Panel

## Подготовка
- [x] Прочитать spec.md и plan.md
- [x] Создать ветку `feature/git-panel` и переключиться на неё

## Задачи

### Блок 1 — Инфраструктура
- [x] Задача #1: Добавить `simple-git` в `package.json` + `npm install`
- [x] Задача #2: Создать `src/main/git-service.js` со всеми git-операциями и IPC-хендлерами
- [x] Задача #3: Зарегистрировать git* IPC-каналы в `src/preload/index.js`

### Блок 2 — HTML и CSS
- [x] Задача #4: Добавить `#status-bar` и `#git-overlay` в `src/renderer/index.html`
- [x] Задача #5: Написать CSS для status-bar и git-panel в `src/renderer/styles.css`

### Блок 3 — JS классы (параллельно)
- [x] Задача #6: Создать `src/renderer/status-bar.js` — класс StatusBar
- [x] Задача #7: Создать `src/renderer/git-panel.js` — класс GitPanel

### Блок 4 — Интеграция
- [x] Задача #8: Инициализировать StatusBar и GitPanel в `src/renderer/index.js`; вызвать `registerGitHandlers` в `src/main/index.js`

## Финализация
- [x] Все проверки пройдены
- [ ] Код закоммичен
- [ ] Статус в README.md обновлён на `Done`
