import 'dart:async';
import 'dart:typed_data';

import 'package:mobile/core/config/ssh_session_config.dart';
import 'package:mobile/domain/osc_tap.dart';
import 'package:mobile/remote/remote_shell_hooks.dart';
import 'package:mobile/remote/session_name.dart';
import 'package:mobile/transport/shell_session.dart';
import 'package:mobile/transport/ssh_connection.dart';

/// Порог «быстрого падения» вкладки сразу после подключения — признак конфликта инжектированной
/// remote-команды (`RemoteShellHooks`) с `RemoteCommand`/`ForceCommand` на сервере, требующий
/// одного реконнекта без хуков. То же значение, что `APP_CONFIG.SSH_HOOK_FAIL_FAST_MS` на
/// десктопе (`src/renderer/core/config/app-config.js`) — это renderer-only UI-константа, не часть
/// золотого `SSH_SESSION_CONFIG`/`config.json` (REQ-4), поэтому не в `ssh_session_config.dart`.
const int hookFailFastMs = 3000;

enum TabConnectionStatus {
  connecting,
  connected,

  /// Канал закрыт НАМИ (свёртывание приложения — REQ-11, либо закрытие вкладки) — для
  /// tmux-вкладки это детач, сессия на сервере жива; переподключение — обычный [TabController.connect].
  detached,

  /// `exitCode 0` на tmux-вкладке после успешного attach — сессию перехватил другой клиент
  /// (`new-session -A -D` отцепляет прежнего, REQ-12). Не путать с [detached] — здесь канал
  /// закрыла УДАЛЁННАЯ сторона, не мы.
  intercepted,

  /// Неожиданное завершение канала (обрыв, ошибка аутентификации, крах shell) — [exitCode]/[error]
  /// заполнены, чем именно. Ретрай — вызов [TabController.connect] пользователем (кнопка «Ещё раз»).
  error,
}

class TabStatusEvent {
  const TabStatusEvent(this.status, {this.exitCode, this.error});

  final TabConnectionStatus status;
  final int? exitCode;
  final Object? error;
}

/// Жизненный цикл одной вкладки терминала: выбор имени tmux-сессии, построение remote-команды,
/// запуск/переподключение [ShellSession], перехват вывода через [OscTap] до отдачи наружу,
/// распознавание «сессию перехватил другой клиент» (REQ-12) и один авто-ретрай без хуков при
/// быстром падении (REQ-2 персистентности не касается — remote-команда с `persistence`
/// сохраняется, ретрай выключает только OSC/ZDOTDIR-хуки). Порт логики `connectSshTab`/
/// `onPtyExit` из `src/renderer/index.js` — десктоп разносит её между main/renderer, здесь один
/// domain-класс, т.к. на мобилке нет процесса-посредника.
///
/// НЕ отвечает за ресинк cwd/busy после реаттача через `TMUX_SESSION_STATE_SCRIPT` — это
/// `lifecycle_controller.dart` (задача #28), который управляет detach/reattach НА УРОВНЕ
/// приложения (пауза/резюм ОС) поверх нескольких вкладок; здесь — только один канал одной вкладки.
class TabController {
  TabController({
    required this.clientSource,
    required this.connectionId,
    required int cols,
    required int rows,
    this.persistence = 'tmux',
    this.hooksEnabled = true,
    this.socketName = SshSessionConfig.defaultSocket,
    String? sessionName,
    this.startDir,
    Iterable<String> takenSessionNames = const [],
    this.onCwdChange,
    this.onBusyChange,
    this.onClipboardWrite,
  }) : assert(persistence == 'off' || persistence == 'tmux'),
       _cols = cols,
       _rows = rows,
       sessionName = persistence == 'tmux'
           ? (sessionName ??
                 pickFreeSessionName(
                   buildSessionNameBase(connectionId),
                   takenSessionNames,
                 ))
           : null;

  final SshClientSource clientSource;

  /// Источник имени tmux-сессии ([buildSessionNameBase]) — то же подключение с любого клиента
  /// (десктоп/другая вкладка мобилки) обязано находить ту же серверную сессию (REQ-1).
  final String connectionId;

  /// `'off'` | `'tmux'` — фиксируется на весь жизненный цикл вкладки; смена режима на десктопе
  /// тоже требует новой вкладки, не переключателя на лету.
  final String persistence;

  final String socketName;

  /// `null` при `persistence == 'off'` — обычная SSH-сессия не именуется.
  final String? sessionName;

  /// Стартовая папка НОВОЙ tmux-сессии (`new-session -c`). Для уже существующей сессии tmux её
  /// игнорирует (REQ-10). Учитывается только при `persistence == 'tmux'`: при `'off'` в
  /// [RemoteShellHooks.buildRemoteInitCommand] передаётся `null` (без assert/исключения — вкладка
  /// просто открывается в домашней папке). Final-поле, поэтому сохраняется при авто-ретрае без
  /// хуков и при повторном [connect].
  final String? startDir;

  /// Предпочтение пользователя (профиль подключения) — не мутируется авто-ретраем, см.
  /// [_hooksForThisAttempt].
  final bool hooksEnabled;

  final void Function(String path)? onCwdChange;
  final void Function(bool busy)? onBusyChange;
  final void Function(String text)? onClipboardWrite;

  int _cols;
  int _rows;

  ShellSession? _session;
  StreamSubscription<Uint8List>? _outputSub;
  final StreamController<Uint8List> _outputController =
      StreamController<Uint8List>.broadcast();
  final StreamController<TabStatusEvent> _status =
      StreamController<TabStatusEvent>.broadcast();

  bool _connecting = false;
  bool _disposed = false;
  bool _everConnected = false;
  bool _hookRetriedThisCycle = false;
  bool _hooksForThisAttempt = true;
  DateTime? _connectedAt;

  /// Вывод текущей сессии, уже прошедший через [OscTap] — подавать в `terminal.write()`
  /// (задача #22). Стрим стабилен на весь жизненный цикл контроллера (broadcast), переживает
  /// внутренние переподключения — не пересоздаётся на каждый [connect].
  Stream<Uint8List> get output => _outputController.stream;

  Stream<TabStatusEvent> get status => _status.stream;

  bool get isConnected => _session != null;

  int? get exitCode => _session?.exitCode;

  /// (Пере)подключается — сбрасывает состояние авто-ретрая (новый цикл): обычный вызов
  /// пользователем/UI, в отличие от внутреннего вызова из [_handleExit] при ретрае без хуков.
  Future<void> connect() => _connect();

  Future<void> _connect({bool isRetry = false}) async {
    if (_disposed || _connecting) return;
    _connecting = true;
    try {
      if (!isRetry) {
        _hookRetriedThisCycle = false;
        _hooksForThisAttempt = hooksEnabled;
      }
      if (!_status.isClosed) {
        _status.add(const TabStatusEvent(TabConnectionStatus.connecting));
      }

      final remoteCommand = RemoteShellHooks.buildRemoteInitCommand(
        persistence: persistence,
        sessionName: sessionName,
        hooks: _hooksForThisAttempt,
        socketName: socketName,
        startDir: persistence == 'tmux' ? startDir : null,
      );

      final ShellSession session;
      try {
        session = await ShellSession.start(
          clientSource: clientSource,
          remoteCommand: remoteCommand,
          cols: _cols,
          rows: _rows,
        );
      } catch (error) {
        if (!_status.isClosed) {
          _status.add(TabStatusEvent(TabConnectionStatus.error, error: error));
        }
        return;
      }

      if (_disposed) {
        session.close();
        return;
      }

      _session = session;
      final oscTap = OscTap(
        onCwdChange: onCwdChange,
        onBusyChange: onBusyChange,
        onClipboardWrite: onClipboardWrite,
      );
      _outputSub = oscTap
          .attach(session.output)
          .listen(_outputController.add, onError: _outputController.addError);

      _everConnected = true;
      _connectedAt = DateTime.now();
      final hooksForThisAttempt = _hooksForThisAttempt;

      if (!_status.isClosed) {
        _status.add(const TabStatusEvent(TabConnectionStatus.connected));
      }

      unawaited(
        session.done.then((_) => _handleExit(session, hooksForThisAttempt)),
      );
    } finally {
      _connecting = false;
    }
  }

  Future<void> _handleExit(
    ShellSession session,
    bool hooksWereEnabledForAttempt,
  ) async {
    // Устаревший колбэк — эта сессия уже не активна (мы сами закрыли её в close()/dispose(),
    // либо уже успели переподключиться на новую): игнорируем, статус уже отражён вызывающей
    // стороной ([close] сам публикует [TabConnectionStatus.detached]).
    if (_session != session) return;

    final exitCode = session.exitCode;
    await _outputSub?.cancel();
    _outputSub = null;
    _session = null;

    if (_disposed) return;

    if (persistence == 'tmux' && _everConnected && exitCode == 0) {
      if (!_status.isClosed) {
        _status.add(const TabStatusEvent(TabConnectionStatus.intercepted));
      }
      return;
    }

    final failedFast =
        exitCode != 0 &&
        _connectedAt != null &&
        DateTime.now().difference(_connectedAt!) <
            const Duration(milliseconds: hookFailFastMs);

    if (hooksWereEnabledForAttempt && failedFast && !_hookRetriedThisCycle) {
      _hookRetriedThisCycle = true;
      _hooksForThisAttempt = false;
      await _connect(isRetry: true);
      return;
    }

    if (!_status.isClosed) {
      _status.add(
        TabStatusEvent(TabConnectionStatus.error, exitCode: exitCode),
      );
    }
  }

  /// Пишет пользовательский ввод в PTY — молча теряется, если сейчас нет активного канала (нет
  /// смысла буферизовать нажатия отключённой вкладки).
  void write(Uint8List data) => _session?.write(data);

  /// Сообщает новый размер терминала; запоминается и для следующего [connect], даже если сейчас
  /// нет активного канала (пересозданная после реаттача сессия должна открыться уже нужного размера).
  void resize(int cols, int rows) {
    _cols = cols;
    _rows = rows;
    _session?.resize(cols, rows);
  }

  /// Детач: закрывает канал, НЕ убивая tmux-сессию на сервере (REQ-11) — свёртывание приложения
  /// или закрытие вкладки пользователем. Переподключение — обычный [connect]; на tmux-вкладке
  /// `new-session -A -D` реаттачит к той же серверной сессии по [sessionName].
  Future<void> close() async {
    await _outputSub?.cancel();
    _outputSub = null;
    final session = _session;
    _session = null;
    session?.close();
    if (!_status.isClosed) {
      _status.add(const TabStatusEvent(TabConnectionStatus.detached));
    }
  }

  /// Окончательное закрытие — вкладка удаляется, повторный [connect] после этого не сработает.
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await _outputSub?.cancel();
    _session?.close();
    _session = null;
    await _status.close();
    await _outputController.close();
  }
}
