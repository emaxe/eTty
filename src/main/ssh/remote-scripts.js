/**
 * POSIX sh-скрипты для операций удалённой ФС (Этап 4+), исполняемые через
 * `SshControlChannel.exec(script, args)` как `ssh <svcOpts> target /bin/sh -c <script> etty <args...>`.
 *
 * Схема безопасности (совпадает с remote-shell-hooks.js): скрипты — КОНСТАНТНЫЕ строки,
 * все переменные данные передаются ПОЗИЦИОННЫМИ ПАРАМЕТРАМИ (`"$1"`, `"$2"`, `"$@"`). `spawn`
 * с `shell:false` передаёт argv как есть execve — локальной инъекции нет; на удалённой стороне
 * `/bin/sh -c script etty arg1 arg2...` тоже не подставляет данные В ТЕКСТ скрипта, они видны
 * только как параметры. Все пути внутри скриптов используются как `"$1"`/`"$2"`/`"$@"` с `--`
 * перед ними (защита от имён, начинающихся с `-`), что делает их безопасными для имён с
 * пробелами, кавычками, `$`, обратными кавычками — вплоть до переводов строк (см. NUL-разделённый
 * вывод readDir/move/copy — единственный устойчивый к `\n` в именах способ парсинга).
 */

/**
 * Одноразовый probe при подключении — снимает всё, от чего зависят остальные команды:
 * ОС (gnu/bsd — выбор флавора `stat`), $HOME, текущий пользователь, login-shell, поддержку
 * `find -print0` (иначе readDir использует построчный fallback), наличие `inotifywait`/`rg`
 * (Этап 7, опционально). Один RTT вместо `||`-цепочек в каждой отдельной команде.
 */
export const PROBE_SCRIPT = [
  'uname -s',
  'printf "%s\\n" "$HOME"',
  'id -un',
  'printf "%s\\n" "${SHELL:-}"',
  // GNU stat понимает `-c`, BSD/macOS — нет (и наоборот `-f`)
  'if stat -c %Y . >/dev/null 2>&1; then echo gnu; else echo bsd; fi',
  'if find . -maxdepth 0 -print0 >/dev/null 2>&1; then echo find0; else echo nofind0; fi',
  'if command -v inotifywait >/dev/null 2>&1; then echo inotify; else echo -; fi',
  'if command -v rg >/dev/null 2>&1; then echo rg; else echo -; fi'
].join('; ')

/**
 * Читает список файлов/папок каталога `$1`. Дереву нужны только name/isDirectory — раздельные
 * find-проходы (папки, затем файлы) с NUL-терминатором и ОДНИМ дополнительным `\0` между
 * секциями как разделителем (см. `parseReadDir` в remote-parse.js). `-mindepth 1 -maxdepth 1`
 * без `-L` — символьная ссылка на директорию классифицируется как файл, как и у локального
 * `fs.readdir({withFileTypes:true})`.
 */
export const READ_DIR_SCRIPT = [
  'cd -- "$1" || exit 3',
  'find . -mindepth 1 -maxdepth 1 -type d -print0',
  'printf \'\\0\'',
  'find . -mindepth 1 -maxdepth 1 ! -type d -print0'
].join('; ')

/**
 * Fallback readDir для серверов без `find -print0`. Отдельные glob-паттерны для обычных и
 * скрытых (`.` в имени) записей — POSIX-glob без `dotglob`/`nullglob` не раскрывает `.*` в `*`,
 * а `.*` сам по себе матчит и `.`/`..` (текущий/родительский каталог), которые нужно явно
 * исключить. `[ -e ] || [ -L ] || continue` — стандартный приём против нераскрывшегося glob'а
 * (если совпадений нет, `for` получает буквальный текст паттерна, которого не существует на ФС).
 */
export const READ_DIR_FALLBACK_SCRIPT = [
  'cd -- "$1" || exit 3',
  'for e in */ .*/; do [ -e "$e" ] || [ -L "$e" ] || continue',
  '  case "$e" in ./|../) continue ;; esac',
  '  printf "%s\\0" "${e%/}"',
  'done',
  'printf \'\\0\'',
  'for e in * .*; do [ -d "$e" ] && continue',
  '  case "$e" in .|..) continue ;; esac',
  '  { [ -e "$e" ] || [ -L "$e" ]; } || continue',
  '  printf "%s\\0" "$e"',
  'done'
].join('; ')

/** `$1` — уже разрешённый (`realpath`) корень сессии; `$2` — целевой путь мутации. */
const VALIDATE_PREFIX =
  'r=$(cd -- "$(dirname -- "$2")" 2>/dev/null && pwd -P) || exit 13; ' +
  'case "$r/" in "$1"/*|"$1"/) ;; *) exit 13 ;; esac'

/** `getCwd`-совместимый realpath — используется при probe/подключении для стартового корня. */
export const REALPATH_SCRIPT = 'cd -- "$1" 2>/dev/null && pwd -P || exit 3'

export const CREATE_FILE_SCRIPT = [VALIDATE_PREFIX, 'set -C', ': > "$2" 2>/dev/null || exit 1'].join('; ')

export const CREATE_DIR_SCRIPT = [VALIDATE_PREFIX, 'mkdir -p -- "$2"'].join('; ')

/** `$1` root, `$2` oldPath, `$3` newPath. */
export const RENAME_SCRIPT = [
  'r=$(cd -- "$(dirname -- "$2")" 2>/dev/null && pwd -P) || exit 13',
  'case "$r/" in "$1"/*|"$1"/) ;; *) exit 13 ;; esac',
  'if [ -e "$3" ] || [ -L "$3" ]; then exit 17; fi',
  'mv -- "$2" "$3"'
].join('; ')

/** `$1` root, остальные — пути к удалению (могут быть много, чанкуется на стороне вызова). */
// `do`/`then`/`else` обязаны сопровождаться реальной командой в ТОЙ ЖЕ строке — join('; ')
// вставляет `; ` перед следующим элементом массива, а `do; cmd` (или `then; cmd`) — пустой
// список команд и синтаксическая ошибка POSIX sh (см. remote-shell-hooks.js, тот же паттерн).
export const DELETE_MANY_SCRIPT = [
  'root=$1',
  'shift',
  'for p in "$@"; do r=$(cd -- "$(dirname -- "$p")" 2>/dev/null && pwd -P) || continue',
  '  case "$r/" in "$root"/*|"$root"/) rm -rf -- "$p" ;; esac',
  'done'
].join('; ')

/** `$1` root, `$2` src, `$3` destDir — печатает `"%s\0"` с итоговым путём (после разрешения коллизий). */
export const COPY_SCRIPT = [
  's=$2', 'd=$3',
  'r=$(cd -- "$(dirname -- "$s")" 2>/dev/null && pwd -P) || exit 13',
  'case "$r/" in "$1"/*|"$1"/) ;; *) exit 13 ;; esac',
  'b=$(basename -- "$s")',
  't=$d/$b',
  'if [ -e "$t" ] || [ -L "$t" ]; then n=$b; e=',
  '  case $b in .*) ;; *.*) n=${b%.*}; e=.${b##*.} ;; esac',
  '  t="$d/$n (copy)$e"',
  'fi',
  'cp -R -- "$s" "$t" && printf "%s\\0" "$t"'
].join('; ')

/**
 * `$1` root, `$2` destDir, остальные — исходные пути. Печатает по паре `\0`-строк на элемент:
 * `O\0<newPath>\0` при успехе, `E\0<srcPath>\0` при ошибке/самовложении — порядок соответствует
 * входу. Используется и для move, и для copyMany (copyMany — та же схема, но `cp -R` вместо `mv`,
 * см. `COPY_MANY_SCRIPT` ниже).
 */
export const MOVE_SCRIPT = [
  'root=$1', 'd=$2', 'shift 2',
  'for s in "$@"; do case "$d/" in "$s"/*) printf "E\\0%s\\0" "$s"; continue ;; esac',
  '  r=$(cd -- "$(dirname -- "$s")" 2>/dev/null && pwd -P) || { printf "E\\0%s\\0" "$s"; continue; }',
  '  case "$r/" in "$root"/*|"$root"/) ;; *) printf "E\\0%s\\0" "$s"; continue ;; esac',
  '  b=$(basename -- "$s")',
  '  n=$b; e=',
  '  case $b in .*) ;; *.*) n=${b%.*}; e=.${b##*.} ;; esac',
  '  t=$d/$b; i=1',
  '  while [ -e "$t" ] || [ -L "$t" ]; do t="$d/$n ($i)$e"; i=$((i+1)); done',
  '  if mv -- "$s" "$t" 2>/dev/null; then printf "O\\0%s\\0" "$t"; else printf "E\\0%s\\0" "$s"; fi',
  'done'
].join('; ')

export const COPY_MANY_SCRIPT = [
  'root=$1', 'd=$2', 'shift 2',
  'for s in "$@"; do case "$d/" in "$s"/*) printf "E\\0%s\\0" "$s"; continue ;; esac',
  '  r=$(cd -- "$(dirname -- "$s")" 2>/dev/null && pwd -P) || { printf "E\\0%s\\0" "$s"; continue; }',
  '  case "$r/" in "$root"/*|"$root"/) ;; *) printf "E\\0%s\\0" "$s"; continue ;; esac',
  '  b=$(basename -- "$s")',
  '  n=$b; e=',
  '  case $b in .*) ;; *.*) n=${b%.*}; e=.${b##*.} ;; esac',
  '  t=$d/$b; i=1',
  '  while [ -e "$t" ] || [ -L "$t" ]; do t="$d/$n ($i)$e"; i=$((i+1)); done',
  '  if cp -R -- "$s" "$t" 2>/dev/null; then printf "O\\0%s\\0" "$t"; else printf "E\\0%s\\0" "$s"; fi',
  'done'
].join('; ')

/** `$1` — путь, `$2` — лимит размера в байтах. exit 2 — не файл; exit 9 + размер в stderr — превышен лимит. */
export const READ_FILE_SCRIPT = [
  '[ -f "$1" ] || exit 2',
  'n=$(wc -c < "$1" | tr -d " ")',
  '[ "$n" -le "$2" ] || { echo "$n" >&2; exit 9; }',
  'cat -- "$1"'
].join('; ')

/** `$1` — путь, содержимое приходит через stdin. `cp -p` клонирует права ДО перезаписи содержимого. */
export const WRITE_FILE_SCRIPT = [
  't="$1.etty~"',
  'cp -p -- "$1" "$t" 2>/dev/null',
  'cat > "$t" && mv -- "$t" "$1"'
].join('; ')

export const STAT_FILE_GNU_SCRIPT = 'stat -c "%Y %s" -- "$1"'
export const STAT_FILE_BSD_SCRIPT = 'stat -f "%m %z" -- "$1"'

/** `$1..$N` — каталоги; печатает mtime (сек) на каждый, либо `x` если каталог исчез. Для polling-watcher (Этап 5). */
export const POLL_MTIME_GNU_SCRIPT = 'for d in "$@"; do stat -c %Y -- "$d" 2>/dev/null || echo x; done'
export const POLL_MTIME_BSD_SCRIPT = 'for d in "$@"; do stat -f %m -- "$d" 2>/dev/null || echo x; done'
