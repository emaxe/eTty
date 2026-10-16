import { resolveAgentIdByProcess } from '../../shared/agent-command-match.js'

let failed = false

function check(label, fn) {
  try {
    fn()
    console.log(`✅ ${label}`)
  } catch (e) {
    console.error(`❌ ${label}: ${e.message}`)
    failed = true
  }
}

function assertEq(actual, expected) {
  if (actual !== expected) throw new Error(`ожидалось ${expected}, получено ${actual}`)
}

const candidates = [
  { id: 'claude', bases: ['claude'] },
  { id: 'codex', bases: ['codex'] },
  { id: 'copilot', bases: ['copilot'] },
  { id: 'agent', bases: ['agent'] },
  { id: 'my-ai', bases: ['myai'] }
]

check('имя процесса claude', () => {
  assertEq(resolveAgentIdByProcess({ command: 'claude', args: '' }, candidates), 'claude')
})
check('нативный claude: команда — версия, argv — путь в claude/versions', () => {
  assertEq(resolveAgentIdByProcess({ command: '2.1.19', args: '/home/u/.local/share/claude/versions/2.1.19 --resume' }, candidates), 'claude')
})
check('нативный claude: argv0 — симлинк claude', () => {
  assertEq(resolveAgentIdByProcess({ command: '2.1.19', args: 'claude --continue' }, candidates), 'claude')
})
check('npm-установка: node + cli.js пакета', () => {
  assertEq(resolveAgentIdByProcess({ command: 'node', args: 'node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js' }, candidates), 'claude')
})
check('node + bin/claude', () => {
  assertEq(resolveAgentIdByProcess({ command: 'node', args: 'node /usr/bin/claude --resume' }, candidates), 'claude')
})
check('node с флагами перед скриптом', () => {
  assertEq(resolveAgentIdByProcess({ command: 'node', args: 'node --no-warnings /opt/bin/codex' }, candidates), 'codex')
})
check('codex по имени', () => {
  assertEq(resolveAgentIdByProcess({ command: 'codex', args: 'codex' }, candidates), 'codex')
})
check('кастомный агент по базе команды', () => {
  assertEq(resolveAgentIdByProcess({ command: 'myai', args: '/opt/myai --x' }, candidates), 'my-ai')
})
check('vim claude.md — не агент', () => {
  assertEq(resolveAgentIdByProcess({ command: 'vim', args: 'vim claude.md' }, candidates), null)
})
check('node server.js claude — не агент (claude только аргумент скрипта)', () => {
  assertEq(resolveAgentIdByProcess({ command: 'node', args: 'node server.js claude' }, candidates), null)
})
check('zsh — не агент', () => {
  assertEq(resolveAgentIdByProcess({ command: 'zsh', args: '-zsh' }, candidates), null)
})
check('версия без argv — не угадываем', () => {
  assertEq(resolveAgentIdByProcess({ command: '2.1.19', args: '' }, candidates), null)
})
check('подсказка пути игнорируется, если агента нет в candidates', () => {
  assertEq(resolveAgentIdByProcess({ command: '1.0.0', args: '/x/claude/versions/1.0.0' }, [{ id: 'codex', bases: ['codex'] }]), null)
})

process.exit(failed ? 1 : 0)
