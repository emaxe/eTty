---
name: bugfix
description: "Use when the user reports a bug, asks to fix something, 'исправь баг', 'почини', 'bugfix', 'не работает', 'сломалось', or describes unexpected behavior that needs diagnosing and fixing."
tags: [bugfix, debugging, fix]
author: maksimklisin
version: "1.0.0"
scope: project
platforms: [claude-code]
dependencies: []
language: any
---

# Bugfix

Лёгкий процесс для диагностики и исправления багов без тяжёлого feature-planning.

---

## Phase 1: Описание бага

Если пользователь уже описал проблему — извлеки:
- Что происходит (фактическое поведение)
- Что ожидается (ожидаемое поведение)
- Шаги воспроизведения (если известны)

Если описание неполное — задай **один** уточняющий вопрос за раз:
1. «Что именно происходит не так?»
2. «Как воспроизвести?» (если не очевидно)
3. «Когда началось?» (если поможет с диагностикой)

Не задавай все вопросы разом.

---

## Phase 2: Диагностика

1. Определи область кода по описанию бага:

| Симптом | Где искать |
|---------|-----------|
| Терминал | `src/renderer/index.js`, `src/main/pty-manager.js`, `features/terminal/` |
| Файловое дерево | `src/renderer/file-tree.js`, `src/main/file-manager.js` |
| Редактор | `src/renderer/editor-panel.js`, `src/renderer/editor-languages.js` |
| Git-панель | `src/renderer/features/git/`, `src/main/ipc-handlers/git-handlers.js` |
| Вкладки | `src/renderer/tab-bar.js`, `src/main/tab-state.js` |
| Настройки | `src/renderer/settings-page.js`, `src/main/settings-store.js` |
| AI-агенты | `src/renderer/status-bar.js`, `src/main/agent-service.js` |
| IPC | `src/main/ipc-handlers/`, `src/preload/index.js`, `src/shared/ipc-channels.js` |

2. Запусти Explore-агент (Agent tool, subagent_type=Explore) для поиска причины:
   - Прочитай затронутые файлы
   - Поищи паттерн проблемы (`Grep`)
   - Проверь недавние изменения (`git log --oneline -10 -- <файл>`)

3. Сформулируй гипотезу причины и покажи пользователю:
   «Вероятная причина: {описание}. Файл: `{путь}:{строка}`. Исправляю?»

---

## Phase 3: Фикс

1. Реализуй исправление, соблюдая архитектурные инварианты из AGENTS.md:
   - DI для зависимостей
   - EventBus для коммуникации
   - StateStore для shared state
   - IPC_CHANNELS для имён каналов
   - Константы в `core/config/`
   - `destroy()` для cleanup

2. Если фикс затрагивает новый файл — прогони соответствующий чеклист:
   - Новый компонент → `.agents/rules/checklists/new-component.md`
   - Новый IPC handler → `.agents/rules/checklists/new-ipc-handler.md`

---

## Phase 4: Проверка

1. Сборка:

```bash
npm run build
```

Ожидаемо: без ошибок.

2. Быстрый прогон `code-quality.md`:
   - Прочитай `.agents/rules/checklists/code-quality.md`
   - Проверь только изменённые файлы по ключевым пунктам: SRP, DI, destroy(), нет console.log, нет магических чисел

3. Предложи пользователю проверить вручную в dev-режиме:
   «Запусти `npm run dev` и проверь: {конкретные шаги воспроизведения бага}. Баг должен быть исправлен.»

---

## Phase 5: Коммит

Предложи коммит:

```bash
git add <изменённые файлы>
git commit -m "fix: {краткое описание исправления}"
```

Формат: `fix:` + описание что починено (не «как починено»).

---

## Правила

- **Минимальный фикс.** Не рефактори код вокруг бага — только исправление.
- **Не создавай docs/features/.** Bugfix не требует спецификации и плана.
- **Одна проблема — один фикс.** Если обнаружил второй баг рядом — сообщи пользователю, но не чини в том же коммите.
- **Если баг сложный** (затрагивает 5+ файлов, требует архитектурных изменений) — предложи перейти на `/feature-planning` вместо bugfix.
