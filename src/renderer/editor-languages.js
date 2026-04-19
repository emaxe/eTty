/**
 * Maps file extensions to CodeMirror 6 language extensions.
 * Uses dynamic import() for code-splitting — only used languages are loaded.
 */

const LANG_MAP = {
  js:   () => import('@codemirror/lang-javascript').then(m => [m.javascript({ jsx: true })]),
  jsx:  () => import('@codemirror/lang-javascript').then(m => [m.javascript({ jsx: true })]),
  mjs:  () => import('@codemirror/lang-javascript').then(m => [m.javascript()]),
  cjs:  () => import('@codemirror/lang-javascript').then(m => [m.javascript()]),
  ts:   () => import('@codemirror/lang-javascript').then(m => [m.javascript({ typescript: true })]),
  tsx:  () => import('@codemirror/lang-javascript').then(m => [m.javascript({ typescript: true, jsx: true })]),
  py:   () => import('@codemirror/lang-python').then(m => [m.python()]),
  go:   () => import('@codemirror/lang-go').then(m => [m.go()]),
  rs:   () => import('@codemirror/lang-rust').then(m => [m.rust()]),
  html: () => import('@codemirror/lang-html').then(m => [m.html()]),
  htm:  () => import('@codemirror/lang-html').then(m => [m.html()]),
  css:  () => import('@codemirror/lang-css').then(m => [m.css()]),
  scss: () => import('@codemirror/lang-css').then(m => [m.css()]),
  json: () => import('@codemirror/lang-json').then(m => [m.json()]),
  yaml: () => import('@codemirror/lang-yaml').then(m => [m.yaml()]),
  yml:  () => import('@codemirror/lang-yaml').then(m => [m.yaml()]),
  md:   () => import('@codemirror/lang-markdown').then(m => [m.markdown()]),
  markdown: () => import('@codemirror/lang-markdown').then(m => [m.markdown()])
}

/**
 * Returns an array of CodeMirror Extension for the given file path.
 * Returns [] for unknown extensions (plain text mode).
 */
export async function getLanguageExtension(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase()
  const loader = LANG_MAP[ext]
  if (!loader) return []
  try {
    return await loader()
  } catch {
    return []
  }
}
