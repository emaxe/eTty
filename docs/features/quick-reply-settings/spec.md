# Спецификация: Настройки быстрых ответов

## Контекст

Сейчас быстрые ответы (agent commands) захардкожены в `src/renderer/status-bar.js` и `src/renderer/index.html`: для каждого ИИ-агента есть фиксированный список из 5 кнопок (`/clear`, `/model`, `Ok`, `Продолжай`, `/exit` — и `/new` для opencode). Пользователь не может редактировать этот список.

Фича делает быстрые ответы конфигурируемыми через раздел настроек. При первом запуске (отсутствии конфигурации) текущие захардкоженные значения становятся дефолтными и сохраняются в `config.json`. В дальнейшем список берётся только из конфига.

## Требования

### REQ-1: Конфигурация
- В `config.json` добавить секцию `quickReplies` со списком объектов `{ id, label, command, enabled, agents }`.
- `id` — уникальный строковый идентификатор (генерируется при создании).
- `label` — текст на кнопке.
- `command` — текст, отправляемый в терминал.
- `enabled` — булев флаг, показывать ли кнопку.
- `agents` — массив строк (`agentId`), в которых отображать данный быстрый ответ.
- Дефолтные значения при отсутствии в конфиге:
  ```json
  {
    "quickReplies": {
      "items": [
        { "id": "qr-1", "label": "Ok", "command": "Ok", "enabled": true, "agents": ["claude","codex","copilot","agent","opencode"] },
        { "id": "qr-2", "label": "Продолжай", "command": "Продолжай", "enabled": true, "agents": ["claude","codex","copilot","agent","opencode"] },
        { "id": "qr-3", "label": "/clear", "command": "/clear", "enabled": true, "agents": ["claude","codex","copilot","agent","opencode"] },
        { "id": "qr-4", "label": "/model", "command": "/model", "enabled": true, "agents": ["claude","codex","copilot","agent","opencode"] },
        { "id": "qr-5", "label": "/exit", "command": "/exit", "enabled": true, "agents": ["claude","codex","copilot","agent"] },
        { "id": "qr-6", "label": "/new", "command": "/new", "enabled": true, "agents": ["opencode"] }
      ]
    }
  }
  ```
- Добавить `quickReplies` в `getConfigDefaults()` и `deepMergeConfig` должен корректно обрабатывать новую секцию (не выдавать warning как unknown field).

### REQ-2: Раздел настроек «Быстрые ответы»
- В `SettingsPage` добавить новую категорию «Быстрые ответы» после «ИИ-агенты».
- Каждый элемент списка отображается как строка настроек:
  - Поле ввода для `label` (текст кнопки).
  - Поле ввода для `command` (текст команды).
  - Переключатель `enabled` (вкл/выкл).
  - Блок переключателей для каждого доступного агента (`SUPPORTED_AGENTS`) — мультиселект через toggle per agent.
  - Кнопка удаления (×).
- Кнопка «Добавить быстрый ответ» создаёт новый элемент с пустыми `label`/`command`, `enabled: true`, `agents: []`.
- Изменения сохраняются через `_scheduleSave()`.
- При изменении настроек — оповещать `onSettingsChanged('quickReplies.items', ...)`.

### REQ-3: Динамические кнопки в статус-баре
- Удалить захардкоженные 5 кнопок `<button class="agent-cmd-btn">` из `index.html`.
- В `StatusBar._updateAgentCommandsPanel()` генерировать кнопки динамически на основе `config.quickReplies.items`, фильтруя по `enabled === true` и текущему `activeAgentId` в массиве `agents`.
- Если агент не запущен — панель скрыта (как сейчас).
- Клик по кнопке отправляет `command` в PTY (как сейчас).

### REQ-4: Инициализация и обратная совместимость
- При первой загрузке существующего `config.json` без `quickReplies` — `deepMergeConfig` должен добавить дефолтную секцию (это стандартное поведение при добавлении в `getConfigDefaults`).
- При сохранении настроек из UI — сохранять полную структуру `config`.
- Захардкоженный объект `AGENT_COMMANDS` в `status-bar.js` удалить.

## Ограничения
- Не менять `CONFIG_VERSION` (фича добавляет новые поля, но не ломает формат; `deepMergeConfig` должен поддержать их через defaults).
- Без миграции данных (нет существующих пользовательских быстрых ответов — только захардкоженные).
- Без изменений вне renderer/main процессов (нет изменений в PTY, Git, FileTree).
- Не использовать внешние UI-библиотеки — только vanilla JS + CSS (как в остальном проекте).

## Макеты и референсы

> Не применимо. Дизайн следует существующему стилю настроек (`settings-page.js` / `styles.css`).

## Кодстайл и конвенции

- **Vanilla JS**: все компоненты — ES6-классы, DOM-элементы создаются через `document.createElement`.
- **Именование приватных методов/полей**: префикс `_` (например, `_buildQuickRepliesCategory`).
- **События**: `addEventListener`, без inline-обработчиков.
- **CSS-классы**: kebab-case, префикс `settings-` для настроек, `agent-cmd-` для кнопок команд.
- **Конфиг**: чтение/запись через `config-loader.js`, структура — плоские объекты + массивы, версия `CONFIG_VERSION`.
- **IPC**: preload bridge `window.electronAPI`.
- **Сохранение настроек**: дебаунс 300 мс через `_scheduleSave()`.

## Переиспользуемые решения

| Что | Где | Зачем |
|-----|-----|-------|
| Структура `SettingsPage`, `_buildCategory`, `_createToggle`, `_createTextInput` | `src/renderer/settings-page.js` | Базовый паттерн для добавления новой категории настроек |
| `getConfigDefaults`, `deepMergeConfig`, `saveConfig` | `src/main/config-loader.js` | Добавить дефолты для `quickReplies` |
| `SUPPORTED_AGENTS` | `src/renderer/settings-page.js` (lines 1-7) | Список агентов для toggle-блока |
| Динамическая генерация кнопок агентов | `src/renderer/status-bar.js` (`_updateAgentButtons`) | Паттерн показа/скрытия элементов по условию |
| Отправка команды в PTY | `src/renderer/index.js` (lines 324-331) | Используется без изменений |

## Критерии приёмки

- [ ] При первом запуске (новый `config.json`) в разделе «Быстрые ответы» отображаются 6 дефолтных записей (Ok, Продолжай, /clear, /model, /exit, /new) с правильными агентами.
- [ ] Можно добавить новый быстрый ответ — он появляется в настройках и (если включён и привязан к агенту) в статус-баре при запуске этого агента.
- [ ] Можно удалить быстрый ответ — он исчезает из настроек и статус-бара.
- [ ] Можно отредактировать `label` и `command` — изменения сохраняются и отображаются в статус-баре.
- [ ] Можно выключить (`enabled: false`) быстрый ответ — кнопка не отображается в статус-баре.
- [ ] Можно выбрать/убрать агентов для ответа — кнопка показывается только у выбранных агентов.
- [ ] Запуск `claude` показывает кнопки Ok, Продолжай, /clear, /model, /exit (если все включены).
- [ ] Запуск `opencode` показывает кнопки Ok, Продолжай, /clear, /model, /new (если все включены).
- [ ] `config.json` содержит секцию `quickReplies.items` после любого изменения в настройках.
- [ ] Нет ошибок в консоли renderer/main при открытии настроек и запуске агентов.

## Затронутые файлы

1. `src/main/config-loader.js` — добавить `quickReplies` в `getConfigDefaults()`.
2. `src/renderer/settings-page.js` — добавить категорию «Быстрые ответы» и UI для управления списком.
3. `src/renderer/status-bar.js` — удалить `AGENT_COMMANDS`, динамически генерировать кнопки из `config.quickReplies.items`.
4. `src/renderer/index.html` — удалить захардкоженные `<button class="agent-cmd-btn">…</button>`.
5. `src/renderer/styles.css` — стили для новых элементов (строки быстрых ответов, toggle-блок агентов).
6. `src/renderer/index.js` — возможно, передать `quickReplies` в `StatusBar` при инициализации / обновлении.
