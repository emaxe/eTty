# Shift+Enter / Ctrl+Enter — Kitty Keyboard Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Shift+Enter, Ctrl+Enter, and Ctrl+Shift+Enter not sending Kitty protocol escape sequences to the PTY.

**Architecture:** Add a single `attachCustomKeyEventHandler` call in `setupTabHandlers` that intercepts modifier+Enter keydowns before xterm.js processes them and writes the correct Kitty escape sequence directly via `ptyWrite`.

**Tech Stack:** Electron 33, xterm.js, electron-vite

---

## File Map

| Action  | File                          | Change                                      |
|---------|-------------------------------|---------------------------------------------|
| Modify  | `src/renderer/index.js:108`   | Add `attachCustomKeyEventHandler` in `setupTabHandlers` |

---

### Task 1: Create the feature branch

- [ ] **Step 1: Create and switch to branch**

```bash
git checkout -b fix/shift-enter-kitty-protocol
```

Expected output:
```
Switched to a new branch 'fix/shift-enter-kitty-protocol'
```

---

### Task 2: Add Kitty key handler in setupTabHandlers

**Files:**
- Modify: `src/renderer/index.js:108-112`

- [ ] **Step 1: Open `src/renderer/index.js` and locate `setupTabHandlers`**

Current state of `setupTabHandlers` (lines 108–112):

```js
function setupTabHandlers(tab) {
  // Ввод: терминал → PTY
  tab.term.onData((data) => {
    window.electronAPI.ptyWrite(tab.pid, data)
  })
```

- [ ] **Step 2: Insert `attachCustomKeyEventHandler` before `onData`**

Replace the opening of `setupTabHandlers` so it becomes:

```js
function setupTabHandlers(tab) {
  // Kitty keyboard protocol: перехватываем modifier+Enter до xterm.js
  tab.term.attachCustomKeyEventHandler((event) => {
    if (event.type === 'keydown' && event.key === 'Enter') {
      if (event.shiftKey && !event.ctrlKey) {
        window.electronAPI.ptyWrite(tab.pid, '\x1b[13;2u')
        return false
      }
      if (event.ctrlKey && !event.shiftKey) {
        window.electronAPI.ptyWrite(tab.pid, '\x1b[13;5u')
        return false
      }
      if (event.ctrlKey && event.shiftKey) {
        window.electronAPI.ptyWrite(tab.pid, '\x1b[13;6u')
        return false
      }
    }
    return true
  })

  // Ввод: терминал → PTY
  tab.term.onData((data) => {
    window.electronAPI.ptyWrite(tab.pid, data)
  })
```

- [ ] **Step 3: Запустить приложение и проверить вручную**

```bash
npm run dev
```

Открыть терминал в приложении. Запустить `cat -v` (показывает escape-последовательности).  
Нажать:
- `Shift+Enter` — должно отобразиться `^[[13;2u`
- `Ctrl+Enter` — должно отобразиться `^[[13;5u`
- `Ctrl+Shift+Enter` — должно отобразиться `^[[13;6u`
- Обычный `Enter` — должно отобразиться `^M` (без изменений)

- [ ] **Step 4: Закрыть dev-сервер** (`Ctrl+C`)

- [ ] **Step 5: Закоммитить**

```bash
git add src/renderer/index.js
git commit -m "fix: send Kitty escape sequences for Shift/Ctrl+Enter"
```

---

### Task 3: Удалить файл из backlog

**Files:**
- Delete: `docs/backlog/shift-enter-not-working.md`

- [ ] **Step 1: Удалить backlog-файл**

```bash
git rm docs/backlog/shift-enter-not-working.md
```

- [ ] **Step 2: Закоммитить**

```bash
git commit -m "docs: close shift-enter backlog item"
```
