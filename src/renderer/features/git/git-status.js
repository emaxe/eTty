/**
 * Shared status-letter → badge metadata used by the file list and diff view.
 * `status` values come straight from the porcelain status letters returned
 * by git-handlers.js (M/A/D/R/U), plus eTty's own '?' (untracked) and 'I'
 * (ignored) markers.
 */
export const STATUS_META = {
  M: { letter: 'M', label: 'Modified', cls: 'modified' },
  A: { letter: 'A', label: 'Added', cls: 'added' },
  D: { letter: 'D', label: 'Deleted', cls: 'deleted' },
  R: { letter: 'R', label: 'Renamed', cls: 'renamed' },
  U: { letter: 'U', label: 'Conflict', cls: 'conflict' },
  '?': { letter: 'U', label: 'Untracked', cls: 'untracked' },
  I: { letter: 'I', label: 'Ignored', cls: 'ignored' },
}

export function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.M
}
