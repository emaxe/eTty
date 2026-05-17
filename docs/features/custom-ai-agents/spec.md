# Спецификация: Кастомные ИИ-агенты

## Контекст

Сейчас ИИ-агенты захардкожены в 5 местах:

1. `src/main/agent-service.js` — массив `SUPPORTED_AGENTS` + логика детекта
2. `src/renderer/index.html` — 5 кнопок в `#status-agents`
3. `src/renderer/index.js` — `agentCommands` маппинг + `applyAgentCommands`
4. `src/renderer/settings-page.js` — дублирующий `SUPPORTED_AGENTS` + тогглы агентов
5. `src/renderer/status-bar.js` — `agentButtons` (DOM-элементы из HTML)
6. `src/main/config-loader.js` — `forceDisabled` с захардкоженными ключами

Требуется: дать пользователю возможность добавлять произвольных ИИ-агентов с полями:
- **Название** (label) — отображается на кнопке и в настройках
- **Команда запуска** (launchCommand) — что отправляется в терминал при клике
- **Команда отслеживания запуска** (checkCommand, опционально) — для auto-detect: проверяем `command -v {checkCommand}`

Кастомные агенты должны быть доступны в «Быстрых ответах» наравне со встроенными.

## Требования

### REQ-1: Хранение кастомных агентов
Кастомные агенты хранятся в `config.agents.custom` как массив объектов:
```js
{ id: string(UUID), label: string, launchCommand: string, checkCommand: string, enabled: boolean }
```
- `id` — генерируется через `crypto.randomUUID()`
- `checkCommand` может быть пустой строкой — тогда агент всегда считается доступным (no detection)
- Дефолт: `agents.custom: []`
- Обновить `getConfigDefaults()` в `config-loader.js`

### REQ-2: Auto-detect кастомных агентов
`AgentService.refresh()` принимает массив кастомных агентов, проверяет их `checkCommand` через `commandExists` (если не пустая), возвращает merged список (built-in + custom).
- Результат `{ detected: boolean, launchCommand: string }` для каждого
- IPC `AGENTS_REFRESH` передаёт `customAgents` из config в main process
- Custom agents с пустой `checkCommand` → `detected: true`

### REQ-3: Динамическая генерация кнопок агентов в статус-баре
Убрать 5 захардкоженных кнопок из `index.html`. `StatusBar` получает `agentsContainerEl` вместо `agentButtons[]`.
- `setAgentConfigs(agents)` — генерирует кнопки в контейнер, навешивает обработчики кликов
- `setAgentsStatus(statusPayload)` — обновляет `_agentsById` и `_updateAgentButtons()`
- Встроенные + кастомные агенты отображаются единообразно
- Double-click логика сохраняется (назначение активного агента при busy)

### REQ-4: Команды запуска из конфигов агентов
`index.js` больше не использует hardcoded `agentCommands` маппинг.
- `applyAgentCommands(statusPayload)` формирует маппинг из `statusPayload.agents` (поле `launchCommand`)
- Для кастомных агентов `launchCommand` берётся из их конфига
- `launchAgentInActiveTab` ищет команду по agent ID в динамическом маппинге

### REQ-5: CRUD кастомных агентов в настройках
Новая категория «Кастомные ИИ-агенты» в SettingsPage.
- UI аналогичен «Быстрые ответы»: список с drag-and-drop, кнопка «Добавить», иконка редактирования
- Диалог добавления/редактирования: поля label, launchCommand, checkCommand, toggle enabled
- Кнопка «Удалить» в диалоге
- `setForceDisabled` для кастомных — через `enabled` флаг (единый механизм: `!enabled` = скрыто)
- При изменении кастомных агентов: emit `settings.changed`, `_scheduleSave()`, перегенерировать UI

### REQ-6: Кастомные агенты в «Быстрых ответах»
Диалог редактирования быстрого ответа (`_openQuickReplyDialog`) показывает toggles для:
- Всех встроенных агентов (существующее поведение)
- Всех кастомных агентов (из `config.agents.custom`, только `enabled: true`)
- Отображаемое имя — `label` агента

### REQ-7: Настройки встроенных агентов не ломаются
- Встроенные агенты продолжают auto-detect через `AgentService`
- `forceDisabled` для встроенных остаётся в `config.agents.forceDisabled`
- Все существующие quick replies и их `agents` массивы сохраняют работоспособность

### REQ-8: Обновление статус-бара при изменении агентов
`index.js` подписан на `settings.changed` с ключом `agents.custom`.
- При изменении: обновить `StatusBar.setAgentConfigs()`, перезапросить `agentsRefresh()`
- При открытии SettingsPage и сохранении — статус-бар синхронизируется

## Ограничения

- Не меняем структуру встроенных агентов (built-in остаются в `AgentService.SUPPORTED_AGENTS`)
- Не меняем формат `quickReplies.items` — добавляем только новые `id` в `agents[]`
- Не добавляем новых IPC каналов — используем существующие, расширяя payload
- Не меняем `config.version` — новое поле `agents.custom` обрабатывается `deepMergeConfig` как optional (default = empty array)

## Макеты и референсы

> Не применимо — UI следует существующему дизайну настроек (Quick Replies).

## Кодстайл и конвенции

- DI: зависимости через DI Container (constructor injection)
- EventBus: коммуникация через EventBus
- StateStore: shared state через StateStore
- IPC: все каналы только через `shared/ipc-channels.js`
- Config: магические числа/строки в `core/config/` или константы
- Cleanup: каждый компонент имеет `destroy()`
- Адаптер: не обращаться к `window.electronAPI` напрямую

## Переиспользуемые решения

- **Quick Replies CRUD** (`settings-page.js:263-572`) — шаблон для UI кастомных агентов:
  - `_buildQuickRepliesCategory()` — список с DnD
  - `_openQuickReplyDialog()` — диалог с полями + toggles
  - `_rerenderQuickRepliesCategory()` — `replaceWith` паттерн
- **Agent detection** (`agent-service.js:48-111`) — `commandExists`, `probeCommand`
- **Settings save flow** — `_scheduleSave()` (debounced 300ms) + `settings.changed` event
- **StatusBar agent buttons** — `_updateAgentButtons()`, `_updateAgentCommandsPanel()`

## Критерии приёмки

- [ ] В настройках появляется категория «Кастомные ИИ-агенты» с возможностью добавить/редактировать/удалить/переупорядочить агента
- [ ] Поля агента: Название, Команда запуска, Команда отслеживания (опционально), Включено
- [ ] Кастомный агент появляется как кнопка в статус-баре
- [ ] Клик по кнопке кастомного агента отправляет `launchCommand` в терминал
- [ ] Кастомные агенты доступны в диалоге редактирования «Быстрых ответов»
- [ ] Встроенные агенты (Claude, Codex, Copilot, Agent, OpenCode) продолжают работать как раньше
- [ ] Сохранение/загрузка конфига работает корректно (в т.ч. при отсутствии `agents.custom`)
- [ ] Drag-and-drop reorder работает для кастомных агентов

## Затронутые файлы

| Файл | Изменения |
|------|-----------|
| `src/main/config-loader.js` | Добавить `agents.custom: []` в defaults |
| `src/main/agent-service.js` | `refresh(customAgents)` — detect custom agents |
| `src/main/ipc-handlers/agents-handlers.js` | Передавать `customAgents` из config в `refresh()` |
| `src/renderer/index.html` | Удалить 5 hardcoded кнопок из `#status-agents` |
| `src/renderer/index.js` | Динамическая генерация agent buttons; dynamic `agentCommands` |
| `src/renderer/settings-page.js` | CRUD категория «Кастомные ИИ-агенты»; custom agents в QR dialog |
| `src/renderer/status-bar.js` | `agentsContainerEl` вместо `agentButtons`; `setAgentConfigs()` |
| `src/shared/ipc-channels.js` | Нет изменений (используем `AGENTS_REFRESH` с payload) |
