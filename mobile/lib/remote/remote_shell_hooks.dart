import 'dart:convert';

import 'package:mobile/core/config/ssh_session_config.dart';
import 'package:mobile/remote/posix_quote.dart';

/// Строит remote-команду для SSH (позиционный аргумент exec-запроса после аутентификации —
/// см. `transport/ssh_connection.dart`, задача #11), которая на удалённой стороне воспроизводит
/// то же поведение, что десктопный `PtyManager._createZdotdir()`: пишет временные rc-файлы с
/// precmd/preexec-хуками, эмитящими OSC 7 (cwd) и OSC 133 (busy), и делает `exec` в интерактивный
/// login-shell пользователя. При `persistence: 'tmux'` тот же shell поднимается не напрямую, а
/// внутри именованной tmux-сессии — сессия переживает разрыв соединения, вкладку eTty и
/// перезапуск приложения (как на десктопе, так и на мобилке — на мобилке это ЕДИНСТВЕННЫЙ
/// вменяемый режим ввиду частых обрывов, см. REQ-10 в `docs/plans/mob/plan.md`).
///
/// Порт `src/main/ssh/remote-shell-hooks.js` — побайтовое совпадение вывода критично: сервер не
/// различает клиентов, и десктоп/мобилка обязаны генерировать РОВНО один и тот же tmux.conf и
/// remote-команду для одной и той же сессии (REQ-2). Сверяется golden-тестом
/// (`mobile/test/golden/remote_shell_hooks_golden_test.dart`) против
/// `mobile/test/fixtures/remote/init-command/*`.
///
/// Три вложенных уровня, каждый со своими правилами экранирования (дословно перенесённая модель
/// из JS-источника — см. его докстринг для полного обоснования):
///
///   L0 — команда целиком выполняется как `<login-shell-пользователя> -c "<L0>"`; какой именно
///        это shell (zsh/bash/fish/csh/dash/...), неизвестно и неконтролируемо. L0 обязана быть
///        валидной для ВСЕХ них одновременно, поэтому она — ровно одна простая команда:
///        `exec /bin/sh -c '<L1>'`. Инвариант: во всём L1 не должно быть ни одного `'` (иначе
///        досрочно закроет одинарную кавычку L0) и ни одного `!` (history expansion в csh/tcsh —
///        срабатывает даже внутри кавычек).
///
///   L1 — исполняется гарантированным POSIX `/bin/sh -c`. Собирает временный каталог и построчно
///        записывает rc-файлы через `printf "%s\n" "line1" "line2" ... > file`. Каждая строка —
///        ОДИН double-quoted аргумент L1, поэтому тоже обязана быть без `'`/`!`; спецсимволы
///        (`\`, `"`, `$`, `` ` ``) экранируются [posixDquote].
///
///        Единственное исключение — путь `$c` (каталог хуков персистентной ветки): он должен
///        раскрыться ИМЕННО на L1 (tmux.conf не делает shell-подстановку значений), поэтому
///        строка `default-command` пишется отдельным `printf` с позиционным аргументом, а не
///        через [posixDquote].
///
///   L2 — содержимое итоговых rc-файлов (и tmux.conf/init): обычный zsh/bash-код или синтаксис
///        tmux.conf, читаемый уже ПОСЛЕ exec — полноценный известный интерпретатор, никаких
///        кросс-shell ограничений. На этом уровне разрешены `'` и `!`.
///
/// Известное ограничение (перенесено как есть): если `$HOME` на сервере содержит пробел,
/// персистентная (tmux) ветка может сломаться — редкий edge case, сознательно не решается.
class RemoteShellHooks {
  RemoteShellHooks._();

  static const String _ettyTmpdirVar = 'ETTY_TMPDIR';

  // Стабильный каталог хуков персистентной (tmux) ветки — НЕ $TMPDIR (на systemd-серверах бывает
  // per-login, PrivateTmp) и НЕ $XDG_CACHE_HOME (путь должен оставаться константным текстом —
  // см. докстринг класса про L1-исключение).
  static String get _hookDirExpr => r'$HOME/' + SshSessionConfig.hookDir;

  /// Эмиттер OSC-последовательностей с поддержкой DCS-passthrough tmux (`allow-passthrough on`):
  /// tmux пропускает наружу только специально обёрнутый payload. Вне tmux (`$TMUX` пуст)
  /// поведение не отличается от версии без persistence.
  static const String _emitFn = '_etty_emit() { if [ -n "\$TMUX" ]; then '
      'printf "\\033Ptmux;\\033\\033%s\\033\\\\" "\$1"; else printf "\\033%s" "\$1"; fi; }';

  // if/fi, а не `[ -f X ] && . X`: у последнего при отсутствующем файле результат всего
  // startup-файла — код завершения самого теста (1), а .zlogin читается zsh последним из всех
  // rc-файлов — этот «зависший» $?=1 иначе становится exit-кодом всей сессии.
  static const List<String> _zshZshenv = [
    'if [ -f "\$HOME/.zshenv" ]; then . "\$HOME/.zshenv"; fi',
  ];
  static const List<String> _zshZprofile = [
    'if [ -f "\$HOME/.zprofile" ]; then . "\$HOME/.zprofile"; fi',
  ];
  static const List<String> _zshZlogin = [
    'if [ -f "\$HOME/.zlogin" ]; then . "\$HOME/.zlogin"; fi',
  ];

  /// L1: `printf "%s\n" "line1" ... > "$X/<file>.$$" && mv -f "$X/<file>.$$" "$X/<file>"`. Пишет
  /// во временный файл и атомарно переименовывает — НЕ прямой `>`. Критично для персистентной
  /// ветки: `$c` общий для ВСЕХ одновременных подключений к этому хосту, без атомарности второе
  /// параллельное подключение могло бы застать файл частично перезаписанным первым.
  static String _printfToFile(List<String> lines, String fileNameExpr) {
    final args = lines.map((line) => '"${posixDquote(line)}"').join(' ');
    // '$$' у tmux/sh — PID ТЕКУЩЕГО L1-процесса, гарантированно различен у конкурентных
    // подключений; здесь это буквальный текст, попадающий в L1 (не Dart-интерполяция).
    final tmpExpr = fileNameExpr.endsWith('"')
        ? '${fileNameExpr.substring(0, fileNameExpr.length - 1)}.\$\$"'
        : fileNameExpr;
    return 'printf "%s\\n" $args > $tmpExpr && mv -f $tmpExpr $fileNameExpr';
  }

  /// Каждый байт UTF-8 -> `\ooo` (три восьмеричные цифры). Результат состоит только из `\` и
  /// цифр — безопасен для L0 и для формата `printf` в любом POSIX sh.
  static String _octalEncode(String text) => utf8
      .encode(text)
      .map((b) => '\\${b.toRadixString(8).padLeft(3, '0')}')
      .join();

  static void _assertL0Safe(String text, String label) {
    if (text.contains("'") || text.contains('!')) {
      throw ArgumentError(
        'remote-shell-hooks: сгенерированный $label содержит \' или ! — сломает L0-обёртку',
      );
    }
  }

  /// .zshrc — sourcing пользовательского ~/.zshrc + zsh-хуки для OSC 7/133 через `_etty_emit`.
  /// [withCleanup] — только для НЕ-персистентной ветки: временный каталог обязан
  /// самоуничтожиться при выходе shell; персистентный `$HOME/.cache/etty` общий для всех сессий
  /// пользователя на хосте — первый же выходящий shell не должен стирать его для остальных.
  static List<String> _zshRcLines({required bool withCleanup}) {
    final lines = <String>[
      'if [ -f "\$HOME/.zshrc" ]; then . "\$HOME/.zshrc"; fi',
      'autoload -Uz add-zsh-hook',
      _emitFn,
      '_etty_cwd() { _etty_emit "\$(printf "]7;file://%s\\007" "\$PWD")"; }',
      '_etty_pre() { _etty_emit "\$(printf "]133;C\\007")"; }',
      '_etty_post() { _etty_emit "\$(printf "]133;A\\007")"; }',
      // OSC 6973: путь к node текущего шелла — паритет с десктопом (см. remote-shell-hooks.js)
      '_etty_node() { _etty_emit "\$(printf "]6973;node=%s\\007" "\${commands[node]}")"; }',
      'add-zsh-hook precmd _etty_cwd',
      'add-zsh-hook preexec _etty_pre',
      'add-zsh-hook precmd _etty_post',
      'add-zsh-hook precmd _etty_node',
    ];
    if (withCleanup) {
      lines.add('zshexit() { rm -rf "\$$_ettyTmpdirVar"; }');
    }
    lines.add('_etty_cwd');
    lines.add('_etty_node');
    return lines;
  }

  /// bash игнорирует --rcfile для login-shell, поэтому login-профиль сорсим вручную.
  /// PROMPT_COMMAND покрывает и cwd, и busy=done; DEBUG-трап эмитит busy=start перед КАЖДОЙ
  /// простой командой, явно игнорируя собственный вызов `_etty_cwd` из PROMPT_COMMAND.
  static List<String> _bashRcLines({required bool withCleanup}) {
    final lines = <String>[
      'if [ -f "\$HOME/.bash_profile" ]; then . "\$HOME/.bash_profile"; '
          'elif [ -f "\$HOME/.bashrc" ]; then . "\$HOME/.bashrc"; fi',
      _emitFn,
      '_etty_cwd() { _etty_emit "\$(printf "]7;file://%s\\007" "\$PWD")"; '
          '_etty_emit "\$(printf "]6973;node=%s\\007" "\$(type -P node)")"; '
          '_etty_emit "\$(printf "]133;A\\007")"; }',
      '_etty_pre() { case "\$BASH_COMMAND" in _etty_cwd*) return ;; esac; '
          '_etty_emit "\$(printf "]133;C\\007")"; }',
      'PROMPT_COMMAND=_etty_cwd',
      'trap _etty_pre DEBUG',
    ];
    if (withCleanup) {
      lines.add('trap "rm -rf \\"\$$_ettyTmpdirVar\\"" EXIT');
    }
    return lines;
  }

  /// [sessionName] обязателен при `persistence: 'tmux'`; проверяется
  /// [SshSessionConfig.sessionNameRe] (единственная интерполяция данных в текст скрипта —
  /// валидация здесь, а не только на вызывающей стороне, часть инварианта L0).
  ///
  /// [socketName] — сокет tmux-сервера (`-L`); `''` — использовать сокет по умолчанию (сессии
  /// совместимы с обычным `tmux ls` пользователя, но наш tmux.conf применится, только если этот
  /// вызов сам стартует сервер).
  ///
  /// Возвращает remote-команду — позиционный аргумент exec-запроса.
  ///
  /// [startDir] — стартовая папка НОВОЙ tmux-сессии (`new-session -c`). Для уже существующей
  /// сессии tmux её игнорирует (attach). Действует только при `persistence: 'tmux'`; при `'off'`
  /// непустой [startDir] — ошибка (молча проигнорировать значило бы скрыть баг вызывающего).
  /// При `null` вывод побайтово совпадает с версией без параметра (golden-фикстуры).
  ///
  /// Путь нельзя вставлять в L1 как есть: в INNER запрещены `'` и `!`, а `$`, `` ` ``, `\`, `"`
  /// пришлось бы экранировать. Поэтому каждый байт UTF-8 кодируется восьмеричным escape-ом
  /// `\ooo` (включая `%` и `\` — они спецсимволы формата `printf`), и в INNER попадают только
  /// `\` и цифры; значение присваивается переменной `d` (в tmux-ветке она свободна) через
  /// `d=$(printf "...")` и подставляется как `-c "$d"`.
  ///
  /// Бросает [ArgumentError] при невалидном `sessionName`/`socketName` в режиме `tmux`, а также
  /// при [startDir]: пустом, неабсолютном, содержащем NUL/`\n`/`\r`, или заданном вне `tmux`.
  static String buildRemoteInitCommand({
    String persistence = 'off',
    String? sessionName,
    bool hooks = true,
    String socketName = SshSessionConfig.defaultSocket,
    String? startDir,
  }) {
    final useTmux = persistence == 'tmux';

    if (startDir != null) {
      if (!useTmux) {
        throw ArgumentError('remote-shell-hooks: startDir поддерживается только при persistence tmux');
      }
      if (!startDir.startsWith('/') ||
          startDir.contains('\x00') ||
          startDir.contains('\n') ||
          startDir.contains('\r')) {
        throw ArgumentError('remote-shell-hooks: startDir должен быть абсолютным путём без NUL/CR/LF');
      }
    }

    if (useTmux && !SshSessionConfig.sessionNameRe.hasMatch(sessionName ?? '')) {
      throw ArgumentError('remote-shell-hooks: некорректное имя tmux-сессии');
    }
    if (useTmux && socketName.isNotEmpty && !SshSessionConfig.sessionNameRe.hasMatch(socketName)) {
      throw ArgumentError('remote-shell-hooks: некорректное имя tmux-сокета');
    }

    final l1 = <String>[
      r's=${SHELL:-/bin/sh}',
      // Неизвестный login-shell — сразу выходим без хуков, ничего не создавая.
      'case "\$s" in *zsh) m=z ;; *bash) m=b ;; *) m=n ;; esac',
    ];

    if (!useTmux) {
      l1.addAll([
        r'd=${TMPDIR:-/tmp}/etty-$$',
        'if [ "\$m" = n ]; then exec "\$s" -l; fi',
        // Нет прав на запись в TMPDIR/нет mkdir — тот же fallback. Без `!`: `||` вместо negation.
        'mkdir -m 700 "\$d" 2>/dev/null || exec "\$s" -l',
        '$_ettyTmpdirVar=\$d',
        'export $_ettyTmpdirVar',
      ]);
      if (!hooks) {
        l1.add('exec "\$s" -l');
      } else {
        l1.addAll([
          // `then`/`else` обязаны сразу сопровождаться реальной командой в ТОЙ ЖЕ строке.
          'if [ "\$m" = z ]; then ${_printfToFile(_zshZshenv, '"\$d/.zshenv"')}',
          _printfToFile(_zshZprofile, '"\$d/.zprofile"'),
          _printfToFile(_zshZlogin, '"\$d/.zlogin"'),
          _printfToFile(_zshRcLines(withCleanup: true), '"\$d/.zshrc"'),
          'ZDOTDIR=\$d',
          'export ZDOTDIR',
          'exec "\$s" -l',
          'else ${_printfToFile(_bashRcLines(withCleanup: true), '"\$d/rc"')}',
          'exec "\$s" --rcfile "\$d/rc" -i',
          'fi',
        ]);
      }
    } else {
      // Персистентная ветка: стабильный каталог, БЕЗ zshexit/trap-очистки (общий для всех
      // сессий пользователя на хосте).
      l1.addAll([
        'n=$sessionName',
        'c=$_hookDirExpr',
        't=\$(command -v tmux 2>/dev/null)',
        'mkdir -p "\$c" 2>/dev/null || exec "\$s" -l',
        'chmod 700 "\$c" 2>/dev/null',
      ]);

      if (!hooks) {
        l1.add(_printfToFile(['exec "\${SHELL:-/bin/sh}" -l'], '"\$c/init"'));
      } else {
        l1.addAll([
          'if [ "\$m" = z ]; then ${_printfToFile(_zshZshenv, '"\$c/.zshenv"')}',
          _printfToFile(_zshZprofile, '"\$c/.zprofile"'),
          _printfToFile(_zshZlogin, '"\$c/.zlogin"'),
          _printfToFile(_zshRcLines(withCleanup: false), '"\$c/.zshrc"'),
          // init выводит ZDOTDIR из СОБСТВЕННОГО расположения — при повторном attach к уже
          // существующей сессии окружение не переустанавливается, полагаться на наследование
          // env нельзя.
          _printfToFile([
            'd=\$(cd -- "\$(dirname -- "\$0")" && pwd)',
            'ZDOTDIR=\$d',
            'export ZDOTDIR',
            'exec "\${SHELL:-/bin/sh}" -l',
          ], '"\$c/init"'),
          'elif [ "\$m" = b ]; then ${_printfToFile(_bashRcLines(withCleanup: false), '"\$c/rc"')}',
          _printfToFile([
            'd=\$(cd -- "\$(dirname -- "\$0")" && pwd)',
            'exec "\${SHELL:-/bin/sh}" --rcfile "\$d/rc" -i',
          ], '"\$c/init"'),
          'else ${_printfToFile(['exec "\${SHELL:-/bin/sh}" -l'], '"\$c/init"')}',
          'fi',
        ]);
      }

      l1.add('chmod 700 "\$c/init" 2>/dev/null');

      final tmuxConfLines = <String>[
        // on, не all: пропускать OSC только из ВИДИМОЙ панели.
        'set -g allow-passthrough on',
        'set -g status off',
        // mouse off: выделение мышью отдаётся нативному терминалу — при mouse on tmux
        // перехватывал бы ЛЮБОЙ drag под свой copy-mode.
        'set -g mouse off',
        'set -s set-clipboard on',
        'set -as terminal-features ",*:clipboard"',
        'bind-key -T copy-mode Enter send-keys -X copy-pipe-and-cancel',
        'bind-key -T copy-mode-vi Enter send-keys -X copy-pipe-and-cancel',
        'bind-key -T copy-mode-vi y send-keys -X copy-pipe-and-cancel',
        'set -s extended-keys on',
        'set -as terminal-features ",*:extkeys"',
        'bind-key -n S-Enter send-keys Escape "[13;2u"',
        // Колесо мыши больше не ловится tmux (mouse off) — клиент транслирует прокрутку в эти
        // два синтетических биндинга (CSI-u), не пересекающихся с реальными хоткеями.
        'bind-key -n C-M-S-Up if -F "#{alternate_on}" "" "copy-mode -e ; send-keys -X -N 3 scroll-up"',
        'bind-key -n C-M-S-Down if -F "#{alternate_on}" "" "send-keys -X -N 3 scroll-down"',
        'set -g history-limit 10000',
        'set -g escape-time 10',
        'set -g focus-events on',
        'set -g window-size latest',
        'set -g default-terminal screen-256color',
        'set -as terminal-features ",*:RGB"',
        // Невидимый слой персистентности, не UI мультиплексора — C-b не отбирается у
        // readline/vim/TUI-агентов.
        'set -g prefix None',
      ];

      final tmuxConfBody = tmuxConfLines.map((line) => '"${posixDquote(line)}"').join(' ');
      l1.addAll([
        'printf "%s\\n" $tmuxConfBody > "\$c/tmux.conf.\$\$"',
        'printf "set -g default-command \\"/bin/sh %s/init\\"\\n" "\$c" >> "\$c/tmux.conf.\$\$"',
        'mv -f "\$c/tmux.conf.\$\$" "\$c/tmux.conf"',
      ]);

      // `-f` учитывается tmux только при СТАРТЕ сервера — уже поднятая сессия обновлённый
      // tmux.conf сама не подхватит. Догоняем её явным source-file, ДО new-session ниже.
      l1.add(
        socketName.isNotEmpty
            ? '[ -n "\$t" ] && "\$t" -u -L $socketName list-sessions >/dev/null 2>&1 && '
                '"\$t" -u -L $socketName source-file "\$c/tmux.conf" >/dev/null 2>&1'
            : '[ -n "\$t" ] && "\$t" -u list-sessions >/dev/null 2>&1 && '
                '"\$t" -u source-file "\$c/tmux.conf" >/dev/null 2>&1',
      );

      if (socketName.isEmpty) {
        // Режим совместимости (сокет пользователя): -f учитывается только при СТАРТЕ сервера.
        l1.add('[ -n "\$TMUX" ] && tmux set -p allow-passthrough on 2>/dev/null');
      }

      final startDirAssign = startDir == null ? null : 'd=\$(printf "${_octalEncode(startDir)}")';
      if (startDirAssign != null) l1.add(startDirAssign);
      final cArg = startDir == null ? '' : ' -c "\$d"';

      l1.addAll([
        // tmux на сервере нет — сегодняшнее поведение (обычный login-shell с хуками), без
        // жёсткой ошибки.
        'if [ -z "\$t" ]; then exec /bin/sh "\$c/init"; fi',
        // -u: локаль на сервер не уезжает — без неё tmux ломает псевдографику. -A -D: attach,
        // если сессия есть, с отцепкой прочих клиентов («последний attach выигрывает»).
        socketName.isNotEmpty
            ? 'exec "\$t" -u -L $socketName -f "\$c/tmux.conf" new-session -A -D -s "\$n"$cArg '
                '"/bin/sh \$c/init"'
            : 'exec "\$t" -u -f "\$c/tmux.conf" new-session -A -D -s "\$n"$cArg "/bin/sh \$c/init"',
      ]);
    }

    final inner = l1.join('; ');
    _assertL0Safe(inner, 'L1 (INNER)');

    // Одинарные кавычки — единственный кавычочный стиль, одинаково понятный sh/bash/zsh/fish/csh
    // как «буквальная строка без интерпретации». `inner` гарантированно не содержит ' и !
    // (см. _assertL0Safe выше), поэтому оборачиваем без дополнительного экранирования.
    return "exec /bin/sh -c '$inner'";
  }
}
