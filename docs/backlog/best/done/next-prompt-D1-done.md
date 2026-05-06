# Промт: D1 — Удалить дублирование `countDiffLines`

**Приоритет:** 🔴 Critical  
**Ветка:** `main` (работать в текущей ветке, не создавать новую)  
**Сложность:** XS  
**Оценка времени:** 30 минут

---

## Контекст

Функция `countDiffLines` дублируется в двух файлах:
- `src/main/ipc-handlers/git-handlers.js:9-17`
- `src/main/git-service.js:4-12`

Оба определения идентичны. Нужно оставить одно — в `git-service.js` (это service-слой), и импортировать его в `git-handlers.js`.

## Текущий код

**`src/main/ipc-handlers/git-handlers.js`** (строки 1–17):
```javascript
import simpleGit from 'simple-git'
import fs from 'fs/promises'
import path from 'path'
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'

/**
 * Считает строки additions (+) и deletions (-) в unified diff, игнорируя заголовки +++ и ---.
 */
function countDiffLines(diff) {
  let additions = 0
  let deletions = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++
  }
  return { additions, deletions }
}
```

**`src/main/git-service.js`** (весь файл):
```javascript
/**
 * Считает строки additions (+) и deletions (-) в unified diff, игнорируя заголовки +++ и ---.
 */
export function countDiffLines(diff) {
  let additions = 0
  let deletions = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++
  }
  return { additions, deletions }
}
```

---

## Задачи

### 1. Удалить локальное определение из `git-handlers.js`

Удалить функцию `countDiffLines` (строки 6–17) из `src/main/ipc-handlers/git-handlers.js`.

### 2. Добавить импорт из `git-service.js`

В начало `git-handlers.js` добавить импорт:
```javascript
import { countDiffLines } from '../git-service.js'
```

**Важно:** путь от `src/main/ipc-handlers/` до `src/main/git-service.js` — `../git-service.js`.

### 3. Убедиться, что `countDiffLines` используется в `git-handlers.js`

Проверить, что в `git-handlers.js` есть вызовы `countDiffLines` (должны быть, иначе функция была мёртвым кодом). Если вызовов нет — убедиться, что это не ошибка.

### 4. Проверить `git-service.js`

Файл `src/main/git-service.js` уже экспортирует функцию — изменений не требуется.

### 5. Собрать и проверить

- `npm run build` — должен пройти без ошибок
- Убедиться, что Git-панель продолжает работать (diff отображает additions/deletions корректно)

---

## Архитектурные ограничения (из AGENTS.md)

- **IPC_CHANNELS:** каналы только через `shared/ipc-channels.js`, нет строковых литералов — уже соблюдается
- **DI:** зависимости через DI Container — не применимо к чистым utility-функциям

---

## Критерии приёмки

- [ ] `grep -r "function countDiffLines" src/main/` возвращает ровно 1 результат (в `git-service.js`)
- [ ] `grep -r "countDiffLines" src/main/` показывает импорт в `git-handlers.js` и определение в `git-service.js`
- [ ] `npm run build` проходит без ошибок
- [ ] Git diff в панели продолжает показывать additions/deletions корректно

---

## После выполнения

1. Обновить `docs/backlog/best/critical-tasks.md`:
   - D1 статус: ✅ Завершено
   - Добавить дату выполнения
2. Удалить этот промт-файл или пометить как выполненный

---

**Стартовый файл:** `src/main/ipc-handlers/git-handlers.js`  
**Целевые файлы:** `src/main/ipc-handlers/git-handlers.js`
