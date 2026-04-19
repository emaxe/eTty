import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

/**
 * Build a CodeMirror 6 Extension[] from an editor color map (from themes.js).
 * Returns [editorTheme, highlightStyle] — two extensions.
 */
export function buildEditorTheme(colors) {
  const editorTheme = EditorView.theme(
    {
      '&': {
        backgroundColor: colors.bg,
        color: colors.text,
        height: '100%'
      },
      '.cm-content': {
        caretColor: colors.cursor,
        padding: '4px 0'
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: colors.cursor,
        borderLeftWidth: '2px'
      },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
        backgroundColor: colors.selection
      },
      '.cm-activeLine': {
        backgroundColor: colors.activeLine
      },
      '.cm-gutters': {
        backgroundColor: colors.gutterBg,
        color: colors.lineNumber,
        borderRight: '1px solid ' + colors.activeLine
      },
      '.cm-activeLineGutter': {
        backgroundColor: colors.activeLine
      },
      '.cm-lineNumbers .cm-gutterElement': {
        paddingLeft: '8px',
        paddingRight: '8px',
        minWidth: '36px'
      },
      '.cm-foldGutter': {
        minWidth: '16px'
      },
      '.cm-foldPlaceholder': {
        backgroundColor: colors.activeLine,
        color: colors.lineNumber,
        border: 'none',
        borderRadius: '3px',
        padding: '0 4px'
      },
      '.cm-tooltip': {
        backgroundColor: colors.gutterBg,
        color: colors.text,
        border: '1px solid ' + colors.activeLine
      },
      '.cm-tooltip-autocomplete ul li[aria-selected]': {
        backgroundColor: colors.selection
      },
      '.cm-searchMatch': {
        backgroundColor: colors.selection,
        outline: '1px solid ' + colors.lineNumber
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: colors.cursor,
        color: colors.bg
      }
    },
    { dark: true }
  )

  const highlightStyle = syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.keyword, color: colors.keyword },
      { tag: tags.controlKeyword, color: colors.keyword },
      { tag: tags.operatorKeyword, color: colors.keyword },
      { tag: tags.definitionKeyword, color: colors.keyword },
      { tag: tags.moduleKeyword, color: colors.keyword },
      { tag: [tags.string, tags.special(tags.string)], color: colors.string },
      { tag: tags.number, color: colors.number },
      { tag: tags.integer, color: colors.number },
      { tag: tags.float, color: colors.number },
      { tag: [tags.lineComment, tags.blockComment], color: colors.comment, fontStyle: 'italic' },
      { tag: tags.function(tags.variableName), color: colors.function },
      { tag: tags.function(tags.propertyName), color: colors.function },
      { tag: [tags.className, tags.typeName], color: colors.type },
      { tag: tags.definition(tags.typeName), color: colors.type },
      { tag: tags.variableName, color: colors.variable },
      { tag: tags.definition(tags.variableName), color: colors.variable },
      { tag: tags.operator, color: colors.operator },
      { tag: tags.punctuation, color: colors.bracket },
      { tag: [tags.bracket, tags.paren, tags.brace], color: colors.bracket },
      { tag: tags.propertyName, color: colors.property },
      { tag: tags.attributeName, color: colors.attribute },
      { tag: tags.tagName, color: colors.tag },
      { tag: tags.angleBracket, color: colors.bracket },
      { tag: tags.self, color: colors.keyword },
      { tag: tags.bool, color: colors.number },
      { tag: tags.null, color: colors.number },
      { tag: tags.regexp, color: colors.string },
      { tag: tags.escape, color: colors.operator },
      { tag: tags.link, color: colors.function, textDecoration: 'underline' },
      { tag: tags.url, color: colors.string },
      { tag: tags.heading, color: colors.keyword, fontWeight: 'bold' },
      { tag: tags.strong, fontWeight: 'bold' },
      { tag: tags.emphasis, fontStyle: 'italic' },
      { tag: tags.strikethrough, textDecoration: 'line-through', color: colors.comment }
    ])
  )

  return [editorTheme, highlightStyle]
}
