/**
 * Pure parsing helpers for unified diff text (as produced by `git diff`).
 * No DOM access — safe to unit-test / reuse from any renderer context.
 */

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

/**
 * Parses a unified diff string into hunks with per-line old/new line numbers.
 *
 * Handles three shapes:
 *  - a normal `git diff` output (headers + `@@` hunks)
 *  - a binary-file diff (`Binary files a/x and b/x differ`)
 *  - the synthetic "whole file as additions" diff eTty generates for
 *    untracked files (no `@@` header at all — every line is prefixed `+`)
 *
 * @param {string} diffStr
 * @returns {{ isBinary: boolean, isEmpty: boolean, hunks: Array<{
 *   header: string, context: string, oldStart: number, newStart: number,
 *   lines: Array<{ type: 'ctx'|'add'|'del'|'meta', text: string, oldNo: number|null, newNo: number|null }>
 * }> }}
 */
export function parseUnifiedDiff(diffStr) {
  if (!diffStr) return { isBinary: false, isEmpty: true, hunks: [] }

  const lines = diffStr.split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()

  if (lines.some(l => l.startsWith('Binary files ') || l.startsWith('GIT binary patch'))) {
    return { isBinary: true, isEmpty: false, hunks: [] }
  }

  const hunks = []
  let current = null
  let oldNo = 0
  let newNo = 0

  for (const line of lines) {
    if (
      line.startsWith('diff --git') || line.startsWith('index ') ||
      line.startsWith('similarity index') || line.startsWith('rename from') ||
      line.startsWith('rename to') || line.startsWith('new file mode') ||
      line.startsWith('deleted file mode') || line.startsWith('old mode') ||
      line.startsWith('new mode') || line.startsWith('--- ') || line.startsWith('+++ ')
    ) {
      continue
    }

    const hunkMatch = HUNK_HEADER_RE.exec(line)
    if (hunkMatch) {
      oldNo = parseInt(hunkMatch[1], 10)
      newNo = parseInt(hunkMatch[3], 10)
      current = { header: line, context: (hunkMatch[5] || '').trim(), oldStart: oldNo, newStart: newNo, lines: [] }
      hunks.push(current)
      continue
    }

    if (line.startsWith('\\ No newline at end of file')) {
      if (current) current.lines.push({ type: 'meta', text: line.slice(2), oldNo: null, newNo: null })
      continue
    }

    if (!current) {
      // No `@@` header seen — synthetic untracked-file diff. Every remaining
      // line is a `+`-prefixed addition; treat the file as one implicit hunk.
      current = { header: '', context: '', oldStart: 0, newStart: 1, lines: [] }
      hunks.push(current)
      newNo = 1
      oldNo = 0
    }

    if (line.startsWith('+')) {
      current.lines.push({ type: 'add', text: line.slice(1), oldNo: null, newNo })
      newNo++
    } else if (line.startsWith('-')) {
      current.lines.push({ type: 'del', text: line.slice(1), oldNo, newNo: null })
      oldNo++
    } else {
      const text = line.startsWith(' ') ? line.slice(1) : line
      current.lines.push({ type: 'ctx', text, oldNo, newNo })
      oldNo++
      newNo++
    }
  }

  return { isBinary: false, isEmpty: hunks.length === 0, hunks }
}

/**
 * Cheap common-prefix/common-suffix word diff for a single del/add line pair.
 * Not a full Myers diff — good enough to highlight "what changed" inside an
 * otherwise-identical line, the way GitHub/GitLab do for 1:1 replace blocks.
 *
 * @param {string} oldText
 * @param {string} newText
 * @returns {{ del: Array<{text: string, changed: boolean}>, add: Array<{text: string, changed: boolean}> }}
 */
export function computeWordDiff(oldText, newText) {
  if (oldText === newText) {
    return { del: [{ text: oldText, changed: false }], add: [{ text: newText, changed: false }] }
  }

  const maxCommon = Math.min(oldText.length, newText.length)
  let prefixLen = 0
  while (prefixLen < maxCommon && oldText[prefixLen] === newText[prefixLen]) prefixLen++

  const maxSuffix = maxCommon - prefixLen
  let suffixLen = 0
  while (
    suffixLen < maxSuffix &&
    oldText[oldText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]
  ) suffixLen++

  const prefix = oldText.slice(0, prefixLen)
  const oldMid = oldText.slice(prefixLen, oldText.length - suffixLen)
  const newMid = newText.slice(prefixLen, newText.length - suffixLen)
  const suffix = suffixLen ? oldText.slice(oldText.length - suffixLen) : ''

  const del = []
  const add = []
  if (prefix) { del.push({ text: prefix, changed: false }); add.push({ text: prefix, changed: false }) }
  if (oldMid) del.push({ text: oldMid, changed: true })
  if (newMid) add.push({ text: newMid, changed: true })
  if (suffix) { del.push({ text: suffix, changed: false }); add.push({ text: suffix, changed: false }) }

  return { del, add }
}
