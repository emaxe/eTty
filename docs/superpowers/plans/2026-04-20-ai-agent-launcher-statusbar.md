# AI Agent Launcher in Status Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить запуск AI-агентов из статусбара с автодетектом установленных CLI, блокировкой при busy-терминале и управлением доступностью агентов в настройках.

**Architecture:** Логика детекта CLI-агентов живет в main (`agent-service.js`) и отдается в renderer через IPC (`agents:get-status`, `agents:refresh`). Renderer использует эти данные в двух местах: кнопки статусбара и раздел настроек. Статус запуска агента хранится per-tab (`activeAgentId`) и синхронизируется с OSC 133 busy/idle сигналами.

**Tech Stack:** Electron 33, electron-vite, node-pty, zsh, vanilla JS renderer

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `src/main/agent-service.js` | Детект поддерживаемых CLI-агентов и кэш их статуса |
| Modify | `src/main/index.js` | Регистрация IPC `agents:get-status` и `agents:refresh` |
| Modify | `src/preload/index.js` | Экспорт `agentsGetStatus` и `agentsRefresh` в renderer |
| Modify | `src/main/settings-store.js` | Дефолтные настройки `agents.forceDisabled` + deep merge |
| Modify | `src/renderer/index.html` | Разметка кнопок AI-агентов в статусбаре |
| Modify | `src/renderer/styles.css` | Стили кнопок агентов, disabled/active состояния |
| Modify | `src/renderer/status-bar.js` | Логика доступности и состояния кнопок агентов |
| Modify | `src/renderer/index.js` | Запуск агента в PTY, per-tab `activeAgentId`, синхронизация busy |
| Modify | `src/renderer/settings-page.js` | UI списка агентов, индикатор обнаружения, force-disable |

---

### Task 1: Add main-process agent discovery service

**Files:**
- Create: `src/main/agent-service.js`

- [ ] **Step 1: Create supported-agent catalog and command checks**

```js
export const SUPPORTED_AGENTS = [
  { id: 'claude', label: 'Claude Code', launch: 'claude', check: 'command -v claude >/dev/null 2>&1' },
  { id: 'codex', label: 'Codex', launch: 'codex', check: 'command -v codex >/dev/null 2>&1' },
  { id: 'copilot', label: 'Copilot', launch: 'gh copilot', check: 'command -v gh >/dev/null 2>&1 && gh extension list | grep -q "github/gh-copilot"' },
  { id: 'agent', label: 'Agent (Cursor)', launch: 'agent', check: 'command -v agent >/dev/null 2>&1' },
  { id: 'opencode', label: 'OpenCode', launch: 'opencode', check: 'command -v opencode >/dev/null 2>&1' }
]
```

- [ ] **Step 2: Add async detector with timeout and safe fallback**

```js
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

async function checkAgent(checkCmd) {
  try {
    await execFileAsync('/bin/zsh', ['-lc', checkCmd], { timeout: 2500 })
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 3: Add AgentService class with cache and refresh API**

```js
export class AgentService {
  constructor() {
    this._cache = null
  }

  async refresh() {
    const agents = []
    for (const a of SUPPORTED_AGENTS) {
      agents.push({ ...a, detected: await checkAgent(a.check) })
    }
    this._cache = { checkedAt: Date.now(), agents }
    return this._cache
  }

  async getStatus() {
    if (!this._cache) return this.refresh()
    return this._cache
  }
}
```

- [ ] **Step 4: Verify module exports parse correctly**

Run: `node -e "import('./src/main/agent-service.js').then(m=>console.log(!!m.AgentService, m.SUPPORTED_AGENTS.length)).catch(()=>process.exit(1))"`  
Expected: `true 5`

---

### Task 2: Wire IPC for agent status in main + preload

**Files:**
- Modify: `src/main/index.js`
- Modify: `src/preload/index.js`

- [ ] **Step 1: Instantiate AgentService in `src/main/index.js`**

```js
import { AgentService } from './agent-service.js'
const agentService = new AgentService()
```

- [ ] **Step 2: Register new IPC handlers in main**

```js
ipcMain.handle('agents:get-status', async () => agentService.getStatus())
ipcMain.handle('agents:refresh', async () => agentService.refresh())
```

- [ ] **Step 3: Trigger initial discovery on app start**

```js
app.whenReady().then(() => {
  agentService.refresh().catch(() => {})
  // existing initialization...
})
```

- [ ] **Step 4: Expose bridge methods in preload**

```js
agentsGetStatus: () => ipcRenderer.invoke('agents:get-status'),
agentsRefresh: () => ipcRenderer.invoke('agents:refresh'),
```

- [ ] **Step 5: Verify IPC contract compiles in renderer bundle**

Run: `npm run build`  
Expected: build completes without missing IPC method errors.

---

### Task 3: Extend settings schema for force-disabled agents

**Files:**
- Modify: `src/main/settings-store.js`

- [ ] **Step 1: Add default `agents.forceDisabled` block**

```js
agents: {
  forceDisabled: {
    claude: false,
    codex: false,
    copilot: false,
    agent: false,
    opencode: false
  }
}
```

- [ ] **Step 2: Extend deep merge in `loadSettings()`**

```js
agents: {
  ...defaults.agents,
  ...data.agents,
  forceDisabled: {
    ...defaults.agents.forceDisabled,
    ...(data.agents?.forceDisabled || {})
  }
}
```

- [ ] **Step 3: Verify backward compatibility with old settings file**

Run: `npm run build`  
Expected: no runtime/config parse errors; defaults still applied.

---

### Task 4: Add agent buttons markup and styles in status bar

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Add agent buttons container into status bar layout**

```html
<div id="status-agents" class="status-agents">
  <button class="status-bar-btn status-agent-btn" data-agent-id="claude">Claude</button>
  <button class="status-bar-btn status-agent-btn" data-agent-id="codex">Codex</button>
  <button class="status-bar-btn status-agent-btn" data-agent-id="copilot">Copilot</button>
  <button class="status-bar-btn status-agent-btn" data-agent-id="agent">Agent</button>
  <button class="status-bar-btn status-agent-btn" data-agent-id="opencode">OpenCode</button>
</div>
```

- [ ] **Step 2: Add CSS for status-agent group and states**

```css
.status-agents { display: flex; gap: 4px; align-items: center; }
.status-agent-btn { opacity: 0.95; }
.status-agent-btn:disabled { opacity: 0.35; cursor: default; }
.status-agent-btn.status-agent-active {
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
}
```

- [ ] **Step 3: Verify visual layout in desktop and narrow width**

Run: `npm run dev`  
Expected: status bar remains one-line; buttons do not overlap git indicator.

---

### Task 5: Implement status-bar agent state machine

**Files:**
- Modify: `src/renderer/status-bar.js`

- [ ] **Step 1: Extend constructor API with agent callbacks and elements**

```js
constructor({ btnEl, cwdEl, nodeEl, onOpen, agentButtons = [], onLaunchAgent }) {
  this._agentButtons = agentButtons
  this._onLaunchAgent = onLaunchAgent
  this._agentsStatus = new Map()
  this._forceDisabled = {}
  this._activeTabBusy = false
  this._activeAgentId = null
}
```

- [ ] **Step 2: Bind click handlers for agent buttons**

```js
for (const btn of this._agentButtons) {
  btn.addEventListener('click', () => {
    if (btn.disabled) return
    this._onLaunchAgent?.(btn.dataset.agentId)
  })
}
```

- [ ] **Step 3: Add public methods for external state updates**

```js
setAgentsStatus(payload) { /* map by id, then this._updateAgentButtons() */ }
setForceDisabled(forceDisabled) { this._forceDisabled = forceDisabled || {}; this._updateAgentButtons() }
setTerminalState({ isBusy, activeAgentId }) { this._activeTabBusy = !!isBusy; this._activeAgentId = activeAgentId || null; this._updateAgentButtons() }
```

- [ ] **Step 4: Implement `_updateAgentButtons()` decision logic**

```js
const enabled = detected && !forceDisabled && !this._activeTabBusy
btn.disabled = !enabled
btn.classList.toggle('status-agent-active', this._activeTabBusy && this._activeAgentId === id)
```

- [ ] **Step 5: Keep existing git/cwd polling behavior unchanged**

Run: `npm run build`  
Expected: `status-bar.js` builds and existing git status button still updates.

---

### Task 6: Add per-tab agent launch flow in renderer orchestrator

**Files:**
- Modify: `src/renderer/index.js`

- [ ] **Step 1: Add per-tab state field on tab creation/restore**

```js
tab.activeAgentId = null
```

- [ ] **Step 2: Create agent command map and launch handler**

```js
const AGENT_COMMANDS = {
  claude: 'claude\n',
  codex: 'codex\n',
  copilot: 'gh copilot\n',
  agent: 'agent\n',
  opencode: 'opencode\n'
}

const launchAgentInActiveTab = (agentId) => {
  const tab = tabBar.getActive()
  if (!tab || tab.isBusy) return
  const cmd = AGENT_COMMANDS[agentId]
  if (!cmd) return
  tab.activeAgentId = agentId
  window.electronAPI.ptyWrite(tab.pid, cmd)
  statusBar.setTerminalState({ isBusy: tab.isBusy, activeAgentId: tab.activeAgentId })
}
```

- [ ] **Step 3: Pass agent buttons and launch callback to `StatusBar`**

```js
agentButtons: [...document.querySelectorAll('.status-agent-btn')],
onLaunchAgent: launchAgentInActiveTab,
```

- [ ] **Step 4: Sync status bar on tab switch and busy changes**

```js
statusBar.setTerminalState({ isBusy: tab.isBusy, activeAgentId: tab.activeAgentId })
```

In OSC 133 handler:

```js
if (data.startsWith('A')) {
  tab.isBusy = false
  tab.activeAgentId = null
}
```

- [ ] **Step 5: Load and apply agent availability + settings on init**

```js
const agentStatus = await window.electronAPI.agentsGetStatus()
statusBar.setAgentsStatus(agentStatus)
statusBar.setForceDisabled(settings.agents?.forceDisabled || {})
```

- [ ] **Step 6: Verify command dispatch**

Run: `npm run dev`  
Expected: click on `Claude` writes `claude` command into active terminal and marks button active while terminal is busy.

---

### Task 7: Add AI agents section in settings overlay

**Files:**
- Modify: `src/renderer/settings-page.js`

- [ ] **Step 1: Add local cache for discovered agent status**

```js
this._agentDiscovery = { agents: [] }
```

- [ ] **Step 2: Refresh discovery on `show()` before render update**

```js
async show() {
  this._overlay.classList.remove('hidden')
  this._agentDiscovery = await window.electronAPI.agentsRefresh().catch(() => ({ agents: [] }))
  this._renderAgentsCategory()
}
```

- [ ] **Step 3: Add category rows for all supported agents**

```js
{
  label: 'Claude Code',
  control: this._buildAgentControl('claude', detected)
}
```

Control includes status badge + toggle that updates:

```js
this._settings.agents.forceDisabled[agentId] = val
this._onSettingsChanged('agents.forceDisabled', this._settings.agents.forceDisabled)
this._scheduleSave()
```

- [ ] **Step 4: Add helper for discovery badge**

```js
badge.textContent = detected ? 'Обнаружен' : 'Не обнаружен'
badge.className = detected ? 'agent-detected' : 'agent-missing'
```

- [ ] **Step 5: Verify settings interactions**

Run: `npm run dev`  
Expected: opening settings refreshes status; toggling force-disable immediately disables/enables corresponding status-bar button.

---

### Task 8: End-to-end verification and commit

**Files:**
- Modify: `src/main/agent-service.js`
- Modify: `src/main/index.js`
- Modify: `src/preload/index.js`
- Modify: `src/main/settings-store.js`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/styles.css`
- Modify: `src/renderer/status-bar.js`
- Modify: `src/renderer/index.js`
- Modify: `src/renderer/settings-page.js`

- [ ] **Step 1: Build for regression check**

Run: `npm run build`  
Expected: build succeeds.

- [ ] **Step 2: Manual functional checklist in dev mode**

Run: `npm run dev` and verify:

```text
1) При idle кнопки обнаруженных и не отключенных агентов активны.
2) При busy кнопки disabled.
3) Если busy после запуска из UI — подсвечен только выбранный агент.
4) После возврата в idle подсветка сбрасывается.
5) В Settings видно 5 поддерживаемых агентов и их статус обнаружения.
6) Toggle force-disable в Settings сразу влияет на кнопку в статусбаре.
7) Статусы агентов обновляются при открытии Settings.
```

- [ ] **Step 3: Stage and commit**

```bash
git add src/main/agent-service.js src/main/index.js src/preload/index.js src/main/settings-store.js src/renderer/index.html src/renderer/styles.css src/renderer/status-bar.js src/renderer/index.js src/renderer/settings-page.js
git commit -m "feat: add AI agent launcher with detection and settings controls"
```

---

## Self-Review Notes

- Spec coverage: все требования покрыты (кнопки, детект, busy-блокировка, подсветка текущего агента, settings-индикация, force-disable, refresh при старте и открытии settings).
- Placeholder scan: отсутствуют `TODO/TBD` и абстрактные шаги без конкретики.
- Type consistency: идентификаторы агентов и ключи настроек едины (`claude`, `codex`, `copilot`, `agent`, `opencode`).
