import { RADIAL_MENU_CONFIG } from '../../core/config/radial-menu-config.js'
import { buildQuickReplyTree } from '../quick-replies/quick-replies-model.js'

/**
 * Pure model helpers for the radial quick-access menu. No DOM access.
 *
 * A level is `{ items: RadialItem[] }`; an item is
 *   { label, children?: Level }                 — переход на вложенный уровень
 *   { label, run: () => Level | void }          — действие; вернувшийся непустой уровень открывается следом
 */

/**
 * Приводит сохранённую настройку к валидному виду (неизвестный жест → дефолтный).
 * @param {unknown} raw
 * @returns {{ enabled: boolean, gesture: string }}
 */
export function normalizeRadialSettings(raw) {
  const known = new Set(RADIAL_MENU_CONFIG.GESTURE_OPTIONS.map(g => g.key))
  const enabled = typeof raw?.enabled === 'boolean' ? raw.enabled : RADIAL_MENU_CONFIG.DEFAULT_ENABLED
  const gesture = known.has(raw?.gesture) ? raw.gesture : RADIAL_MENU_CONFIG.DEFAULT_GESTURE
  return { enabled, gesture }
}

/**
 * Индекс сектора под точкой (dx, dy от центра); секторы идут по часовой стрелке с 12 часов.
 * null — мёртвая зона или за пределами `radius`.
 */
export function sectorAt(dx, dy, { count, deadZone, radius = null }) {
  if (count <= 0) return null
  const dist = Math.hypot(dx, dy)
  if (dist < deadZone) return null
  if (radius !== null && dist > radius) return null
  const step = (2 * Math.PI) / count
  let angle = Math.atan2(dx, -dy)
  if (angle < 0) angle += 2 * Math.PI
  return Math.floor((angle + step / 2) / step) % count
}

/**
 * Строит корневой уровень по снапшоту статусбара (`StatusBar.getQuickAccessSnapshot()`).
 * @param {object} snapshot
 * @param {{
 *   sendCommand: (cmd: string) => void,
 *   launchAgent: (id: string) => void,
 *   selectAgent: (id: string) => void,
 *   clearBusy: () => void,
 *   getSnapshot: () => object
 * }} h
 */
export function buildRadialLevel(snapshot, h) {
  return snapshot.mode === 'commands' ? commandsLevel(snapshot, h) : agentsLevel(snapshot, h)
}

function commandsLevel(snapshot, h) {
  const items = []
  if (snapshot.busyOptimistic) {
    items.push({ label: 'Снять busy', run: () => h.clearBusy() })
  }
  for (const node of snapshot.nodes) {
    if (node.kind === 'group') {
      items.push({
        label: node.group.label || 'Группа',
        children: { items: node.children.map(({ item }) => commandItem(item, h)) }
      })
    } else {
      items.push(commandItem(node.item, h))
    }
  }
  return { items: items.filter(i => i.children ? i.children.items.length > 0 : true) }
}

function commandItem(item, h) {
  return { label: item.label || item.command, run: () => { if (item.command) h.sendCommand(item.command) } }
}

function agentsLevel(snapshot, h) {
  // После выбора агента статусбар уже показывает его команды — сразу открываем их уровень
  const selectThenCommands = (id) => () => {
    h.selectAgent(id)
    const next = h.getSnapshot()
    return next.mode === 'commands' ? commandsLevel(next, h) : undefined
  }

  return {
    items: snapshot.agents.map((agent) => {
      if (snapshot.isBusy) return { label: agent.label, run: selectThenCommands(agent.id) }
      if (snapshot.isRemote) {
        return {
          label: agent.label,
          children: {
            items: [
              { label: 'Запустить', run: () => h.launchAgent(agent.id) },
              { label: 'Уже запущен', run: selectThenCommands(agent.id) }
            ]
          }
        }
      }
      return { label: agent.label, run: () => h.launchAgent(agent.id) }
    })
  }
}

/** Фильтр команд агента — тот же, что у панели быстрых команд статусбара. */
export function buildAgentCommandNodes(quickReplies, agentId) {
  return buildQuickReplyTree({
    items: quickReplies?.items || [],
    groups: quickReplies?.groups || [],
    filter: (i) => i.enabled && i.agents?.includes(agentId)
  })
}
