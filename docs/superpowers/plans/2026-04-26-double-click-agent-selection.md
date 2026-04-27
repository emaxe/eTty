# Double-Click Agent Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow double-clicking an agent button to manually set it as the active agent when the terminal is busy but no agent was auto-detected.

**Architecture:** StatusBar tracks `lastClickTime` per button to detect double-clicks (500ms threshold) within the `click` handler. When double-clicked while terminal is busy and no agent is active, it invokes `onSelectAgent`. The renderer callback sets `tab.activeAgentId` without sending any command to the PTY. Busy-state buttons use CSS class `status-agent-busy` instead of `disabled` attribute to allow click events through. Add CSS hover feedback for busy agent buttons to hint at double-click interactivity.

**Tech Stack:** Vanilla JS (Electron renderer), CSS

---

### Task 1: StatusBar — Add click-based double-click detection

**Files:**
- Modify: `src/renderer/status-bar.js`

**Context:** The `StatusBar` constructor currently attaches simple `click` listeners to agent buttons. We need to detect double-clicks (two clicks within 500ms) within the `click` handler itself, because native `dblclick` is unreliable in Electron when combined with click timers (OS threshold ~500ms vs JS timer ~250ms causes race conditions).

- [ ] **Step 1: Add click-based double-click detection in StatusBar constructor**

Modify the agent button loop in `StatusBar` constructor. Replace it with:

```js
    for (const button of this._agentButtons) {
      let lastClickTime = 0

      button.addEventListener('click', () => {
        const now = Date.now()
        const isDoubleClick = now - lastClickTime < 500
        lastClickTime = now

        // Double-click: если терминал занят и нет активного агента — назначаем
        if (isDoubleClick && this._activeTabBusy && !this._activeAgentId) {
          const agentId = button.dataset.agentId
          if (agentId) this._onSelectAgent?.(agentId)
          return
        }

        // Single-click: запуск агента только если терминал свободен
        if (button.disabled || button.classList.contains('status-agent-busy')) return
        const agentId = button.dataset.agentId
        if (agentId) this._onLaunchAgent?.(agentId)
      })
    }
```

- [ ] **Step 2: Store `onSelectAgent` callback**

Add `onSelectAgent` to constructor parameters and store it:

In constructor signature (line 8), change:
```js
  constructor({ btnEl, cwdEl, nodeEl, onOpen, agentButtons = [], onLaunchAgent, agentCommandsPanelEl = null, onAgentCommand = null, proxyToggleEl = null, onToggleProxy = null, quickReplies = { items: [] } }) {
```
to:
```js
  constructor({ btnEl, cwdEl, nodeEl, onOpen, agentButtons = [], onLaunchAgent, onSelectAgent, agentCommandsPanelEl = null, onAgentCommand = null, proxyToggleEl = null, onToggleProxy = null, quickReplies = { items: [] } }) {
```

Add after `this._onLaunchAgent = onLaunchAgent` (line 14):
```js
    this._onSelectAgent = onSelectAgent
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/status-bar.js
git commit -m "feat(status-bar): add double-click agent selection handler"
```

---

### Task 2: Renderer — Wire up `onSelectAgent` callback

**Files:**
- Modify: `src/renderer/index.js`

**Context:** The `StatusBar` is instantiated around line 322. We need to pass `onSelectAgent` and implement `selectAgentAsActive`.

- [ ] **Step 1: Implement `selectAgentAsActive` function**

Add this function right after `launchAgentInActiveTab` (after line 320):

```js
  const selectAgentAsActive = (agentId) => {
    const tab = tabBar.getActive()
    if (!tab || !tab.isBusy) return
    tab.activeAgentId = agentId
    syncStatusBarTerminalState()
  }
```

- [ ] **Step 2: Pass `onSelectAgent` to StatusBar constructor**

In the `StatusBar` constructor call (line 322), add `onSelectAgent`:

```js
  const statusBar = new StatusBar({
    btnEl: document.getElementById('btn-git-diff'),
    cwdEl: document.getElementById('status-cwd'),
    nodeEl: document.getElementById('status-node'),
    onOpen: () => gitPanel.show(tabBar.getActive()?.rootPath),
    agentButtons: [...document.querySelectorAll('.status-agent-btn')],
    onLaunchAgent: launchAgentInActiveTab,
    onSelectAgent: selectAgentAsActive,
    agentCommandsPanelEl: document.getElementById('agent-commands-panel'),
    onAgentCommand: (cmd) => {
      const tab = tabBar.getActive()
      if (tab) {
        tab.term.focus()
        window.electronAPI.ptyWrite(tab.pid, `\x1b[200~${cmd + ''}\x1b[201~`)
      }
    },
    proxyToggleEl: document.getElementById('btn-proxy-toggle'),
    onToggleProxy: (enabled) => {
      config.agents.proxyEnabled = enabled
      window.electronAPI.settingsSave(config)
    },
    quickReplies: config.quickReplies || { items: [] }
  })
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/index.js
git commit -m "feat(renderer): wire up onSelectAgent for double-click agent selection"
```

---

### Task 3: CSS — Add styles for busy agent buttons

**Files:**
- Modify: `src/renderer/styles.css`

**Context:** Busy-state buttons no longer use `disabled` attribute (to allow click events for double-click detection). Instead they use class `status-agent-busy`. We need styles that make them look disabled but hint at interactivity on hover.

- [ ] **Step 1: Add styles for status-agent-busy class**

After the `.status-agent-btn.status-agent-active` block (after line 960), add:

```css
.status-agent-btn.status-agent-busy {
  opacity: 0.35;
  cursor: default;
}
.status-agent-btn.status-agent-busy:hover {
  opacity: 0.6;
  cursor: pointer;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/styles.css
git commit -m "feat(styles): add hover feedback on disabled agent buttons for double-click hint"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- [x] Double-click on agent button when busy + no active agent → Task 1 (click-based detection, 500ms threshold)
- [x] Sets activeAgentId without sending command → Task 2 (Step 1 `selectAgentAsActive` — no PTY write)
- [x] Single click stays disabled when busy → Task 1 (click handler checks `status-agent-busy` class)
- [x] Busy buttons allow click events → Task 1 (uses `status-agent-busy` class instead of `disabled` attribute)
- [x] Auto-detection via OSC 133 unchanged — no code touched for OSC 133
- [x] Hiding inactive agents preserved — `_updateAgentButtons` logic unchanged

**2. Placeholder scan:** No TBDs, TODOs, or vague steps.

**3. Type consistency:** `_onSelectAgent` callback name matches `onSelectAgent` parameter everywhere.
