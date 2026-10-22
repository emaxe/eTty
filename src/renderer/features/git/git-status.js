/**
 * Shared status-letter → badge metadata used by the file list and diff view.
 * `status` values come straight from the porcelain status letters returned
 * by git-handlers.js (M/A/D/R/U), plus eTty's own '?' (untracked) and 'I'
 * (ignored) markers.
 */
export const STATUS_META = {
  M: { letter: 'M', label: 'Изменён', cls: 'modified' },
  A: { letter: 'A', label: 'Добавлен', cls: 'added' },
  D: { letter: 'D', label: 'Удалён', cls: 'deleted' },
  R: { letter: 'R', label: 'Переименован', cls: 'renamed' },
  U: { letter: 'U', label: 'Конфликт', cls: 'conflict' },
  '?': { letter: 'U', label: 'Не отслеживается', cls: 'untracked' },
  I: { letter: 'I', label: 'Игнорируется', cls: 'ignored' },
}

export function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.M
}
