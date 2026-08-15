# eTty

Electron-терминал с файловым деревом, редактором кода, Git-интеграцией и AI-агентами.

## Мета

Перед добавлением или изменением правил, скилов, инструкций — прочитай скилл
`agents-conventions`.

## Правила

### Правила проекта
Стек, структура директорий, IPC-каналы, реализованные фичи, архитектурные инварианты, стиль кода и чеклисты.
[Подробности](.agents/rules/project-rules.md)

## Правила реализации

Перед написанием кода определи тип изменения и следуй соответствующему чеклисту.

### Тип: новый UI-компонент
Прочитай [.agents/rules/checklists/new-component.md](.agents/rules/checklists/new-component.md) и следуй каждому пункту.

### Тип: новый IPC-обработчик
Прочитай [.agents/rules/checklists/new-ipc-handler.md](.agents/rules/checklists/new-ipc-handler.md) и следуй каждому пункту.

### Тип: новая фича
Прочитай [.agents/rules/checklists/new-feature.md](.agents/rules/checklists/new-feature.md) и следуй каждому пункту.

### Тип: релиз
Прочитай [.agents/rules/release-process.md](.agents/rules/release-process.md) и следуй процедуре обновления CHANGELOG.

### Архитектурные инварианты (всегда)
Обязательны при любом изменении кода: DI, EventBus, StateStore, IPC_CHANNELS, Config, Cleanup, Адаптер.
[Полная таблица с описанием каждого инварианта](.agents/rules/project-rules.md#архитектурные-инварианты)

## Скиллы

| Скилл | Команда | Когда использовать |
|-------|---------|--------------------|
| Feature Planning | `/feature-planning` | Планирование новой фичи: от идеи до промпта реализации |
| Feature Accept | `/feature-accept` | Принятие готовой фичи: merge, cleanup, обновление документации |
| Code Review | `/code-review` | Проверка кода на архитектуру и конвенции перед коммитом |
| Bugfix | `/bugfix` | Диагностика и исправление бага без тяжёлого планирования |
