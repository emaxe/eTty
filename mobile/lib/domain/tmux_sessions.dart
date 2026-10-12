import 'dart:async';
import 'dart:convert';

import 'package:mobile/core/config/ssh_session_config.dart';
import 'package:mobile/remote/remote_parse.dart';
import 'package:mobile/remote/remote_scripts.dart';
import 'package:mobile/transport/exec_channel.dart';

/// Символическая причина отказа операции над tmux-сессиями — те же коды возврата, что в
/// `ssh-handlers.js` на десктопе (`no-tmux`/`not-found`/`name-taken`/`timeout`), типизированные.
enum TmuxSessionsErrorCode {
  /// exit 127 (`tmuxListSessionsScript`) — tmux не установлен на сервере.
  noTmux,

  /// exit 3 (`tmuxKillSessionScript`/`tmuxRenameSessionScript`) — сессии с таким именем нет.
  notFound,

  /// exit 17 (`tmuxRenameSessionScript`) — целевое имя уже занято.
  nameTaken,

  /// Имя не проходит [SshSessionConfig.sessionNameRe] — проверяется ДО отправки на сервер (та же
  /// валидация на обеих сторонах, что и на десктопе — часть общего инварианта проекта).
  invalidName,

  timeout,
  io,
}

class TmuxSessionsException implements Exception {
  const TmuxSessionsException(this.code, this.message);

  final TmuxSessionsErrorCode code;
  final String message;

  @override
  String toString() => 'TmuxSessionsException(${code.name}): $message';
}

/// Список/kill/rename tmux-сессий на сервере + автополлинг — порт логики из
/// `ssh-handlers.js`/`ssh-panel.js` (десктоп разносит это между main-процессом и renderer, здесь
/// один domain-класс). Никак не связан с конкретной вкладкой — `TabController` (задача #19)
/// использует [list]/[kill]/[rename] точечно, панель сессий сервера (задача #25) подписывается на
/// [onSessionsChanged] для автообновления.
class TmuxSessionsService {
  TmuxSessionsService({
    required this.exec,
    this.socket = SshSessionConfig.defaultSocket,
  });

  final RemoteExec exec;

  /// Сокет tmux-сервера (`-L`); `''` — сокет по умолчанию (совместимость с `tmux ls` пользователя).
  final String socket;

  String _execError(ExecResult result, String fallback) {
    if (result.error != null) return result.error.toString();
    if (result.timedOut) return 'Timed out';
    final stderr = utf8.decode(result.stderr, allowMalformed: true).trim();
    return stderr.isNotEmpty ? stderr : '$fallback (exit ${result.exitCode})';
  }

  void _validateName(String name, String label) {
    if (!SshSessionConfig.sessionNameRe.hasMatch(name)) {
      throw TmuxSessionsException(
        TmuxSessionsErrorCode.invalidName,
        'Invalid session $label: $name',
      );
    }
  }

  Future<List<TmuxSessionInfo>>? _inFlightList;

  /// Список сессий сокета [socket] — включая созданные не через eTty (REQ-15). Совмещает
  /// параллельные вызовы в один exec (та же идея, что `force`-флаг на десктопе избегает лишних
  /// запросов, только тут неявно: пока первый вызов не завершился, второй получает его же Future).
  Future<List<TmuxSessionInfo>> list() {
    return _inFlightList ??= _listOnce().whenComplete(
      () => _inFlightList = null,
    );
  }

  Future<List<TmuxSessionInfo>> _listOnce() async {
    final result = await exec.exec(
      RemoteScripts.tmuxListSessionsScript,
      [socket],
      timeout: const Duration(
        milliseconds: SshSessionConfig.sessionsOpTimeoutMs,
      ),
    );
    if (result.exitCode == 127) {
      throw const TmuxSessionsException(
        TmuxSessionsErrorCode.noTmux,
        'tmux is not installed',
      );
    }
    if (result.timedOut) {
      throw const TmuxSessionsException(
        TmuxSessionsErrorCode.timeout,
        'Timed out',
      );
    }
    if (result.exitCode != 0) {
      throw TmuxSessionsException(
        TmuxSessionsErrorCode.io,
        _execError(result, 'list sessions failed'),
      );
    }
    return parseTmuxSessions(result.stdout);
  }

  Future<void> kill(String name) async {
    _validateName(name, 'name');
    final result = await exec.exec(
      RemoteScripts.tmuxKillSessionScript,
      [socket, name],
      timeout: const Duration(
        milliseconds: SshSessionConfig.sessionsOpTimeoutMs,
      ),
    );
    if (result.exitCode == 3) {
      throw const TmuxSessionsException(
        TmuxSessionsErrorCode.notFound,
        'Session not found',
      );
    }
    if (result.exitCode != 0) {
      throw TmuxSessionsException(
        TmuxSessionsErrorCode.io,
        _execError(result, 'kill session failed'),
      );
    }
  }

  Future<void> rename(String name, String newName) async {
    _validateName(name, 'name');
    _validateName(newName, 'newName');
    final result = await exec.exec(
      RemoteScripts.tmuxRenameSessionScript,
      [socket, name, newName],
      timeout: const Duration(
        milliseconds: SshSessionConfig.sessionsOpTimeoutMs,
      ),
    );
    if (result.exitCode == 3) {
      throw const TmuxSessionsException(
        TmuxSessionsErrorCode.notFound,
        'Session not found',
      );
    }
    if (result.exitCode == 17) {
      throw const TmuxSessionsException(
        TmuxSessionsErrorCode.nameTaken,
        'Name already taken',
      );
    }
    if (result.exitCode != 0) {
      throw TmuxSessionsException(
        TmuxSessionsErrorCode.io,
        _execError(result, 'rename session failed'),
      );
    }
  }

  // --- Автополлинг (REQ-15) ---

  Timer? _pollTimer;
  Timer? _refreshDebounce;
  final StreamController<List<TmuxSessionInfo>> _controller =
      StreamController.broadcast();

  /// Снимок списка на каждый успешный цикл опроса (полный релист, без дифа — как
  /// `_refreshExpandedSessions` на десктопе); ошибки цикла (`no-tmux`/`timeout`/...) идут через
  /// [Stream.addError] на этом же стриме.
  Stream<List<TmuxSessionInfo>> get onSessionsChanged => _controller.stream;

  void startPolling() {
    _pollTimer ??= Timer.periodic(
      const Duration(milliseconds: SshSessionConfig.sessionsPollMs),
      (_) => _pollOnce(),
    );
  }

  void stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
    _refreshDebounce?.cancel();
    _refreshDebounce = null;
  }

  /// Внеочередное обновление по событию вкладки (открытие/закрытие/обрыв tmux-сессии) — порт
  /// `_scheduleSessionsRefresh` на десктопе: дебаунс, серия быстрых вызовов даёт один запрос через
  /// [SshSessionConfig.sessionsRefreshDelayMs] после последнего, а не после каждого.
  void refreshSoon() {
    _refreshDebounce?.cancel();
    _refreshDebounce = Timer(
      const Duration(milliseconds: SshSessionConfig.sessionsRefreshDelayMs),
      _pollOnce,
    );
  }

  Future<void> _pollOnce() async {
    try {
      final sessions = await list();
      if (!_controller.isClosed) _controller.add(sessions);
    } catch (e) {
      if (!_controller.isClosed) _controller.addError(e);
    }
  }

  void dispose() {
    stopPolling();
    _controller.close();
  }
}
