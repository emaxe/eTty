# eTty

Electron-терминал с файловым деревом, редактором кода, Git-интеграцией и AI-агентами.

## Мета

Перед добавлением или изменением правил, скилов, инструкций — прочитай скилл
`agents-conventions`.

## Правила

### Правила проекта
Основные правила и описание проекта.
[Подробности](.agents/rules/project-rules.md)

## Архитектурный контекст

Проект прошёл масштабный рефакторинг (Блоки 1–4):
- **Блок 1:** UI-Kit, константы, keyboard/OSC handlers
- **Блок 2:** Event Bus + State Store + DraggableTabs
- **Блок 3:** DI Container, полная миграция на EventBus, God Object split (renderer)
- **Блок 4:** IPC handlers split + AppService (main process)

Актуальная структура описана в `project-rules.md`.

## Правила реализации

Перед написанием кода определи тип изменения и следуй соответствующему чеклисту.

### Тип: новый UI-компонент
Прочитай [.agents/rules/checklists/new-component.md](.agents/rules/checklists/new-component.md) и следуй каждому пункту.

### Тип: новый IPC-обработчик
Прочитай [.agents/rules/checklists/new-ipc-handler.md](.agents/rules/checklists/new-ipc-handler.md) и следуй каждому пункту.

### Тип: новая фича
Прочитай [.agents/rules/checklists/new-feature.md](.agents/rules/checklists/new-feature.md) и следуй каждому пункту.

### Архитектурные инварианты (всегда)

- **DI:** зависимости — через DI Container (constructor injection), не через глобалы
- **EventBus:** коммуникация между компонентами — через EventBus, не прямые вызовы
- **StateStore:** shared state — через StateStore, не private fields
- **IPC_CHANNELS:** все IPC-каналы — только через `shared/ipc-channels.js`, нет строковых литералов
- **Config:** магические числа и интервалы — в `core/config/`, не инлайн
- **Cleanup:** каждый компонент имеет `destroy()` для отписки от EventBus, StateStore, очистки таймеров и DOM
- **Адаптер:** не обращаться к `window.electronAPI` напрямую — через `core/adapters/electron-api.js`

## Скиллы

| Скилл | Команда | Когда использовать |
|-------|---------|--------------------|
| Feature Planning | `/feature-planning` | Планирование новой фичи: от идеи до промпта реализации |
| Feature Accept | `/feature-accept` | Принятие готовой фичи: merge, cleanup, обновление документации |
| Code Review | `/code-review` | Проверка кода на архитектуру и конвенции перед коммитом |
| Bugfix | `/bugfix` | Диагностика и исправление бага без тяжёлого планирования |
