# Design: AI Agent Launch Buttons in Status Bar

**Date:** 2026-04-20  
**Scope:** Status bar + settings + system agent discovery + terminal launch flow

## Problem

Нужно добавить быстрый запуск AI-агентов из статусбара и не допускать конфликтов с уже занятым терминалом.
Приложение также должно показывать в настройках, какие агенты действительно установлены в системе,
и позволять принудительно отключать конкретные агенты.

## Goals

- Добавить кнопки запуска поддерживаемых AI-агентов в статусбар.
- Автоматически определять доступность агентов в системе.
- Блокировать запуск, когда активный терминал занят (`OSC 133;C`).
- Подсвечивать только кнопку текущего запущенного AI-агента (если запуск был из UI).
- Показать в настройках полный список поддерживаемых агентов со статусом обнаружения и toggle принудительного отключения.
- Выполнять проверку установленных агентов:
  - при старте приложения
  - при открытии страницы настроек

## Non-Goals

- Автоматическое завершение процессов агентов.
- Парсинг вывода CLI-агентов для определения внутреннего состояния сессии.
- Переключение профилей/аргументов запуска агентов (используются базовые команды запуска).

## Supported Agents and Launch Commands

| Agent ID | Label | Availability Check | Launch Command |
|---|---|---|---|
| `claude` | Claude | `command -v claude` | `claude` |
| `codex` | Codex | `command -v codex` | `codex` |
| `copilot` | Copilot | `command -v gh` + `gh extension list` contains `github/gh-copilot` | `gh copilot` |
| `agent` | Agent | `command -v agent` | `agent` |
| `opencode` | OpenCode | `command -v opencode` | `opencode` |

## Architecture

### 1. Main Process: Agent Discovery Service

Добавляется модуль `src/main/agent-service.js`, который:

- хранит декларативный список поддерживаемых агентов;
- проверяет доступность каждого агента через shell (`zsh -lc ...`);
- возвращает нормализованный статус по всем агентам;
- поддерживает принудительный refresh.

`src/main/index.js` регистрирует IPC:

- `agents:get-status` — вернуть последний кэш или сделать lazy-check;
- `agents:refresh` — выполнить повторный детект и вернуть актуальное состояние.

### 2. Preload Bridge

`src/preload/index.js` получает два новых метода:

- `agentsGetStatus()`
- `agentsRefresh()`

### 3. Settings Persistence

`src/main/settings-store.js` расширяется секцией:

```json
{
  "agents": {
    "forceDisabled": {
      "claude": false,
      "codex": false,
      "copilot": false,
      "agent": false,
      "opencode": false
    }
  }
}
```

Deep merge сохраняется, чтобы новые ключи подхватывались автоматически.

### 4. Renderer: Status Bar

`src/renderer/index.html` расширяется контейнером кнопок агентов в `#status-bar`.

`src/renderer/status-bar.js` расширяется:

- хранит статус доступности агентов из main;
- хранит статус принудительного отключения из settings;
- умеет принимать состояние активной вкладки (`isBusy`, `activeAgentId`);
- вычисляет `disabled`/`active` для каждой кнопки;
- при клике вызывает callback запуска агента.

### 5. Renderer: Tab-Level State and Launch Logic

`src/renderer/index.js`:

- добавляет поле `tab.activeAgentId` на вкладку;
- при клике по кнопке агента отправляет команду в PTY активной вкладки (`<cmd>\n`);
- перед запуском проверяет, что вкладка не busy;
- при запуске выставляет `tab.activeAgentId = <agentId>`;
- в OSC 133 обработчике:
  - при `C` (`busy=true`) просто блокирует кнопки;
  - при `A` (`busy=false`) сбрасывает `tab.activeAgentId`;
- при переключении вкладки синхронизирует визуал статусбара с состоянием выбранной вкладки.

### 6. Renderer: Settings UI

`src/renderer/settings-page.js` добавляет категорию "ИИ-агенты":

- список всех поддерживаемых агентов;
- бейдж обнаружения (`Обнаружен` / `Не обнаружен`);
- toggle "Принудительно отключить";
- при `show()` выполняется `agentsRefresh()` и перерисовка статусов.

## Interaction Rules

1. Кнопка агента доступна только если одновременно:
   - агент обнаружен;
   - агент не force-disabled;
   - активная вкладка не busy.
2. Когда активная вкладка busy:
   - все agent-кнопки disabled;
   - если `activeAgentId` задан, подсвечивается только его кнопка.
3. Когда вкладка становится idle:
   - `activeAgentId` сбрасывается;
   - кнопки снова доступны по правилам из п.1.

## Error Handling

- Ошибки `agents:refresh`/`agents:get-status` не ломают UI; в таком случае агент считается недоступным.
- Ошибка отправки команды в PTY приводит к мягкому no-op (кнопка не переводится в active).
- Если активная вкладка отсутствует, кнопки отключаются.

## Files to Change

- Create: `src/main/agent-service.js`
- Modify: `src/main/index.js`
- Modify: `src/preload/index.js`
- Modify: `src/main/settings-store.js`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/styles.css`
- Modify: `src/renderer/status-bar.js`
- Modify: `src/renderer/index.js`
- Modify: `src/renderer/settings-page.js`

## Verification Strategy

- Manual smoke via `npm run dev`:
  - проверить отображение кнопок агентов;
  - проверить disable при busy-состоянии;
  - проверить подсветку текущего агента;
  - проверить индикацию обнаружения и force-disable в настройках;
  - проверить refresh статуса агентов при открытии настроек.
