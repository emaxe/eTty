import fs from 'fs'
import os from 'os'
import path from 'path'

const PROMPT_STYLES = {
  short: '\\W \\$ ',
  minimal: '> ',
  arrow: '\\W ❯ '
}

/** `C:\a\b` → `C:/a/b` (Git Bash принимает такие пути в --rcfile/HISTFILE). */
const toForward = (p) => String(p).replace(/\\/g, '/')

/** Строка в одинарных кавычках для bash. */
const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`

/**
 * Содержимое --rcfile для Git Bash. Git Bash запускается как login-shell ярлыком (`--login -i`),
 * а --rcfile для login-shell игнорируется, поэтому /etc/profile и пользовательские профили
 * подключаются здесь вручную. PWD в MSYS — `/c/Users/x`, в OSC 7 уходит `cygpath -m` (`C:/Users/x`).
 * @param {{ historyFile?: string|null, promptStyle?: string }} [params]
 */
export function buildGitBashRc({ historyFile = null, promptStyle = 'default' } = {}) {
  const lines = [
    '[ -f /etc/profile ] && . /etc/profile',
    'if [ -f "$HOME/.bash_profile" ]; then . "$HOME/.bash_profile"; elif [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc"; fi',
    ...(historyFile ? [`HISTFILE=${shQuote(toForward(historyFile))}`, 'HISTSIZE=5000', 'HISTFILESIZE=5000', 'HISTCONTROL=ignoredups:ignorespace'] : []),
    '_etty_precmd() {',
    '  printf "\\033]7;file:///%s\\007" "$(cygpath -m "$PWD" 2>/dev/null || echo "$PWD")"',
    '  printf "\\033]6973;node=%s\\007" "$(type -P node 2>/dev/null)"',
    '  printf "\\033]133;A\\007"',
    ...(historyFile ? ['  history -a'] : []),
    '}',
    // DEBUG-трап срабатывает перед каждой простой командой, включая сам PROMPT_COMMAND
    '_etty_preexec() { case "$BASH_COMMAND" in _etty_precmd*|history*) return ;; esac; printf "\\033]133;C\\007"; }',
    'PROMPT_COMMAND=_etty_precmd',
    'trap _etty_preexec DEBUG',
    ...(PROMPT_STYLES[promptStyle] ? [`PS1=${shQuote(PROMPT_STYLES[promptStyle])}`] : [])
  ]
  return lines.join('\n') + '\n'
}

/**
 * Пишет rc во временный каталог.
 * @returns {{ tmpDir: string, args: string[] }}
 */
export function createGitBashLaunch(opts) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etty-'))
  const rcFile = path.join(tmpDir, 'bashrc')
  fs.writeFileSync(rcFile, buildGitBashRc(opts))
  return { tmpDir, args: ['--rcfile', toForward(rcFile), '-i'] }
}
