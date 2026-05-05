# Задача A3: Очистка временных ZDOTDIR в PtyManager

**Приоритет:** 🔴 Critical  
**Сложность:** S  
**Время:** 1-2ч  
**Ветка:** `main`  

---

## Цель

Каждая PTY-сессия в `PtyManager` создаёт временный ZDOTDIR (`/tmp/etty-XXXXXX`) с кастомными `.zshenv` и `.zshrc`. При закрытии вкладки (`kill()`) или приложения (`killAll()`) эти директории остаются в `/tmp` навсегда. Нужно сохранять путь к `zdotdir` в session-объекте и удалять его при cleanup.

---

## Архитектурные инварианты (обязательно)

- **DI:** Зависимости через DI Container, не глобалы.
- **Config:** Магические числа и интервалы — в `core/config/`.
- **Cleanup:** каждый ресурс должен быть освобождён.

---

## Что сделать

### 1. `src/main/pty-manager.js` — Сохранить zdotdir в session

- [ ] В методе `_createZdotdir()` уже возвращается `tmpDir` — это путь к zdotdir.
- [ ] В методе `create()` сохранить `zdotdir` в session-объекте при `this.sessions.set()`:
  ```js
  this.sessions.set(ptyProcess.pid, { pty: ptyProcess, webContents, tabId, historyFile, initialHistSize, zdotdir })
  ```

### 2. `src/main/pty-manager.js` — Удалять zdotdir в `kill()`

- [ ] Добавить `import log from 'electron-log'` в начало файла.
- [ ] В методе `kill()` после `session.pty.kill()` и `this.sessions.delete(pid)`:
  ```js
  if (session.zdotdir) {
    try {
      fs.rmSync(session.zdotdir, { recursive: true, force: true })
    } catch (err) {
      log.warn('pty-manager: failed to cleanup zdotdir', session.zdotdir, err.message)
    }
  }
  ```

### 3. `src/main/pty-manager.js` — Удалять все zdotdir в `killAll()`

- [ ] В методе `killAll()` перед `this.sessions.clear()` — собрать все `zdotdir` из сессий и удалить каждый:
  ```js
  const zdotdirs = []
  for (const [, session] of this.sessions) {
    if (session.zdotdir) zdotdirs.push(session.zdotdir)
    session.pty.kill()
  }
  this.sessions.clear()
  for (const zdotdir of zdotdirs) {
    try {
      fs.rmSync(zdotdir, { recursive: true, force: true })
    } catch (err) {
      log.warn('pty-manager: failed to cleanup zdotdir on killAll', zdotdir, err.message)
    }
  }
  ```

### 4. Обработать edge case: onExit

- [ ] В `ptyProcess.onExit()` callback в методе `create()` — тоже удалять `zdotdir` при нормальном выходе процесса:
  ```js
  ptyProcess.onExit(({ exitCode, signal }) => {
    // ... existing code ...
    this.sessions.delete(ptyProcess.pid)
    // Cleanup zdotdir
    if (zdotdir) {
      try {
        fs.rmSync(zdotdir, { recursive: true, force: true })
      } catch (err) {
        log.warn('pty-manager: failed to cleanup zdotdir on exit', zdotdir, err.message)
      }
    }
  })
  ```
  **Важно:** `zdotdir` доступен как closure variable из `create()`, так что не нужно брать из session после `delete`.

---

## Чеклист реализации

- [ ] Прочитать текущий `src/main/pty-manager.js`.
- [ ] Добавить `zdotdir` в session-объект при `this.sessions.set()`.
- [ ] Добавить cleanup `zdotdir` в `kill()`.
- [ ] Добавить cleanup всех `zdotdir` в `killAll()`.
- [ ] Добавить cleanup `zdotdir` в `onExit` callback.
- [ ] Добавить `import log from 'electron-log'` если его нет.
- [ ] Проверить `npm run build` — ошибок нет.

---

## Критерий приёмки

1. `grep -n "zdotdir" src/main/pty-manager.js` — путь сохранён в session, есть cleanup в `kill()`, `killAll()`, `onExit`.
2. `grep -n "rmSync" src/main/pty-manager.js` — есть вызовы `fs.rmSync` с `recursive: true, force: true`.
3. `npm run build` проходит без ошибок.
4. После закрытия вкладки (`Cmd+W`) или приложения — в `/tmp` нет директорий `etty-XXXXXX`.

---

## Файлы, которые точно будут изменены

- `src/main/pty-manager.js`

---

## Связанные задачи

- **A1** — `destroy()` у компонентов (уже сделано).
- **A2** — Cleanup при закрытии приложения (уже сделано, `killAll()` теперь вызывается в `before-quit`).
- **A4** — Очистка FileTree watchers и таймеров (следующая задача после A3).

---

*Промт сгенерирован из `docs/backlog/best/critical-tasks.md` — задача A3.*
