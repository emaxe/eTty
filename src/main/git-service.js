/**
 * Считает строки additions (+) и deletions (-) в unified diff, игнорируя заголовки +++ и ---.
 */
export function countDiffLines(diff) {
  let additions = 0
  let deletions = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++
  }
  return { additions, deletions }
}
