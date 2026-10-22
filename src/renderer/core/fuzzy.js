const WORD_BOUNDARY = /[\s\-_.:/]/

/**
 * Нечёткое совпадение: символы запроса должны встретиться в тексте по порядку (регистр не важен).
 * Баллы выше за подряд идущие символы и за совпадение с началом слов; короткий текст чуть выгоднее.
 *
 * @param {string} query
 * @param {string} text
 * @returns {{ score: number, indices: number[] } | null} null — запрос не совпал;
 *   indices — позиции совпавших символов в `text` (для подсветки)
 */
export function fuzzyMatch(query, text) {
  const q = String(query).trim().toLowerCase()
  const t = String(text).toLowerCase()
  if (!q) return { score: 0, indices: [] }

  const indices = []
  let from = 0
  let previous = -2
  let score = 0

  for (const ch of q) {
    if (ch === ' ') continue
    const index = t.indexOf(ch, from)
    if (index === -1) return null
    score += 1
    if (index === previous + 1) score += 5
    if (index === 0 || WORD_BOUNDARY.test(t[index - 1])) score += 8
    score -= Math.min(index - from, 6) * 0.3
    indices.push(index)
    previous = index
    from = index + 1
  }

  return { score: score - t.length * 0.02, indices }
}
