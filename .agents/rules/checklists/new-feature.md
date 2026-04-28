# Чеклист: новая фича (общий)

Выполняй при добавлении новой функциональности любого масштаба.

## Подготовка

- [ ] Прочитать `AGENTS.md` и `.agents/rules/project-rules.md`
- [ ] Проверить `docs/features/` — нет ли уже спецификации/плана для этой фичи
- [ ] Определить затронутые слои: renderer, main, preload, shared

## Реализация

- [ ] Каждый новый файл следует чеклисту своего типа:
  - Новый компонент → `.agents/rules/checklists/new-component.md`
  - Новый IPC handler → `.agents/rules/checklists/new-ipc-handler.md`
- [ ] Архитектурные инварианты соблюдены:
  - DI Container для зависимостей
  - EventBus для коммуникации между компонентами
  - StateStore для shared state
  - `IPC_CHANNELS` для всех имён каналов
  - Константы в `src/renderer/core/config/`
  - `destroy()` для cleanup
- [ ] Нет прямых обращений к `window.electronAPI` — только через адаптер
- [ ] Нет магических чисел и строк

## Стили

- [ ] Цвета — через CSS-переменные из тем (`var(--переменная)`)
- [ ] Новые CSS-переменные добавлены в `src/renderer/styles.css :root` и во все темы в `themes.js`

## Проверка

- [ ] `npm run build` проходит без ошибок
- [ ] Ручная проверка в dev-режиме (`npm run dev`): golden path + edge cases
- [ ] Нет регрессий в существующих фичах (терминал, вкладки, файловое дерево, редактор, git-панель)
- [ ] Нет `console.log` в production-коде (допустимо только через `electron-log`)
