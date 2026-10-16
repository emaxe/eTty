/// POSIX sh-скрипты для операций удалённой ФС и tmux-сессий — порт `src/main/ssh/remote-scripts.js`
/// десктопного eTty. Побайтовая копия: любое расхождение с десктопом ловится golden-тестом
/// (`mobile/test/golden/remote_scripts_golden_test.dart`) против `mobile/test/fixtures/remote/scripts.json`.
///
/// Схема безопасности (та же, что на десктопе): скрипты — КОНСТАНТНЫЕ строки, все переменные
/// данные передаются ПОЗИЦИОННЫМИ ПАРАМЕТРАМИ (`"$1"`, `"$2"`, `"$@"`), никогда не интерполируются
/// в текст скрипта. На стороне транспорта (`transport/remote_exec.dart`, задача #12/#27) каждый
/// аргумент квотируется отдельно перед сборкой exec-команды — сами строки ниже трогать не нужно.
abstract final class RemoteScripts {
  /// Одноразовый probe при подключении — снимает ОС/`$HOME`/пользователя/login-shell/поддержку
  /// `find -print0`/наличие `inotifywait`/`rg`/версию tmux/менеджер пакетов. Один RTT вместо
  /// `||`-цепочек в каждой отдельной команде. Разбирается `RemoteParse.parseProbe`.
  static final String probeScript = [
    'uname -s',
    'printf "%s\\n" "\$HOME"',
    'id -un',
    'printf "%s\\n" "\${SHELL:-}"',
    // GNU stat понимает `-c`, BSD/macOS — нет (и наоборот `-f`)
    'if stat -c %Y . >/dev/null 2>&1; then echo gnu; else echo bsd; fi',
    'if find . -maxdepth 0 -print0 >/dev/null 2>&1; then echo find0; else echo nofind0; fi',
    'if command -v inotifywait >/dev/null 2>&1; then echo inotify; else echo -; fi',
    'if command -v rg >/dev/null 2>&1; then echo rg; else echo -; fi',
    'if command -v tmux >/dev/null 2>&1; then tmux -V; else echo -; fi',
    'if command -v apt-get >/dev/null 2>&1; then echo apt; '
        'elif command -v dnf >/dev/null 2>&1; then echo dnf; '
        'elif command -v yum >/dev/null 2>&1; then echo yum; '
        'elif command -v apk >/dev/null 2>&1; then echo apk; '
        'elif command -v pacman >/dev/null 2>&1; then echo pacman; '
        'elif command -v zypper >/dev/null 2>&1; then echo zypper; '
        'elif command -v brew >/dev/null 2>&1; then echo brew; '
        'else echo -; fi',
  ].join('; ');

  /// Читает список файлов/папок каталога `$1` — раздельные `find`-проходы (папки, затем файлы) с
  /// NUL-терминатором и ОДНИМ дополнительным `\0` между секциями как разделителем. Без `-L`:
  /// символьная ссылка на директорию классифицируется как файл. Разбирается
  /// `RemoteParse.parseReadDir`.
  static final String readDirScript = [
    'cd -- "\$1" || exit 3',
    'find . -mindepth 1 -maxdepth 1 -type d -print0',
    'printf \'\\0\'',
    'find . -mindepth 1 -maxdepth 1 ! -type d -print0',
  ].join('; ');

  /// Fallback readDir для серверов без `find -print0`.
  static final String readDirFallbackScript = [
    'cd -- "\$1" || exit 3',
    'for e in */ .*/; do [ -e "\$e" ] || [ -L "\$e" ] || continue',
    '  case "\$e" in ./|../) continue ;; esac',
    '  printf "%s\\0" "\${e%/}"',
    'done',
    'printf \'\\0\'',
    'for e in * .*; do [ -d "\$e" ] && continue',
    '  case "\$e" in .|..) continue ;; esac',
    '  { [ -e "\$e" ] || [ -L "\$e" ]; } || continue',
    '  printf "%s\\0" "\$e"',
    'done',
  ].join('; ');

  /// `$1` — уже разрешённый (realpath) корень сессии; `$2` — целевой путь мутации.
  static final String _validatePrefix =
      'r=\$(cd -- "\$(dirname -- "\$2")" 2>/dev/null && pwd -P) || exit 13; '
      'case "\$r/" in "\$1"/*|"\$1"/) ;; *) exit 13 ;; esac';

  /// `getCwd`-совместимый realpath — используется при probe/подключении для стартового корня.
  static final String realpathScript = 'cd -- "\$1" 2>/dev/null && pwd -P || exit 3';

  static final String createFileScript = '$_validatePrefix; set -C; : > "\$2" 2>/dev/null || exit 1';

  static final String createDirScript = '$_validatePrefix; mkdir -p -- "\$2"';

  /// `$1` root, `$2` oldPath, `$3` newPath.
  static final String renameScript = [
    'r=\$(cd -- "\$(dirname -- "\$2")" 2>/dev/null && pwd -P) || exit 13',
    'case "\$r/" in "\$1"/*|"\$1"/) ;; *) exit 13 ;; esac',
    'if [ -e "\$3" ] || [ -L "\$3" ]; then exit 17; fi',
    'mv -- "\$2" "\$3"',
  ].join('; ');

  /// `$1` root, остальные — пути к удалению (могут быть много, чанкуется на стороне вызова).
  static final String deleteManyScript = [
    'root=\$1',
    'shift',
    'for p in "\$@"; do r=\$(cd -- "\$(dirname -- "\$p")" 2>/dev/null && pwd -P) || continue',
    '  case "\$r/" in "\$root"/*|"\$root"/) rm -rf -- "\$p" ;; esac',
    'done',
  ].join('; ');

  /// `$1` root, `$2` src, `$3` destDir — печатает `"%s\0"` с итоговым путём (после разрешения
  /// коллизий). Разбирается `RemoteParse.parseSinglePathResult`.
  static final String copyScript = [
    's=\$2',
    'd=\$3',
    'r=\$(cd -- "\$(dirname -- "\$s")" 2>/dev/null && pwd -P) || exit 13',
    'case "\$r/" in "\$1"/*|"\$1"/) ;; *) exit 13 ;; esac',
    'b=\$(basename -- "\$s")',
    't=\$d/\$b',
    'if [ -e "\$t" ] || [ -L "\$t" ]; then n=\$b; e=',
    '  case \$b in .*) ;; *.*) n=\${b%.*}; e=.\${b##*.} ;; esac',
    '  t="\$d/\$n (copy)\$e"',
    'fi',
    'cp -R -- "\$s" "\$t" && printf "%s\\0" "\$t"',
  ].join('; ');

  /// `$1` root, `$2` destDir, остальные — исходные пути. Печатает по паре `\0`-строк на элемент:
  /// `O\0<newPath>\0` при успехе, `E\0<srcPath>\0` при ошибке/самовложении — порядок соответствует
  /// входу. Разбирается `RemoteParse.parseMoveOrCopyMany`.
  static final String moveScript = [
    'root=\$1',
    'd=\$2',
    'shift 2',
    'for s in "\$@"; do case "\$d/" in "\$s"/*) printf "E\\0%s\\0" "\$s"; continue ;; esac',
    '  r=\$(cd -- "\$(dirname -- "\$s")" 2>/dev/null && pwd -P) || { printf "E\\0%s\\0" "\$s"; continue; }',
    '  case "\$r/" in "\$root"/*|"\$root"/) ;; *) printf "E\\0%s\\0" "\$s"; continue ;; esac',
    '  b=\$(basename -- "\$s")',
    '  n=\$b; e=',
    '  case \$b in .*) ;; *.*) n=\${b%.*}; e=.\${b##*.} ;; esac',
    '  t=\$d/\$b; i=1',
    '  while [ -e "\$t" ] || [ -L "\$t" ]; do t="\$d/\$n (\$i)\$e"; i=\$((i+1)); done',
    '  if mv -- "\$s" "\$t" 2>/dev/null; then printf "O\\0%s\\0" "\$t"; else printf "E\\0%s\\0" "\$s"; fi',
    'done',
  ].join('; ');

  static final String copyManyScript = [
    'root=\$1',
    'd=\$2',
    'shift 2',
    'for s in "\$@"; do case "\$d/" in "\$s"/*) printf "E\\0%s\\0" "\$s"; continue ;; esac',
    '  r=\$(cd -- "\$(dirname -- "\$s")" 2>/dev/null && pwd -P) || { printf "E\\0%s\\0" "\$s"; continue; }',
    '  case "\$r/" in "\$root"/*|"\$root"/) ;; *) printf "E\\0%s\\0" "\$s"; continue ;; esac',
    '  b=\$(basename -- "\$s")',
    '  n=\$b; e=',
    '  case \$b in .*) ;; *.*) n=\${b%.*}; e=.\${b##*.} ;; esac',
    '  t=\$d/\$b; i=1',
    '  while [ -e "\$t" ] || [ -L "\$t" ]; do t="\$d/\$n (\$i)\$e"; i=\$((i+1)); done',
    '  if cp -R -- "\$s" "\$t" 2>/dev/null; then printf "O\\0%s\\0" "\$t"; else printf "E\\0%s\\0" "\$s"; fi',
    'done',
  ].join('; ');

  /// `$1` — путь, `$2` — лимит размера в байтах. exit 2 — не файл; exit 9 + размер в stderr —
  /// превышен лимит.
  static final String readFileScript = [
    '[ -f "\$1" ] || exit 2',
    'n=\$(wc -c < "\$1" | tr -d " ")',
    '[ "\$n" -le "\$2" ] || { echo "\$n" >&2; exit 9; }',
    'cat -- "\$1"',
  ].join('; ');

  /// `$1` — путь, содержимое приходит через stdin. `cp -p` клонирует права ДО перезаписи
  /// содержимого.
  static final String writeFileScript = [
    't="\$1.etty~"',
    'cp -p -- "\$1" "\$t" 2>/dev/null',
    'cat > "\$t" && mv -- "\$t" "\$1"',
  ].join('; ');

  /// `$1` — имя файла (без `/`), содержимое приходит через stdin. Кладёт в
  /// `${TMPDIR:-/tmp}/etty-paste/` (права 700/600), чистит файлы старше суток и печатает путь.
  static final String uploadPasteImageScript = [
    'umask 077',
    't="\${TMPDIR:-/tmp}"',
    'd="\${t%/}/etty-paste"',
    'mkdir -p -- "\$d" || exit 1',
    'find "\$d" -type f -mmin +1440 -exec rm -f {} + 2>/dev/null',
    'cat > "\$d/\$1" || exit 1',
    'printf %s "\$d/\$1"',
  ].join('; ');

  static final String statFileGnuScript = 'stat -c "%Y %s" -- "\$1"';
  static final String statFileBsdScript = 'stat -f "%m %z" -- "\$1"';

  /// `$1..$N` — каталоги; печатает mtime (сек) на каждый, либо `x` если каталог исчез.
  static final String pollMtimeGnuScript =
      'for d in "\$@"; do stat -c %Y -- "\$d" 2>/dev/null || echo x; done';
  static final String pollMtimeBsdScript =
      'for d in "\$@"; do stat -f %m -- "\$d" 2>/dev/null || echo x; done';

  /// Персистентные сессии (tmux): `$1` — сокет (`-L`, пусто = сокет по умолчанию), `$2` — имя
  /// сессии. Печатает `<pane_current_path>|<pane_path>|<pane_current_command>|<foreground args>`
  /// либо ничего. Разбирается `RemoteParse.parseTmuxSessionState`.
  static final String tmuxSessionStateScript = [
    's=\$1; n=\$2; [ -n "\$s" ] && o="-L \$s" || o=',
    'out=\$(tmux \$o display-message -p -t "\$n" "#{pane_current_path}|#{pane_path}|#{pane_current_command}|#{pane_tty}" 2>/dev/null) || exit 1',
    'tty=\${out##*|}; out=\${out%|*}',
    'a=\$(ps -t "\${tty#/dev/}" -o pid= -o tpgid= -o args= 2>/dev/null | awk \'\$1==\$2 { \$1=""; \$2=""; sub(/^ +/,""); print; exit }\')',
    r"printf '%s|%s\n' " '"\$out" "\$a"',
  ].join('; ');

  /// Список tmux-сессий на сокете `$1` (пусто = сокет по умолчанию). `exit 127` — tmux не
  /// установлен. Разбирается `RemoteParse.parseTmuxSessions`.
  static final String tmuxListSessionsScript = [
    's=\$1',
    '[ -n "\$s" ] && o="-L \$s" || o=',
    'command -v tmux >/dev/null 2>&1 || exit 127',
    'export LC_ALL=C.UTF-8',
    'tmux \$o list-sessions -F "#{session_windows}\t#{session_attached}\t#{session_created}\t#{session_activity}\t#{session_name}" 2>/dev/null | tr "\\t" "\\0"',
    'printf \'\\n\'',
    'tmux \$o list-panes -a -F "#{window_active}\t#{pane_active}\t#{pane_current_command}\t#{session_name}" 2>/dev/null | tr "\\t" "\\0"',
  ].join('; ');

  /// Убивает tmux-сессию `$2` на сокете `$1` (пусто = по умолчанию). `exit 3` — сессии с таким
  /// именем нет.
  static final String tmuxKillSessionScript = [
    's=\$1',
    '[ -n "\$s" ] && o="-L \$s" || o=',
    'tmux \$o list-sessions -F "#{session_name}" 2>/dev/null | grep -qxF -- "\$2" || exit 3',
    'tmux \$o kill-session -t "\$2"',
  ].join('; ');

  /// Переименовывает tmux-сессию `$2` → `$3` на сокете `$1`. `exit 3` — сессии `$2` нет,
  /// `exit 17` — `$3` занято.
  static final String tmuxRenameSessionScript = [
    's=\$1',
    '[ -n "\$s" ] && o="-L \$s" || o=',
    'tmux \$o list-sessions -F "#{session_name}" 2>/dev/null | grep -qxF -- "\$2" || exit 3',
    'tmux \$o list-sessions -F "#{session_name}" 2>/dev/null | grep -qxF -- "\$3" && exit 17',
    'tmux \$o rename-session -t "\$2" -- "\$3"',
  ].join('; ');
}
