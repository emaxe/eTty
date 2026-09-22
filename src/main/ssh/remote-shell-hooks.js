import { SSH_SESSION_CONFIG } from '../../shared/ssh-session-config.js'

/**
 * Строит remote-команду для SSH (позиционный аргумент после `user@host` — см. `ssh-command.js`),
 * которая на удалённой стороне воспроизводит `PtyManager._createZdotdir()`: пишет временные
 * rc-файлы с precmd/preexec-хуками, эмитящими OSC 7 (cwd) и OSC 133 (busy), и делает `exec`
 * в интерактивный login-shell пользователя. При `persistence: 'tmux'` тот же shell поднимается
 * не напрямую, а внутри именованной tmux-сессии (см. «персистентная ветка» ниже) — сессия
 * переживает разрыв соединения, вкладку eTty и перезапуск приложения (план:
 * docs — .agents/rules/project-rules.md, раздел SSH; сам план — Персистентные удалённые сессии).
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
 *        Единственное исключение — путь `$c` (стабильный каталог хуков персистентной ветки):
 *        он должен раскрыться ИМЕННО на L1 (tmux.conf не делает shell-подстановку значений), и
 *        поэтому строка `default-command` не идёт через `printfToFile`/`posixDquote`, а пишется
 *        отдельным `printf ... "$c"` с позиционным аргументом — тот же приём, что и в
 *        remote-scripts.js/ssh-control-channel.js для избежания текстовой интерполяции данных.
 *
 *   L2 — содержимое итоговых rc-файлов (и tmux.conf/init): обычный zsh/bash-код или синтаксис
 *        tmux.conf, читаемый уже ПОСЛЕ exec — полноценный известный интерпретатор, никаких
 *        кросс-shell ограничений. На этом уровне разрешены одинарные кавычки и `!` (см.
 *        buildTrapLine) — L1 передаёт их как обычные, ничем не примечательные для
 *        double-quote-парсинга символы данных.
 *
 * ВАЖНО: несмотря на то что L2-контент технически «инертен» для L1, ЛЮБОЙ `'`/`!`, попавший
 * в L1-текст (в том числе внутри вложенных double-quoted аргументов), всё равно виден L0 как
 * плоский поток байт и сломает его — поэтому шаблоны строк ниже сознательно не используют ни
 * `'`, ни `!` нигде, вплоть до содержимого rc-файлов/tmux.conf/init.
 *
 * Известное ограничение: если `$HOME` на сервере содержит пробел, персистентная (tmux) ветка
 * может сломаться — `"/bin/sh $c/init"` как shell-command для tmux передаётся ОДНОЙ строкой,
 * которую tmux исполняет через собственный `<shell> -c`, и незаэкранированный пробел внутри
 * неё будет воспринят как разделитель аргументов. Редкий edge case, сознательно не решается.
 */

const ETTY_TMPDIR_VAR = 'ETTY_TMPDIR'
// Стабильный каталог хуков персистентной (tmux) ветки — НЕ $TMPDIR (на systemd-серверах бывает
// per-login, PrivateTmp, не переживает логин) и НЕ $XDG_CACHE_HOME (чтобы путь оставался
// константным текстом — см. L1 выше про default-command).
const HOOK_DIR_EXPR = `$HOME/${SSH_SESSION_CONFIG.HOOK_DIR}`

/** Экранирует произвольную строку для встраивания как один double-quoted аргумент L1. */
function posixDquote(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
}

/**
 * L1: `printf "%s\n" "line1" "line2" ... > "$X/<fileName>.$$" && mv -f "$X/<fileName>.$$" "$X/<fileName>"`.
 * Пишет во временный файл и атомарно (`rename()`, один syscall) переименовывает — НЕ прямой `>`.
 * Критично для персистентной ветки: `$c` ($HOME/.cache/etty) — каталог, ОБЩИЙ для ВСЕХ
 * одновременных подключений к этому хосту (см. модуль-докстринг), и каждое из них перезаписывает
 * .zshrc/.zprofile/tmux.conf/init заново при (пере)коннекте. Без атомарности второе параллельное
 * подключение (вторая вкладка к другой tmux-сессии того же хоста) могло бы застать файл частично
 * перезаписанным первым (`printf` не гарантирует один write() на несколько строк) — портит
 * содержимое rc-файлов/tmux.conf для обеих сторон. Непersistent-ветка использует приватный `$d`
 * (уникален на PID) — гонки там нет, но атомарность здесь безвредна и для неё.
 * `$$` — PID ТЕКУЩЕГО L1-процесса, гарантированно различен у конкурентных подключений.
 */
function printfToFile(lines, fileNameExpr) {
  const args = lines.map((line) => `"${posixDquote(line)}"`).join(' ')
  // '$$$$' в replacement-строке — НЕ опечатка: String.replace() трактует '$$' как экранирование
  // одного '$', поэтому для ДВУХ буквальных '$' (shell-переменная PID) нужны четыре символа подряд.
  const tmpExpr = fileNameExpr.replace(/"$/, '.$$$$"')
  return `printf "%s\\n" ${args} > ${tmpExpr} && mv -f ${tmpExpr} ${fileNameExpr}`
}

function assertL0Safe(text, label) {
  if (text.includes("'") || text.includes('!')) {
    throw new Error(`remote-shell-hooks: сгенерированный ${label} содержит ' или ! — сломает L0-обёртку`)
  }
}

/**
 * Эмиттер OSC-последовательностей с поддержкой DCS-passthrough tmux (`allow-passthrough on`,
 * см. rc ниже): tmux пропускает наружу только специально обёрнутый payload — `ESC P tmux ;
 * <payload с удвоенным ESC> ESC \`. `$1` — payload БЕЗ ведущего ESC (сам эмиттер его подставляет,
 * один раз для прямого пути и дважды — для tmux-обёртки, как того требует протокол); внутри
 * payload других ESC-байт быть не должно (для OSC 7/133 это так) — они не удваиваются.
 * Вне tmux (`$TMUX` пуст) поведение не отличается от версии без persistence.
 */
const EMIT_FN =
  '_etty_emit() { if [ -n "$TMUX" ]; then printf "\\033Ptmux;\\033\\033%s\\033\\\\" "$1"; else printf "\\033%s" "$1"; fi; }'

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

/**
 * .zshrc — sourcing пользовательского ~/.zshrc + zsh-хуки для OSC 7/133 через `_etty_emit`
 * (см. выше). `withCleanup` — только для НЕ-персистентной ветки: временный каталог обязан
 * самоуничтожиться при выходе shell; персистентный `$HOME/.cache/etty` общий для всех сессий
 * пользователя на хосте — первый же выходящий shell не должен стирать его для остальных.
 */
function zshRcLines({ withCleanup }) {
  const lines = [
    'if [ -f "$HOME/.zshrc" ]; then . "$HOME/.zshrc"; fi',
    'autoload -Uz add-zsh-hook',
    EMIT_FN,
    '_etty_cwd() { _etty_emit "$(printf "]7;file://%s\\007" "$PWD")"; }',
    '_etty_pre() { _etty_emit "$(printf "]133;C\\007")"; }',
    '_etty_post() { _etty_emit "$(printf "]133;A\\007")"; }',
    'add-zsh-hook precmd _etty_cwd',
    'add-zsh-hook preexec _etty_pre',
    'add-zsh-hook precmd _etty_post'
  ]
  if (withCleanup) {
    lines.push(`zshexit() { rm -rf "\$${ETTY_TMPDIR_VAR}"; }`)
  }
  lines.push('_etty_cwd')
  return lines
}

/**
 * bash игнорирует --rcfile для login-shell, поэтому login-профиль сорсим вручную.
 * PROMPT_COMMAND покрывает и cwd, и busy=done (обе фазы срабатывают перед показом промпта —
 * тот же момент, что и zsh precmd). DEBUG-трап эмитит busy=start перед КАЖДОЙ простой командой,
 * поэтому явно игнорирует собственный вызов _etty_cwd из PROMPT_COMMAND. `withCleanup` — см. zshRcLines.
 */
function bashRcLines({ withCleanup }) {
  const lines = [
    'if [ -f "$HOME/.bash_profile" ]; then . "$HOME/.bash_profile"; elif [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc"; fi',
    EMIT_FN,
    '_etty_cwd() { _etty_emit "$(printf "]7;file://%s\\007" "$PWD")"; _etty_emit "$(printf "]133;A\\007")"; }',
    '_etty_pre() { case "$BASH_COMMAND" in _etty_cwd*) return ;; esac; _etty_emit "$(printf "]133;C\\007")"; }',
    'PROMPT_COMMAND=_etty_cwd',
    'trap _etty_pre DEBUG'
  ]
  if (withCleanup) {
    lines.push(`trap "rm -rf \\"\$${ETTY_TMPDIR_VAR}\\"" EXIT`)
  }
  return lines
}

/**
 * @param {object} [params]
 * @param {'off'|'tmux'} [params.persistence] — 'tmux': запускает login-shell внутри именованной
 *   tmux-сессии на собственном сокете вместо голого shell (см. модуль-докстринг).
 * @param {string|null} [params.sessionName] — обязателен при `persistence:'tmux'`; проверяется
 *   `SSH_SESSION_CONFIG.SESSION_NAME_RE` (единственная интерполяция данных в текст скрипта —
 *   поэтому валидация здесь, а не только на вызывающей стороне, часть инварианта L0).
 * @param {boolean} [params.hooks] — инжектить ли OSC 7/133 хуки (соответствует настройке
 *   подключения `injectShellIntegration`, с учётом одноразового `skipShellIntegration`).
 * @param {string} [params.socketName] — сокет tmux-сервера (`-L`); `''` — использовать сокет
 *   по умолчанию (сессии совместимы с обычным `tmux ls` пользователя, но наш `tmux.conf`
 *   применится, только если этот вызов сам стартует сервер — см. фолбэк-строку ниже).
 * @returns {string} remote-команда — позиционный аргумент для `ssh` после `user@host`.
 */
export function buildRemoteInitCommand({
  persistence = 'off',
  sessionName = null,
  hooks = true,
  socketName = SSH_SESSION_CONFIG.DEFAULT_SOCKET
} = {}) {
  const useTmux = persistence === 'tmux'

  if (useTmux && !SSH_SESSION_CONFIG.SESSION_NAME_RE.test(sessionName || '')) {
    throw new Error('remote-shell-hooks: некорректное имя tmux-сессии')
  }
  if (useTmux && socketName && !SSH_SESSION_CONFIG.SESSION_NAME_RE.test(socketName)) {
    throw new Error('remote-shell-hooks: некорректное имя tmux-сокета')
  }

  const l1Statements = [
    's=${SHELL:-/bin/sh}',
    // Неизвестный login-shell — сразу выходим без хуков, ничего не создавая.
    'case "$s" in *zsh) m=z ;; *bash) m=b ;; *) m=n ;; esac'
  ]

  if (!useTmux) {
    l1Statements.push(
      'd=${TMPDIR:-/tmp}/etty-$$',
      'if [ "$m" = n ]; then exec "$s" -l; fi',
      // Нет прав на запись в TMPDIR/нет mkdir — тот же fallback. Без `!`: `||` вместо negation.
      'mkdir -m 700 "$d" 2>/dev/null || exec "$s" -l',
      `${ETTY_TMPDIR_VAR}=$d`,
      `export ${ETTY_TMPDIR_VAR}`
    )
    if (!hooks) {
      l1Statements.push('exec "$s" -l')
    } else {
      l1Statements.push(
        // `then`/`else` обязаны сразу сопровождаться реальной командой в ТОЙ ЖЕ строке —
        // `then; cmd` (через join) даёт пустой список команд и синтаксическую ошибку POSIX sh.
        `if [ "$m" = z ]; then ${printfToFile(ZSH_ZSHENV, '"$d/.zshenv"')}`,
        printfToFile(ZSH_ZPROFILE, '"$d/.zprofile"'),
        printfToFile(ZSH_ZLOGIN, '"$d/.zlogin"'),
        printfToFile(zshRcLines({ withCleanup: true }), '"$d/.zshrc"'),
        'ZDOTDIR=$d',
        'export ZDOTDIR',
        'exec "$s" -l',
        `else ${printfToFile(bashRcLines({ withCleanup: true }), '"$d/rc"')}`,
        'exec "$s" --rcfile "$d/rc" -i',
        'fi'
      )
    }
  } else {
    // Персистентная ветка: стабильный каталог, БЕЗ zshexit/trap-очистки (общий для всех
    // сессий пользователя на хосте — см. модуль-докстринг и план, Этап 1).
    l1Statements.push(
      `n=${sessionName}`,
      `c=${HOOK_DIR_EXPR}`,
      't=$(command -v tmux 2>/dev/null)',
      'mkdir -p "$c" 2>/dev/null || exec "$s" -l',
      'chmod 700 "$c" 2>/dev/null'
    )

    if (!hooks) {
      l1Statements.push(printfToFile(['exec "${SHELL:-/bin/sh}" -l'], '"$c/init"'))
    } else {
      l1Statements.push(
        `if [ "$m" = z ]; then ${printfToFile(ZSH_ZSHENV, '"$c/.zshenv"')}`,
        printfToFile(ZSH_ZPROFILE, '"$c/.zprofile"'),
        printfToFile(ZSH_ZLOGIN, '"$c/.zlogin"'),
        printfToFile(zshRcLines({ withCleanup: false }), '"$c/.zshrc"'),
        // init выводит ZDOTDIR из СОБСТВЕННОГО расположения, а не из унаследованного окружения —
        // при повторном attach к уже существующей сессии окружение НЕ переустанавливается
        // (см. модуль-докстринг), поэтому полагаться на наследование env нельзя.
        printfToFile(
          ['d=$(cd -- "$(dirname -- "$0")" && pwd)', 'ZDOTDIR=$d', 'export ZDOTDIR', 'exec "${SHELL:-/bin/sh}" -l'],
          '"$c/init"'
        ),
        `elif [ "$m" = b ]; then ${printfToFile(bashRcLines({ withCleanup: false }), '"$c/rc"')}`,
        printfToFile(
          ['d=$(cd -- "$(dirname -- "$0")" && pwd)', 'exec "${SHELL:-/bin/sh}" --rcfile "$d/rc" -i'],
          '"$c/init"'
        ),
        `else ${printfToFile(['exec "${SHELL:-/bin/sh}" -l'], '"$c/init"')}`,
        'fi'
      )
    }

    l1Statements.push('chmod 700 "$c/init" 2>/dev/null')

    const tmuxConfLines = [
      // on, не all: пропускать OSC только из ВИДИМОЙ панели — фоновое окно сессии не должно
      // перехватывать cwd/busy активной вкладки (см. план, Этап 2).
      'set -g allow-passthrough on',
      // Реattach другого размера иначе ещё и сдвигает содержимое на строку.
      'set -g status off',
      // mouse off: выделение мышью отдаётся нативному xterm.js (как в локальной вкладке) —
      // при mouse on tmux перехватывает ЛЮБОЙ drag под свой copy-mode (индикатор [0/0] в углу,
      // выделение пропадает по MouseDragEnd1Pane, копия уходит в буфер tmux, а не системы).
      // Приложениям внутри панели (vim/htop/агенты), которые сами запрашивают mouse-tracking,
      // это не мешает: tmux с mouse off не трогает их DECSET-запросы, события идут напрямую —
      // так же, как в локальной вкладке без tmux вовсе.
      'set -g mouse off',
      // Трансляция выделения и копирования в системный буфер обмена через OSC 52 — путь для
      // приложений внутри панели (vim/агенты), которые сами копируют через clipboard-протокол.
      'set -s set-clipboard on',
      'set -as terminal-features ",*:clipboard"',
      'bind-key -T copy-mode Enter send-keys -X copy-pipe-and-cancel',
      'bind-key -T copy-mode-vi Enter send-keys -X copy-pipe-and-cancel',
      'bind-key -T copy-mode-vi y send-keys -X copy-pipe-and-cancel',
      // Поддержка расширенных клавиш (Kitty keyboard protocol / csi-u):
      // пересылка Shift+Enter (\x1b[13;2u) приложениям и агентам внутри tmux
      'set -s extended-keys on',
      'set -as terminal-features ",*:extkeys"',
      'bind-key -n S-Enter send-keys Escape "[13;2u"',
      // Колесо мыши больше не ловится tmux (mouse off) — TerminalWheelHandler на стороне eTty
      // транслирует прокрутку в эти два синтетических биндинга (CSI-u, не пересекаются с
      // реальными хоткеями): войти в copy-mode и прокрутить историю вверх/вниз. `-e` у
      // scroll-up — автовыход из copy-mode, когда докрутили обратно до низа. alternate_on —
      // не мешать полноэкранным приложениям (они сами решают, что делать с этим сочетанием).
      'bind-key -n C-M-S-Up if -F "#{alternate_on}" "" "copy-mode -e ; send-keys -X -N 3 scroll-up"',
      'bind-key -n C-M-S-Down if -F "#{alternate_on}" "" "send-keys -X -N 3 scroll-down"',
      'set -g history-limit 10000',
      'set -g escape-time 10',
      'set -g focus-events on',
      'set -g window-size latest',
      // TERM внутри панели иначе определяется этой опцией — без нижеследующей RGB-фичи
      // WebGL-путь eTty (truecolor) внутри tmux квантуется до 256 цветов.
      'set -g default-terminal screen-256color',
      'set -as terminal-features ",*:RGB"',
      // Невидимый слой персистентности, не UI мультиплексора — C-b не должен отбираться
      // у readline/vim/TUI-агентов. Detach/rename/kill/new — действия eTty через служебный
      // канал, не хоткеи tmux. На версиях, не понимающих `None`, tmux просто игнорирует
      // строку (безопасный отказ — остаётся C-b).
      'set -g prefix None'
    ]
    // tmux.conf публикуется ОДНИМ атомарным mv (обе части — статичные строки printfToFile-стиля
    // И default-command с позиционным `$c` — в ОДИН temp-файл, потом один rename), а не
    // printfToFile()+отдельный append: иначе конкурентное подключение к другой сессии того же
    // хоста могло бы своим mv «выиграть» ровно между этими двумя шагами и стереть уже дописанную
    // default-command-строку (см. докстринг printfToFile про общий $c). default-command получает
    // РАЗВЁРНУТЫЙ на L1 путь `$c` — tmux.conf не делает shell-подстановку своих значений, поэтому
    // эта строка пишется позиционным аргументом printf, а не через posixDquote (тот заэкранировал
    // бы `$c` до буквального текста) — см. докстринг файла про L1-исключение.
    l1Statements.push(
      `printf "%s\\n" ${tmuxConfLines.map((line) => `"${posixDquote(line)}"`).join(' ')} > "$c/tmux.conf.$$"`,
      'printf "set -g default-command \\"/bin/sh %s/init\\"\\n" "$c" >> "$c/tmux.conf.$$"',
      'mv -f "$c/tmux.conf.$$" "$c/tmux.conf"'
    )

    // `-f` учитывается tmux только при СТАРТЕ сервера — уже поднятая (часами/днями раньше)
    // сессия обновлённый tmux.conf сама не подхватит. Догоняем её явным source-file, ДО
    // new-session ниже: list-sessions — гард «сервер уже есть» (голый source-file поднял бы
    // сервер БЕЗ нашего -f, с чужими дефолтами). Неудача любого из шагов (сервера ещё нет) —
    // не ошибка, следующий new-session всё равно поднимет его правильно, уже со свежим -f.
    l1Statements.push(
      socketName
        ? `[ -n "$t" ] && "$t" -u -L ${socketName} list-sessions >/dev/null 2>&1 && "$t" -u -L ${socketName} source-file "$c/tmux.conf" >/dev/null 2>&1`
        : `[ -n "$t" ] && "$t" -u list-sessions >/dev/null 2>&1 && "$t" -u source-file "$c/tmux.conf" >/dev/null 2>&1`
    )

    if (!socketName) {
      // Режим совместимости (сокет пользователя): -f учитывается только при СТАРТЕ сервера —
      // если он уже поднят кем-то другим, наш конфиг молча игнорируется. Подстраховка —
      // самоограниченная панельная опция прямо из rc, ничего глобального не трогает,
      // на tmux < 3.3 молча падает.
      l1Statements.push('[ -n "$TMUX" ] && tmux set -p allow-passthrough on 2>/dev/null')
    }

    l1Statements.push(
      // tmux на сервере нет — сегодняшнее поведение (обычный login-shell с хуками), без
      // жёсткой ошибки.
      'if [ -z "$t" ]; then exec /bin/sh "$c/init"; fi',
      // -u: локаль на сервер не уезжает (SendEnv/AcceptEnv по умолчанию выключены) — без неё
      // tmux ломает псевдографику. -A -D: attach, если сессия есть, с отцепкой прочих клиентов
      // (см. план, Этап 3 — «последний attach выигрывает»).
      socketName
        ? `exec "$t" -u -L ${socketName} -f "$c/tmux.conf" new-session -A -D -s "$n" "/bin/sh $c/init"`
        : `exec "$t" -u -f "$c/tmux.conf" new-session -A -D -s "$n" "/bin/sh $c/init"`
    )
  }

  const inner = l1Statements.join('; ')
  assertL0Safe(inner, 'L1 (INNER)')

  // Одинарные кавычки — единственный кавычочный стиль, одинаково понятный sh/bash/zsh/fish/csh
  // как «буквальная строка без интерпретации». `inner` гарантированно не содержит ' и !
  // (см. assertL0Safe выше), поэтому оборачиваем без дополнительного экранирования.
  return `exec /bin/sh -c '${inner}'`
}
