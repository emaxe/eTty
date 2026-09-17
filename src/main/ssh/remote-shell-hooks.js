/**
 * Строит remote-команду для SSH (позиционный аргумент после `user@host` — см. `ssh-command.js`),
 * которая на удалённой стороне воспроизводит `PtyManager._createZdotdir()`: пишет временные
 * rc-файлы с precmd/preexec-хуками, эмитящими OSC 7 (cwd) и OSC 133 (busy), и делает `exec`
 * в интерактивный login-shell пользователя.
 *
 * Три вложенных уровня, каждый со своими правилами экранирования:
 *
 *   L0 — команда целиком выполняется как `<login-shell-пользователя> -c "<L0>"`; какой именно
 *        это shell (zsh/bash/fish/csh/dash/...), мы не знаем и не контролируем. L0 обязана быть
 *        валидной для ВСЕХ них одновременно, поэтому она — это ровно одна простая команда:
 *        `exec /bin/sh -c '<L1>'`. Все версии умеют `exec CMD ARGS...` и одинарные кавычки.
 *        Инвариант: во всём L1 не должно быть ни одного символа `'` (иначе досрочно закроет
 *        одинарную кавычку L0) и ни одного `!` (history expansion в csh/tcsh — срабатывает
 *        даже внутри кавычек). Экранировать `'` через `'\''` не нужно — проще гарантировать,
 *        что L1 никогда его не содержит (весь L1 пишется через двойные кавычки).
 *
 *   L1 — исполняется гарантированным POSIX `/bin/sh -c` (уже не «неизвестный» shell): здесь
 *        обычный POSIX-синтаксис (case/if, `$()`, `||`). Собирает временный каталог и построчно
 *        записывает rc-файлы через `printf "%s\n" "line1" "line2" ... > file`. Каждая "lineN" —
 *        это ОДИН double-quoted аргумент L1 — целиком часть текста L0, поэтому тоже обязан быть
 *        без `'`/`!`. Спецсимволы (`\`, `"`, `$`, `` ` ``) внутри неё экранируются `posixDquote()`,
 *        чтобы L1 не пытался их интерпретировать (в частности — не раскрывал `$PWD`/`$ETTY_TMPDIR`
 *        РАНЬШЕ времени: они должны попасть в файл буквально и раскрыться уже при sourcing).
 *
 *   L2 — содержимое итоговых rc-файлов: обычный zsh/bash-код, читаемый и исполняемый zsh/bash
 *        уже ПОСЛЕ exec — полноценный известный интерпретатор, никаких кросс-shell ограничений.
 *        На этом уровне разрешены одинарные кавычки и `!` (см. buildTrapLine) — L1 передаёт их
 *        как обычные, ничем не примечательные для double-quote-парсинга символы данных.
 *
 * ВАЖНО: несмотря на то что L2-контент технически «инертен» для L1, ЛЮБОЙ `'`/`!`, попавший
 * в L1-текст (в том числе внутри вложенных double-quoted аргументов), всё равно виден L0 как
 * плоский поток байт и сломает его — поэтому шаблоны строк ниже сознательно не используют ни
 * `'`, ни `!` нигде, вплоть до содержимого rc-файлов.
 */

const ETTY_TMPDIR_VAR = 'ETTY_TMPDIR'

/** Экранирует произвольную строку для встраивания как один double-quoted аргумент L1. */
function posixDquote(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
}

/** L1: `printf "%s\n" "line1" "line2" ... > "$d/<fileName>"`. */
function printfToFile(lines, fileNameExpr) {
  const args = lines.map((line) => `"${posixDquote(line)}"`).join(' ')
  return `printf "%s\\n" ${args} > ${fileNameExpr}`
}

function assertL0Safe(text, label) {
  if (text.includes("'") || text.includes('!')) {
    throw new Error(`remote-shell-hooks: сгенерированный ${label} содержит ' или ! — сломает L0-обёртку`)
  }
}

// if/fi, а не `[ -f X ] && . X`: у последнего при отсутствующем файле результат всего
// startup-файла — код завершения самого теста (1), а .zlogin читается zsh последним из
// всех rc-файлов — этот «зависший» $?=1 иначе становится exit-кодом всей сессии, стоит
// PTY завершиться раньше первого реального промпта (наблюдаемо и в обычном SSH-разрыве).
const ZSH_ZSHENV = [
  'if [ -f "$HOME/.zshenv" ]; then . "$HOME/.zshenv"; fi'
]
const ZSH_ZPROFILE = [
  'if [ -f "$HOME/.zprofile" ]; then . "$HOME/.zprofile"; fi'
]
const ZSH_ZLOGIN = [
  'if [ -f "$HOME/.zlogin" ]; then . "$HOME/.zlogin"; fi'
]
// ZDOTDIR отключает чтение ~/.zprofile/~/.zlogin по умолчанию — на серверах там часто
// настраивается PATH, поэтому явно сорсим их сами (см. .zprofile/.zlogin файлы выше).
const ZSH_ZSHRC = [
  'if [ -f "$HOME/.zshrc" ]; then . "$HOME/.zshrc"; fi',
  'autoload -Uz add-zsh-hook',
  '_etty_cwd() { printf "\\033]7;file://%s\\007" "$PWD"; }',
  '_etty_pre() { printf "\\033]133;C\\007"; }',
  '_etty_post() { printf "\\033]133;A\\007"; }',
  'add-zsh-hook precmd _etty_cwd',
  'add-zsh-hook preexec _etty_pre',
  'add-zsh-hook precmd _etty_post',
  `zshexit() { rm -rf "\$${ETTY_TMPDIR_VAR}"; }`,
  '_etty_cwd'
]

// bash игнорирует --rcfile для login-shell, поэтому login-профиль сорсим вручную.
// PROMPT_COMMAND покрывает и cwd, и busy=done (обе фазы срабатывают перед показом промпта —
// тот же момент, что и zsh precmd). DEBUG-трап эмитит busy=start перед КАЖДОЙ простой командой,
// поэтому явно игнорирует собственный вызов _etty_cwd из PROMPT_COMMAND.
const BASH_RC = [
  'if [ -f "$HOME/.bash_profile" ]; then . "$HOME/.bash_profile"; elif [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc"; fi',
  '_etty_cwd() { printf "\\033]7;file://%s\\007" "$PWD"; printf "\\033]133;A\\007"; }',
  '_etty_pre() { case "$BASH_COMMAND" in _etty_cwd*) return ;; esac; printf "\\033]133;C\\007"; }',
  'PROMPT_COMMAND=_etty_cwd',
  'trap _etty_pre DEBUG',
  `trap "rm -rf \\"\$${ETTY_TMPDIR_VAR}\\"" EXIT`
]

/**
 * @returns {string} remote-команда — позиционный аргумент для `ssh` после `user@host`.
 */
export function buildRemoteInitCommand() {
  const l1Statements = [
    's=${SHELL:-/bin/sh}',
    'd=${TMPDIR:-/tmp}/etty-$$',
    'case "$s" in *zsh) m=z ;; *bash) m=b ;; *) m=n ;; esac',
    // Неизвестный login-shell — сразу выходим без хуков, ничего не создавая.
    'if [ "$m" = n ]; then exec "$s" -l; fi',
    // Нет прав на запись в TMPDIR/нет mkdir — тот же fallback. Без `!`: `||` вместо negation.
    'mkdir -m 700 "$d" 2>/dev/null || exec "$s" -l',
    `${ETTY_TMPDIR_VAR}=$d`,
    `export ${ETTY_TMPDIR_VAR}`,
    // `then`/`else` обязаны сразу сопровождаться реальной командой в ТОЙ ЖЕ строке —
    // `then; cmd` (через join) даёт пустой список команд и синтаксическую ошибку POSIX sh.
    `if [ "$m" = z ]; then ${printfToFile(ZSH_ZSHENV, '"$d/.zshenv"')}`,
    printfToFile(ZSH_ZPROFILE, '"$d/.zprofile"'),
    printfToFile(ZSH_ZLOGIN, '"$d/.zlogin"'),
    printfToFile(ZSH_ZSHRC, '"$d/.zshrc"'),
    'ZDOTDIR=$d',
    'export ZDOTDIR',
    'exec "$s" -l',
    `else ${printfToFile(BASH_RC, '"$d/rc"')}`,
    'exec "$s" --rcfile "$d/rc" -i',
    'fi'
  ]

  const inner = l1Statements.join('; ')
  assertL0Safe(inner, 'L1 (INNER)')

  // Одинарные кавычки — единственный кавычочный стиль, одинаково понятный sh/bash/zsh/fish/csh
  // как «буквальная строка без интерпретации». `inner` гарантированно не содержит ' и !
  // (см. assertL0Safe выше), поэтому оборачиваем без дополнительного экранирования.
  return `exec /bin/sh -c '${inner}'`
}
