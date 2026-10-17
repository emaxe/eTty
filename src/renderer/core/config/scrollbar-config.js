/**
 * Оверлейные скроллбары на Windows/Linux (см. core/scrollbar-activity.js).
 */

export const SCROLLBAR_CONFIG = Object.freeze({
  /** Через сколько мс после последней прокрутки ползунок снова прячется. */
  HIDE_DELAY_MS: 900,
  /** CSS-класс, который вешается на прокручиваемый элемент во время прокрутки. */
  ACTIVE_CLASS: 'is-scrolling',
})
