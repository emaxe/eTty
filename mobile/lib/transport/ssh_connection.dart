// Один SSHClient на подключение — замена OpenSSH ControlMaster с десктопа (см. таблицу
// «Замена ControlMaster» в docs/plans/mob/plan.md). В отличие от десктопа, где вкладка — это
// отдельный процесс ssh, а служебные операции идут по отдельному мультиплексированному каналу,
// здесь и вкладки (transport/shell_session.dart, задача #14), и служебные операции
// (transport/exec_channel.dart, задача #12) — каналы ОДНОГО и того же SSHClient.
//
// Этот класс отвечает только за сам коннект и аутентификацию одного подключения; пул с
// refcount/single-flight/idle-dispose/cooldown — transport/ssh_connection_pool.dart
// (задача #13), состояние в ней per-connectionId, а не только per-объект здесь.

import 'dart:async';
import 'dart:io';

import 'package:dartssh2/dartssh2.dart';

import 'package:mobile/data/known_hosts_store.dart';
import 'package:mobile/transport/host_keys.dart';

/// Учётные данные для аутентификации — REQ-7 (`docs/plans/mob/plan.md`): пароль, приватный
/// ключ (в т.ч. с passphrase), keyboard-interactive. SSH-агента на мобилке нет (`authType:'agent'`
/// профиля с десктопа помечается неподдерживаемым на уровне импорта, задача #32, не здесь).
///
/// Поля не взаимоисключающие: если задан и [password], и [privateKeyPem], `dartssh2` сам
/// выберет метод по тому, что предложит сервер (публичный ключ обычно пробуется первым).
class SshCredentials {
  const SshCredentials({
    this.password,
    this.privateKeyPem,
    this.privateKeyPassphrase,
    this.keyboardInteractivePrompt,
  });

  final String? password;

  /// PEM приватного ключа (может содержать несколько ключей — `SSHKeyPair.fromPem` сам
  /// разбирает).
  final String? privateKeyPem;

  /// Passphrase для [privateKeyPem], если ключ зашифрован. Игнорируется, если [privateKeyPem]
  /// не задан.
  final String? privateKeyPassphrase;

  /// Отвечает на запросы keyboard-interactive сервера (произвольные подсказки — 2FA-код,
  /// смена пароля через PAM и т.п.). `null` — метод keyboard-interactive не предлагается.
  final KeyboardInteractivePrompt? keyboardInteractivePrompt;
}

/// Совместим по форме с `SSHUserInfoRequestHandler` — `null` в ответе означает «пропустить этот
/// метод аутентификации» (см. dartssh2).
typedef KeyboardInteractivePrompt = Future<List<String>?> Function(SSHUserInfoRequest request);

enum SshConnectionState { idle, connecting, ready, failed, closed }

/// Классификация причины неудачного подключения — нужна вызывающей стороне (пул, задача #13)
/// для разного поведения: `authRequired`/`hostKeyRejected` не ретраятся автоматически и не
/// уходят в cooldown-петлю так же, как `unreachable`/`timeout` (см. `SshConnectionMaster` на
/// десктопе, `classifyMasterFailure`, тот же принцип).
enum SshConnectFailureKind { authRequired, hostKeyRejected, unreachable, timeout, other }

class SshConnectException implements Exception {
  const SshConnectException(this.kind, this.message, [this.cause]);

  final SshConnectFailureKind kind;
  final String message;
  final Object? cause;

  @override
  String toString() => 'SshConnectException($kind, $message)';
}

/// Таймаут TCP-подключения (не аутентификации целиком — та может занимать много больше времени
/// на ожидании пользователя при паролe/2FA, отдельного лимита на неё намеренно нет, как и на
/// десктопном ожидании пароля в askpass).
const _kSocketConnectTimeout = Duration(seconds: 15);

/// Дефолт `dartssh2` (10 с) уже подходит для мобильного NAT — не переопределяем без причины
/// (см. спайк S4, `docs/plans/mob/plan.md`).
const _kDefaultKeepAliveInterval = Duration(seconds: 10);

/// Минимальный интерфейс «у меня есть живой `SSHClient`» — [SshConnection] его реализует.
/// Существует отдельно от [SshConnection], чтобы потребители канала (`ExecChannel`,
/// `ShellSession`, задачи #12/#14) зависели от абстракции, а не от конкретного класса с сетевым
/// `connect()`/TOFU-логикой — в частности, это даёт тестам подставлять фейковый источник с
/// замоканным `SSHClient` (`package:mockito`, см. `dart-generate-test-mocks` в
/// `mobile/.agents/skills/`) без реального сетевого подключения.
abstract interface class SshClientSource {
  SSHClient get client;
}

/// Интерфейс, которым [SshConnectionPool] (задача #13) управляет жизненным циклом — `state`/
/// `connect()`/`close()` плюс [SshClientSource.client] для потребителей ниже по стеку. Отдельно
/// от [SshClientSource]: пулу нужно больше, чем просто «дай клиент» — ему нужно самому запускать
/// и завершать жизненный цикл. Существует, чтобы `ssh_connection_pool_test.dart` мог подставить
/// детерминированный фейк вместо реального сетевого `SshConnection.connect()` — тайминги реальной
/// сети (loopback connection-refused и т.п.) не годятся для проверки refcount/single-flight
/// логики, где нужен точный контроль над тем, когда именно `connect()` разрешается/падает.
abstract interface class PoolableConnection implements SshClientSource {
  SshConnectionState get state;
  Future<void> connect();
  void close();
}

/// Один SSH-коннект: TCP-сокет + `SSHClient` + TOFU-верификация host key + аутентификация.
/// Жизненный цикл: `idle` → `connect()` → `connecting` → `ready` либо `failed`; `close()` в
/// любой момент → `closed`. Повторный `connect()` после `failed`/`closed` создаёт всё заново
/// (объект не переиспользуется между попытками с разным состоянием — это тоже забота пула).
class SshConnection implements PoolableConnection {
  SshConnection({
    required this.host,
    required this.port,
    required this.username,
    required SshCredentials credentials,
    required KnownHostsStore knownHostsStore,
    required TrustNewHostKeyPrompt onNewHostKey,
    Duration keepAliveInterval = _kDefaultKeepAliveInterval,
    // Поля ниже намеренно private (не `this.xxx`): `credentials` несёт пароль/приватный ключ и
    // не должен быть читаем извне через публичное поле — lint `prefer_initializing_formals`
    // здесь сознательно проигнорирован ради инкапсуляции секретов.
  })  : _credentials = credentials, // ignore: prefer_initializing_formals
        _knownHostsStore = knownHostsStore, // ignore: prefer_initializing_formals
        _onNewHostKey = onNewHostKey, // ignore: prefer_initializing_formals
        _keepAliveInterval = keepAliveInterval; // ignore: prefer_initializing_formals

  final String host;
  final int port;
  final String username;

  final SshCredentials _credentials;
  final KnownHostsStore _knownHostsStore;
  final TrustNewHostKeyPrompt _onNewHostKey;
  final Duration _keepAliveInterval;

  SshConnectionState _state = SshConnectionState.idle;
  @override
  SshConnectionState get state => _state;

  SSHSocket? _socket;
  SSHClient? _client;

  /// Живой `SSHClient` — доступен только в состоянии [SshConnectionState.ready]. Используется
  /// `ExecChannel`/`ShellSession` (задачи #12/#14) для открытия каналов.
  @override
  SSHClient get client {
    final c = _client;
    if (c == null || _state != SshConnectionState.ready) {
      throw StateError('SshConnection.client недоступен в состоянии $_state');
    }
    return c;
  }

  /// Завершается, когда транспорт закрывается — штатно или по обрыву. `StateError`, если
  /// [connect] ещё не вызывался успешно.
  Future<void> get done {
    final c = _client;
    if (c == null) {
      throw StateError('SshConnection.done недоступен до успешного connect()');
    }
    return c.done;
  }

  /// Подключается и аутентифицируется. Бросает [SshConnectException] при неудаче — [state]
  /// переходит в [SshConnectionState.failed], объект после этого не пригоден для повторного
  /// `connect()` (создавайте новый — решение о ретрае/cooldown принимает пул, задача #13).
  @override
  Future<void> connect() async {
    if (_state != SshConnectionState.idle) {
      throw StateError('connect() можно вызвать только из состояния idle, сейчас $_state');
    }
    _state = SshConnectionState.connecting;

    try {
      _socket = await SSHSocket.connect(host, port, timeout: _kSocketConnectTimeout);

      final hostKeyVerifier = HostKeyVerifier(
        store: _knownHostsStore,
        host: host,
        port: port,
        onNewHostKey: _onNewHostKey,
      );

      List<SSHIdentity>? identities;
      if (_credentials.privateKeyPem != null) {
        identities = SSHKeyPair.fromPem(
          _credentials.privateKeyPem!,
          _credentials.privateKeyPassphrase,
        );
      }

      _client = SSHClient(
        _socket!,
        username: username,
        identities: identities,
        onPasswordRequest:
            _credentials.password != null ? () => _credentials.password : null,
        onUserInfoRequest: _credentials.keyboardInteractivePrompt,
        onVerifyHostKey: hostKeyVerifier.call,
        keepAliveInterval: _keepAliveInterval,
      );

      await _client!.authenticated;
      _state = SshConnectionState.ready;
    } catch (error) {
      _state = SshConnectionState.failed;
      _socket = null;
      _client = null;
      throw _classify(error);
    }
  }

  /// Классификация проверена вживую (`spikes/probe_refused.dart`, не мержится): `SSHSocket.connect`
  /// на отказ TCP-уровня (connection refused / timeout / DNS lookup failed) бросает
  /// `dart:io`-й `SocketException` НАПРЯМУЮ, а не `SSHSocketError` из dartssh2 — та оборачивает
  /// только ошибки сокета ПОСЛЕ установления соединения (во время протокольного обмена). Матчим
  /// по `.message`, не по `osError.errorCode`: коды errno платформо-зависимы (Linux/macOS/iOS/
  /// Android дают разные числа для одной и той же причины), текст сообщения — нет.
  SshConnectException _classify(Object error) {
    if (error is SSHAuthError) {
      return SshConnectException(SshConnectFailureKind.authRequired, error.message, error);
    }
    if (error is SSHHostkeyError) {
      return SshConnectException(SshConnectFailureKind.hostKeyRejected, error.message, error);
    }
    if (error is SocketException) {
      final message = error.message.toLowerCase();
      final isTimeout = message.contains('timed out') || message.contains('timeout');
      return SshConnectException(
        isTimeout ? SshConnectFailureKind.timeout : SshConnectFailureKind.unreachable,
        error.message,
        error,
      );
    }
    if (error is TimeoutException) {
      return SshConnectException(SshConnectFailureKind.timeout, error.toString(), error);
    }
    if (error is SSHSocketError) {
      return SshConnectException(
        SshConnectFailureKind.unreachable,
        error.error.toString(),
        error,
      );
    }
    return SshConnectException(SshConnectFailureKind.other, error.toString(), error);
  }

  /// Закрывает транспорт. Идемпотентен — повторный вызов ничего не делает.
  @override
  void close() {
    if (_state == SshConnectionState.closed) return;
    _state = SshConnectionState.closed;
    _client?.close();
    _client = null;
    _socket = null;
  }
}
