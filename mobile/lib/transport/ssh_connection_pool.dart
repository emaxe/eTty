// Пул подключений ([PoolableConnection], на практике — SshConnection) по connectionId — аналог
// SshConnectionMaster + SshConnectionMasterRegistry с десктопа (src/main/ssh/ssh-connection-master.js,
// ssh-connection-master-registry.js), но БЕЗ разделения на «служебный мастер» и «мастер вкладки»:
// на мобилке один SSHClient обслуживает и вкладки, и служебные операции (см. таблицу «Замена
// ControlMaster» в docs/plans/mob/plan.md). Пул работает через интерфейс [PoolableConnection], а
// не напрямую через SshConnection — это даёт тестам (`ssh_connection_pool_test.dart`)
// детерминированный фейк вместо реального сетевого коннекта.
//
// Держатели рефа: каждая открытая вкладка (ShellSession, задача #14), открытая панель tmux-сессий,
// активный FS-watcher — все вызывают acquire()/release() симметрично.

import 'dart:async';

import 'package:mobile/core/config/ssh_session_config.dart';
import 'package:mobile/transport/ssh_connection.dart';

/// Бросается [SshConnectionPool.acquire], когда предыдущая попытка подключения недавно
/// провалилась и ещё действует cooldown (не долбить сервер паролем/ключом — `MaxAuthTries`/
/// fail2ban реагируют на частые неудачные попытки). `force: true` в [SshConnectionPool.acquire]
/// игнорирует cooldown (явное действие пользователя — например, кнопка «Повторить»).
class SshPoolCooldownException implements Exception {
  const SshPoolCooldownException(this.connectionId, this.cooldownUntil);

  final String connectionId;
  final DateTime cooldownUntil;

  @override
  String toString() =>
      'SshPoolCooldownException($connectionId, until: $cooldownUntil)';
}

/// Строит НОВЫЙ (ещё не подключённый) [PoolableConnection] для `connectionId` — вызывается пулом при
/// первом `acquire()` и при каждой повторной попытке после провала/закрытия (см. докстринг
/// [PoolableConnection] — объект не переиспользуется между попытками).
typedef SshConnectionFactory = PoolableConnection Function();

class _PooledEntry {
  PoolableConnection? connection;
  int refCount = 0;
  Timer? idleTimer;
  DateTime? cooldownUntil;

  /// Не-null, пока идёт (или ожидается кем-то ещё) попытка подключения — single-flight: все
  /// конкурентные `acquire()` для одного и того же `connectionId` разделяют один и тот же
  /// Future вместо параллельных попыток коннекта.
  Future<PoolableConnection>? connectingFuture;
}

/// Пул `PoolableConnection` по `connectionId`. Не хранит сами учётные данные/хост — это дело
/// [SshConnectionFactory], которую вызывающая сторона (Riverpod-провайдер, задача #29) строит
/// из профиля подключения.
class SshConnectionPool {
  SshConnectionPool({
    this.idleDisposeDuration =
        const Duration(milliseconds: SshSessionConfig.masterIdleDisposeMs),
    this.failureCooldown =
        const Duration(milliseconds: SshSessionConfig.masterFailureCooldownMs),
  });

  final Duration idleDisposeDuration;
  final Duration failureCooldown;

  final Map<String, _PooledEntry> _entries = {};

  /// Возвращает живой [PoolableConnection] для `connectionId` — переиспользует уже готовый, ждёт
  /// уже идущую попытку (single-flight) или запускает новую через [factory]. Увеличивает
  /// refcount ТОЛЬКО при успехе — неудачная попытка не оставляет «висящих» держателей.
  ///
  /// Бросает [SshPoolCooldownException], если недавняя попытка провалилась и `force` не
  /// передан; исключение [PoolableConnection.connect] (см. [SshConnectException]) — если сама
  /// попытка подключения не удалась.
  Future<PoolableConnection> acquire(
    String connectionId,
    SshConnectionFactory factory, {
    bool force = false,
  }) async {
    final entry = _entries.putIfAbsent(connectionId, () => _PooledEntry());
    entry.idleTimer?.cancel();
    entry.idleTimer = null;

    final existing = entry.connection;
    if (existing != null && existing.state == SshConnectionState.ready) {
      entry.refCount++;
      return existing;
    }

    final cooldownUntil = entry.cooldownUntil;
    if (!force && cooldownUntil != null && DateTime.now().isBefore(cooldownUntil)) {
      throw SshPoolCooldownException(connectionId, cooldownUntil);
    }

    entry.connectingFuture ??= _connectAndStore(entry, factory);
    final future = entry.connectingFuture!;
    try {
      final connection = await future;
      entry.refCount++;
      return connection;
    } finally {
      // Чужой (более новый) connectingFuture — от параллельного acquire(force:true) после
      // cooldown, например — не затираем.
      if (identical(entry.connectingFuture, future)) {
        entry.connectingFuture = null;
      }
    }
  }

  Future<PoolableConnection> _connectAndStore(_PooledEntry entry, SshConnectionFactory factory) async {
    final connection = factory();
    entry.connection = connection;
    try {
      await connection.connect();
      entry.cooldownUntil = null;
      return connection;
    } catch (_) {
      entry.connection = null;
      entry.cooldownUntil = DateTime.now().add(failureCooldown);
      rethrow;
    }
  }

  /// Отпускает один держатель. При обнулении refcount запускает idle-dispose таймер — не
  /// закрывает соединение немедленно (следующий `acquire()` в течение таймера отменяет его и
  /// переиспользует живое соединение — например, быстрое переключение вкладок).
  void release(String connectionId) {
    final entry = _entries[connectionId];
    if (entry == null || entry.refCount == 0) return;
    entry.refCount--;
    if (entry.refCount == 0) {
      entry.idleTimer = Timer(idleDisposeDuration, () => _disposeEntry(connectionId));
    }
  }

  /// Принудительно закрывает и удаляет запись немедленно (игнорируя refcount) — используется,
  /// когда пользователь удаляет профиль подключения или явно жмёт «Отключить».
  void disposeConnection(String connectionId) {
    _disposeEntry(connectionId);
  }

  void disposeAll() {
    for (final connectionId in _entries.keys.toList()) {
      _disposeEntry(connectionId);
    }
  }

  void _disposeEntry(String connectionId) {
    final entry = _entries.remove(connectionId);
    entry?.idleTimer?.cancel();
    entry?.connection?.close();
  }

  /// Только для отладки/тестов — сколько держателей у соединения сейчас.
  int refCountFor(String connectionId) => _entries[connectionId]?.refCount ?? 0;

  SshConnectionState? stateFor(String connectionId) => _entries[connectionId]?.connection?.state;
}
