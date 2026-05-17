# Чеклист реализации: Кастомные ИИ-агенты

## Подготовка
- [x] Прочитать spec.md и plan.md
- [x] Создать ветку `feature/custom-ai-agents` и переключиться на неё

## Задачи
- [x] Задача #1: Config + AgentService — добавить `agents.custom` в defaults, `refresh(customAgents)` merges кастомных, IPC payload передаёт `customAgents`
- [x] Задача #2: HTML cleanup — удалить 5 hardcoded кнопок из `#status-agents`
- [x] Задача #3: StatusBar dynamic buttons — `agentsContainerEl` вместо `agentButtons[]`, `setAgentConfigs()` генерирует DOM-кнопки
- [x] Задача #4: index.js wiring — динамический `agentCommands`, `launchAgentInActiveTab` по ID, подписка `settings.changed` обновляет StatusBar + refresh
- [x] Задача #5: SettingsPage CRUD категория «Кастомные ИИ-агенты» — add/edit/delete/DnD, поля label/launchCommand/checkCommand/enabled
- [x] Задача #6: SettingsPage QR integration — кастомные агенты в диалоге быстрых ответов
- [x] Задача #7: CSS — стили для категории кастомных агентов в настройках
- [x] Задача #8: Acceptance test + bugfix — проверить все AC, исправить проблемы

## Финализация
- [x] Все проверки пройдены
- [ ] Код закоммичен
- [ ] Статус в README.md обновлён на `Done`
