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
