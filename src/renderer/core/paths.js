import { createPathUtils } from '../../shared/path-utils.js'

/**
 * Сервис путей renderer-а: локальная ФС использует разделитель ОС, удалённая (SSH) — всегда POSIX.
 * Контекст берётся из `fs.context` (`{kind: 'local'|'ssh'}`) — так же, как у scopedApi.
 * @param {{ localSep: string, getContext: () => ({kind?: string}|null|undefined) }} deps
 */
export function createPathsService({ localSep, getContext }) {
  const local = createPathUtils(localSep)
  const remote = createPathUtils('/')
  return {
    local,
    remote,
    /** Утилиты для текущего FS-контекста (активная вкладка). */
    current: () => (getContext()?.kind === 'ssh' ? remote : local),
    /** Утилиты для вкладки: у SSH-вкладки `tab.ssh` задан. */
    forTab: (tab) => (tab?.ssh ? remote : local)
  }
}
