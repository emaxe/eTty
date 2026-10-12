// Короткоживущие non-interactive exec-вызовы поверх SshConnection — аналог
// SshControlChannel.exec() с десктопа (src/main/ssh/ssh-control-channel.js), но без отдельного
// ControlMaster-процесса: на мобилке это просто ещё один канал того же SSHClient (см. таблицу
// «Замена ControlMaster» в docs/plans/mob/plan.md). Используется SshFsProvider/TmuxSessionsService
// (задачи #17/#18) для операций удалённой ФС и tmux-сессий через RemoteScripts.

import 'dart:async';
import 'dart:typed_data';

import 'package:dartssh2/dartssh2.dart';

import 'package:mobile/core/config/ssh_fs_config.dart';
import 'package:mobile/transport/ssh_connection.dart';

/// Результат одного exec-вызова. `exitCode`/`signalName` — `null`, если процесс не завершился
/// штатно (таймаут, обрыв соединения, завершён сигналом без кода).
class ExecResult {
  const ExecResult({
    this.exitCode,
    this.signalName,
    required this.stdout,
    required this.stderr,
    required this.timedOut,
    this.error,
  });

  final int? exitCode;
  final String? signalName;
  final Uint8List stdout;
  final Uint8List stderr;
  final bool timedOut;

  /// Заполнено, если выполнение не удалось технически (обрыв соединения, ошибка открытия
  /// канала) — в отличие от ненулевого [exitCode], который означает, что скрипт ВЫПОЛНИЛСЯ и
  /// сам вернул ошибку (это не [error]).
  final Object? error;

  /// Удобный агрегат для вызывающей стороны: «всё прошло штатно и код возврата — 0».
  bool get succeeded => error == null && !timedOut && exitCode == 0;
}

/// Однопоточный ограничитель параллелизма — порт `Semaphore` из `ssh-control-channel.js`
/// (тот же FIFO-порядок пробуждения, та же семантика `run()`). Лимит можно менять на лету
/// (`updateLimit`) — понадобится `SshConnectionPool`/`ChannelSemaphore` (задача #13) для
/// динамического пересчёта `effectiveLimit` при открытии/закрытии shell-каналов того же
/// подключения (см. риск R7 в plan.md).
class Semaphore {
  Semaphore(this._limit)
    : assert(_limit > 0, 'лимит семафора должен быть положительным');

  int _limit;
  int _active = 0;
  final _queue = <Completer<void>>[];

  void updateLimit(int newLimit) {
    assert(newLimit > 0, 'лимит семафора должен быть положительным');
    _limit = newLimit;
    _drainQueue();
  }

  void _drainQueue() {
    while (_active < _limit && _queue.isNotEmpty) {
      _active++;
      _queue.removeAt(0).complete();
    }
  }

  Future<T> run<T>(Future<T> Function() task) async {
    if (_active >= _limit) {
      final completer = Completer<void>();
      _queue.add(completer);
      await completer.future;
    } else {
      _active++;
    }
    try {
      return await task();
    } finally {
      _active--;
      _drainQueue();
    }
  }
}

/// Экранирование ОДНОГО argv-токена одинарными кавычками — порт `posixQuote()` из
/// `ssh-control-channel.js`. НЕ путать с `remote/posix_quote.dart` (`posixDquote`,
/// double-quote-экранирование для L1-уровня `RemoteShellHooks`) — разные механизмы для разных
/// уровней протокола. Нужен здесь, потому что `dartssh2.execute(cmd)` отправляет `cmd` ОДНОЙ
/// строкой, которую sshd передаёт как `<login-shell> -c "<cmd>"`: если токены скрипта/аргументов
/// не квотированы по отдельности, пробелы/`;` внутри них будут разобраны внешним shell как
/// границы слов.
String _posixQuote(String s) => "'${s.replaceAll("'", "'\\''")}'";

/// Шов-интерфейс над короткоживущими exec-вызовами для доменных оркестраторов (`SshFsProvider`,
/// `TmuxSessionsService`, задачи #17/#18) — та же идея, что `SshClientSource`/`PoolableConnection`
/// для транспортного слоя (см. докстринг блока «Зависимости Flutter» в `docs/plans/mob/plan.md`):
/// продакшен-код зависит от интерфейса, тесты подставляют детерминированный фейк вместо реального
/// `ExecChannel`, не трогая сеть.
abstract class RemoteExec {
  Future<ExecResult> exec(
    String script,
    List<String> args, {
    Uint8List? stdin,
    Duration timeout = const Duration(milliseconds: SshFsConfig.opTimeoutMs),
    int maxBufferBytes = SshFsConfig.maxExecBufferBytes,
  });
}

/// Канал коротких non-interactive exec-вызовов на одном [SshConnection], с ограничением
/// параллелизма — порт `SshControlChannel.exec()`. НЕ управляет интерактивным PTY (см.
/// `transport/shell_session.dart`, задача #14) — только служебные вызовы `RemoteScripts`.
class ExecChannel implements RemoteExec {
  ExecChannel({
    required this.clientSource,
    int maxConcurrent = SshFsConfig.maxConcurrentExec,
  }) : _semaphore = Semaphore(maxConcurrent);

  /// В продакшене — живой [SshConnection]; в тестах — фейк с замоканным `SSHClient`
  /// (см. докстринг [SshClientSource]).
  final SshClientSource clientSource;
  final Semaphore _semaphore;

  /// Позволяет пулу (задача #13) динамически урезать/расширять лимит при открытии/закрытии
  /// shell-каналов того же подключения.
  void updateConcurrencyLimit(int newLimit) => _semaphore.updateLimit(newLimit);

  /// Выполняет `/bin/sh -c <script> etty <args...>` на удалённой стороне — данные переданы
  /// ТОЛЬКО как позиционные аргументы (`$1..$N`), скрипт сам никогда не интерполирует их в
  /// текст (см. докстринг `RemoteScripts`). Каждый вызов проходит через семафор — при
  /// превышении лимита ждёт своей очереди (FIFO).
  @override
  Future<ExecResult> exec(
    String script,
    List<String> args, {
    Uint8List? stdin,
    Duration timeout = const Duration(milliseconds: SshFsConfig.opTimeoutMs),
    int maxBufferBytes = SshFsConfig.maxExecBufferBytes,
  }) {
    return _semaphore.run(
      () => _execOnce(
        script,
        args,
        stdin: stdin,
        timeout: timeout,
        maxBufferBytes: maxBufferBytes,
      ),
    );
  }

  Future<ExecResult> _execOnce(
    String script,
    List<String> args, {
    required Uint8List? stdin,
    required Duration timeout,
    required int maxBufferBytes,
  }) async {
    final SSHClient client;
    try {
      client = clientSource.client;
    } catch (error) {
      return ExecResult(
        stdout: Uint8List(0),
        stderr: Uint8List(0),
        timedOut: false,
        error: error,
      );
    }

    final command = _buildCommand(script, args);

    final SSHSession session;
    try {
      session = await client.execute(command);
    } catch (error) {
      return ExecResult(
        stdout: Uint8List(0),
        stderr: Uint8List(0),
        timedOut: false,
        error: error,
      );
    }

    final stdoutBuffer = BytesBuilder(copy: false);
    final stderrBuffer = BytesBuilder(copy: false);

    // Переполнение maxBuffer — не ошибка: перестаём копить, но продолжаем слушать поток (иначе
    // непрочитанные данные создают backpressure на удалённой стороне и процесс может зависнуть
    // в записи), см. тот же приём в ssh-control-channel.js.
    final stdoutSub = session.stdout.listen((chunk) {
      if (stdoutBuffer.length < maxBufferBytes) stdoutBuffer.add(chunk);
    });
    final stderrSub = session.stderr.listen((chunk) {
      if (stderrBuffer.length < maxBufferBytes) stderrBuffer.add(chunk);
    });

    if (stdin != null) {
      session.stdin.add(stdin);
    }
    unawaited(session.stdin.close());

    var timedOut = false;
    final timer = Timer(timeout, () {
      timedOut = true;
      session.close();
    });

    Object? error;
    try {
      await session.done;
    } catch (e) {
      error = e;
    } finally {
      timer.cancel();
    }

    await stdoutSub.cancel();
    await stderrSub.cancel();

    return ExecResult(
      exitCode: session.exitCode,
      signalName: session.exitSignal?.signalName,
      stdout: stdoutBuffer.toBytes(),
      stderr: stderrBuffer.toBytes(),
      timedOut: timedOut,
      error: error,
    );
  }

  String _buildCommand(String script, List<String> args) {
    final tokens = ['/bin/sh', '-c', script, 'etty', ...args];
    return tokens.map(_posixQuote).join(' ');
  }
}
