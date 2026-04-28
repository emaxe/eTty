---
name: code-review
description: "Use when the user asks to review code, check quality, 'проверь код', 'code review', 'ревью', 'проверка качества', or wants to validate changes against project architecture before committing."
tags: [review, quality, architecture]
author: maksimklisin
version: "1.0.0"
scope: project
platforms: [claude-code]
dependencies: []
language: any
---

# Code Review

Проверка изменённого кода на соответствие архитектурным инвариантам и конвенциям проекта eTty.

---

## Phase 1: Определить скоуп

1. Определи изменённые файлы:

```bash
git diff --name-only HEAD
```

Если нет unstaged изменений — проверь staged:

```bash
git diff --cached --name-only
```

Если и staged пусто — спроси у пользователя: сравнить с конкретным коммитом/веткой?

```bash
git diff --name-only <base>..HEAD
```

2. Выведи список файлов пользователю: «Проверяю N файлов: ...»

---

## Phase 2: Загрузить чеклисты

Прочитай основной чеклист:
- `.agents/rules/checklists/code-quality.md`

Определи типы изменений и загрузи специализированные чеклисты:
- Новые файлы в `src/renderer/components/` → `.agents/rules/checklists/new-component.md`
- Новые/изменённые файлы в `src/main/ipc-handlers/`, `src/preload/`, `src/shared/ipc-channels.js` → `.agents/rules/checklists/new-ipc-handler.md`
- Если изменения затрагивают 3+ файлов в разных слоях (main, renderer, preload) → `.agents/rules/checklists/new-feature.md`

---

## Phase 3: Проверка

Для каждого изменённого файла:

1. Прочитай файл (Read tool)
2. Прогони каждый пункт из `code-quality.md`
3. Если файл попадает под специализированный чеклист — прогони и его
4. Записывай замечания с указанием файла и строки

Используй Explore-агент (Agent tool, subagent_type=Explore) для параллельной проверки нескольких файлов, если файлов больше 5.

---

## Phase 4: Отчёт

Выведи отчёт в формате:

```
## Code Review: {N} файлов проверено

### Пройдено
- {пункт чеклиста}: OK — {краткое пояснение}
- ...

### Замечания
- `src/renderer/file.js:42` — {описание проблемы} (нарушение: {пункт чеклиста})
- ...

### Рекомендации
- {необязательные улучшения, не блокирующие коммит}
```

---

## Phase 5: Автофикс

Если есть замечания — спроси пользователя:

«Исправить найденные замечания автоматически?»
- Да — исправить все
- Выборочно — показать список, пользователь выберет
- Нет — оставить как есть

При исправлении — соблюдай архитектурные инварианты из AGENTS.md.

---

## Правила

- **Не блокировать на рекомендациях.** Рекомендации — это «nice to have», не «must fix».
- **Не выдумывать проблемы.** Если код соответствует чеклисту — пиши OK. Не ищи проблемы ради отчёта.
- **Конкретика.** Каждое замечание — файл, строка, что не так, как исправить.
- **Не менять существующий стиль.** Если проект использует определённый паттерн — следуй ему, даже если лично предпочёл бы другой.
