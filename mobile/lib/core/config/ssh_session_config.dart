/// Константы персистентных удалённых сессий (tmux) по SSH — порт
/// `src/shared/ssh-session-config.js` десктопного eTty.
///
/// Значения должны совпадать с десктопом побайтово/побитово: сервер не различает клиентов, и
/// расхождение здесь (имя дефолтного сокета, regex имени сессии, тайминги ресинка) ломает
/// совместимость персистентных сессий между десктопом и мобилкой. Сверяется golden-тестом
/// (`mobile/test/golden/config_golden_test.dart`) против `mobile/test/fixtures/remote/config.json`,
/// сгенерированного из исходного JS (`scripts/gen-remote-fixtures.mjs`, REQ-4 в
/// `docs/plans/mob/plan.md`) — не редактировать значения здесь без синхронной правки десктопа.
abstract final class SshSessionConfig {
  /// Имя tmux-сессии — только буквы/цифры/`_`/`-`: tmux запрещает `.` и `:` в именах, а сама
  /// строка попадает как единственная интерполяция в текст remote-команды
  /// (`remote_shell_hooks.dart`) — валидируется ДО подстановки.
  static final RegExp sessionNameRe = RegExp(r'^[A-Za-z0-9_-]{1,64}$');

  /// Отдельный сокет tmux-сервера eTty (`-L <socket>`) — не трогает сокет/сессии пользователя по
  /// умолчанию. Пустая строка означает «сокет по умолчанию» (режим совместимости).
  static const String defaultSocket = 'etty';

  /// Стабильный каталог хуков на сервере — НЕ `$TMPDIR` (может быть per-login на systemd,
  /// PrivateTmp).
  static const String hookDir = '.cache/etty';

  static const String tmuxMinVersion = '1.8';
  static const String tmuxPassthroughMinVersion = '3.3';

  /// Опрос состояния сессии (cwd/busy) через `display-message`, когда OSC не проходит наружу
  /// (tmux < 3.3 или passthrough недоступен).
  static const int statePollMs = 4000;

  /// Панель SSH/tmux-сессий — автополлинг списка сессий сервера.
  static const int sessionsPollMs = 15000;

  /// Внеочередное обновление списка после открытия/закрытия/обрыва tmux-вкладки: в момент самого
  /// события клиент на сервере ещё не (от)цеплен — короткая пауза, иначе запрос вернул бы старое
  /// состояние.
  static const int sessionsRefreshDelayMs = 800;

  static const int masterConnectTimeoutMs = 20000;
  static const int masterIdleDisposeMs = 60000;
  static const int masterFailureCooldownMs = 30000;
  static const String masterControlPersist = '5m';
  static const int sessionsOpTimeoutMs = 15000;

  /// Мост колеса мыши в tmux-вкладке (`mouse off` в генерируемом tmux.conf — выделение отдано
  /// нативному терминалу): вертикальный жест транслируется в эти CSI-u escape-последовательности,
  /// распознаваемые биндингами `C-M-S-Up`/`C-M-S-Down` в `remote_shell_hooks.dart`.
  static const String wheelScrollUpSeq = '\x1b[1;8A';
  static const String wheelScrollDownSeq = '\x1b[1;8B';
}
