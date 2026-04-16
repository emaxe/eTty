# Design: Shift+Enter / Ctrl+Enter — Kitty Keyboard Protocol

**Date:** 2026-04-16  
**Branch:** `fix/shift-enter-kitty-protocol`

## Problem

xterm.js sends `\r` for both `Enter` and `Shift+Enter`, making them indistinguishable.
Modern TUI apps (opencode, Neovim, etc.) use the **Kitty keyboard protocol** and expect
specific escape sequences for modifier+Enter combinations.

## Solution

Add `attachCustomKeyEventHandler` in `setupTabHandlers` (`src/renderer/index.js`) to
intercept modifier+Enter keydowns before xterm.js processes them, and write the correct
Kitty escape sequence directly to the PTY.

### Escape sequences

| Key combo        | Sequence      |
|------------------|---------------|
| Shift+Enter      | `\x1b[13;2u`  |
| Ctrl+Enter       | `\x1b[13;5u`  |
| Ctrl+Shift+Enter | `\x1b[13;6u`  |

### Implementation

In `setupTabHandlers`, before `tab.term.onData`:

```js
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
```

Returning `false` prevents xterm.js from sending the default `\r`.

## Scope

- **Changed file:** `src/renderer/index.js` — function `setupTabHandlers` only
- No changes to main process, preload, or other renderer files

## Why not `modifyOtherKeys`?

The xterm.js option `modifyOtherKeys: 2` is unstable across versions and does not
reliably cover Enter-based combos. The `customKeyEventHandler` approach is explicit,
version-stable, and easy to extend.
