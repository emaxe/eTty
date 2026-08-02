/**
 * Static syntax highlighting for diff text — tokenizes plain strings into
 * `{ text, cls }` spans using the same Lezer grammars as the CodeMirror
 * editor (`getLanguageExtension`), but without mounting a live EditorView.
 * Classes follow @lezer/highlight's `classHighlighter` convention
 * (`tok-keyword`, `tok-string`, ...) — colors are assigned in styles.css via
 * `--dt-*` theme variables, never hardcoded here.
 */
import { highlightCode, classHighlighter } from '@lezer/highlight'
import { getLanguageExtension } from '../../editor-languages.js'
import { APP_CONFIG } from '../../core/config/app-config.js'

const plainLines = (lines) => lines.map(l => [{ text: l, cls: '' }])

/**
 * @param {string[]} lines — one hunk-side's source lines (old or new), in order
 * @param {string} filePath — used to resolve the language grammar
 * @returns {Promise<Array<Array<{text: string, cls: string}>>>} one span-array per input line
 */
export async function tokenizeLines(lines, filePath) {
  if (!lines.length) return []
  if (lines.length > APP_CONFIG.GIT_DIFF_MAX_HIGHLIGHT_LINES) return plainLines(lines)

  let exts
  try {
    exts = await getLanguageExtension(filePath)
  } catch {
    return plainLines(lines)
  }
  const langSupport = exts.find(e => e && e.language && e.language.parser)
  if (!langSupport) return plainLines(lines)

  const text = lines.join('\n')
  let tree
  try {
    tree = langSupport.language.parser.parse(text)
  } catch {
    return plainLines(lines)
  }

  const result = []
  let currentLine = []
  result.push(currentLine)

  try {
    highlightCode(
      text,
      tree,
      classHighlighter,
      (str, classes) => currentLine.push({ text: str, cls: classes || '' }),
      () => { currentLine = []; result.push(currentLine) }
    )
  } catch {
    return plainLines(lines)
  }

  // Defensive: keep result aligned 1:1 with the input lines even if the
  // parser produced a different number of breaks than expected.
  while (result.length < lines.length) result.push([{ text: lines[result.length] ?? '', cls: '' }])
  return result.slice(0, lines.length)
}
