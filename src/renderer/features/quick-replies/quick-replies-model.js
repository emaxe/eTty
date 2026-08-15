/**
 * Pure model helpers for grouped quick replies. No DOM access — shared
 * between status-bar.js (render) and settings-page.js (edit).
 *
 * Groups are not a nested data structure: an item optionally points at a
 * group via `item.groupId`, and a group's position/visibility is entirely
 * derived from its items (never stored separately). This keeps `items`
 * order as the single source of truth for both settings-page drag-and-drop
 * and status-bar button order.
 */

/**
 * Builds an ordered node list from the flat `items` array: a group node sits
 * at the position of its first matching item, and each group is emitted at
 * most once. An item whose `groupId` doesn't resolve to a known group is
 * treated as top-level (orphan-safe — never dropped or thrown on).
 *
 * @param {Object} opts
 * @param {Array<{id: string, groupId?: string}>} opts.items
 * @param {Array<{id: string, label: string}>} opts.groups
 * @param {(item: object) => boolean} [opts.filter] - applied per item before it's placed in the tree
 * @param {boolean} [opts.includeEmptyGroups] - append groups with zero matching items at the end, in `groups` order
 * @returns {Array<
 *   { kind: 'item', item: object, index: number } |
 *   { kind: 'group', group: object, children: Array<{ kind: 'item', item: object, index: number }> }
 * >}
 */
export function buildQuickReplyTree({ items, groups, filter = null, includeEmptyGroups = false }) {
  const list = Array.isArray(items) ? items : []
  const groupList = Array.isArray(groups) ? groups : []
  const groupById = new Map(groupList.map(g => [g.id, g]))

  const nodes = []
  const nodeByGroupId = new Map()

  list.forEach((item, index) => {
    if (filter && !filter(item)) return
    const groupId = item.groupId && groupById.has(item.groupId) ? item.groupId : null
    if (!groupId) {
      nodes.push({ kind: 'item', item, index })
      return
    }
    let node = nodeByGroupId.get(groupId)
    if (!node) {
      node = { kind: 'group', group: groupById.get(groupId), children: [] }
      nodeByGroupId.set(groupId, node)
      nodes.push(node)
    }
    node.children.push({ kind: 'item', item, index })
  })

  if (includeEmptyGroups) {
    for (const group of groupList) {
      if (!nodeByGroupId.has(group.id)) nodes.push({ kind: 'group', group, children: [] })
    }
  }

  return nodes
}

/**
 * Sanitizes a saved `{ items, groups }` pair so a manually-edited or
 * drag-mangled config renders as a coherent tree again:
 *  - dedupes `groups` by `id` (first occurrence wins)
 *  - drops `groupId` on items that point at a non-existent group
 *  - re-collapses each group's items into one contiguous run in `items`,
 *    anchored at the position of the group's first item
 *
 * @param {{ items: Array, groups: Array }} data
 * @returns {{ items: Array, groups: Array, changed: boolean }}
 */
export function normalizeQuickReplies({ items, groups }) {
  const originalItems = Array.isArray(items) ? items : []
  const originalGroups = Array.isArray(groups) ? groups : []

  const dedupedGroups = []
  const seenGroupIds = new Set()
  for (const group of originalGroups) {
    if (!group || seenGroupIds.has(group.id)) continue
    seenGroupIds.add(group.id)
    dedupedGroups.push(group)
  }
  const groupById = new Map(dedupedGroups.map(g => [g.id, g]))

  const nodes = buildQuickReplyTree({ items: originalItems, groups: dedupedGroups, includeEmptyGroups: true })
  const normalizedItems = []
  for (const node of nodes) {
    if (node.kind === 'item') {
      normalizedItems.push(dropOrphanGroupId(node.item, groupById))
      continue
    }
    for (const child of node.children) normalizedItems.push(child.item)
  }

  const changed =
    dedupedGroups.length !== originalGroups.length ||
    normalizedItems.length !== originalItems.length ||
    normalizedItems.some((item, i) => item !== originalItems[i])

  return { items: normalizedItems, groups: dedupedGroups, changed }
}

function dropOrphanGroupId(item, groupById) {
  if (!item.groupId || groupById.has(item.groupId)) return item
  const { groupId, ...rest } = item
  return rest
}
