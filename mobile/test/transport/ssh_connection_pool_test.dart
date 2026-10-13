import 'dart:async';

import 'package:dartssh2/dartssh2.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/transport/ssh_connection.dart';
import 'package:mobile/transport/ssh_connection_pool.dart';

/// Детерминированный фейк [PoolableConnection] — управляемый вручную `connect()` (через
/// [connectGate]) вместо реального сетевого тайминга. `client` не используется тестами пула
/// (только `ExecChannel`/`ShellSession` его читают), поэтому не реализован (бросает).
class _FakeConnection implements PoolableConnection {
  _FakeConnection({this.failWith});

  /// Если задано — `connect()` бросает это исключение вместо перехода в ready.
  final Object? failWith;

  /// Тест управляет тем, КОГДА connect() «завершится» — незавершённый Completer имитирует
  /// «подключение ещё идёт», нужен для проверки single-flight.
  final connectGate = Completer<void>();

  var connectCallCount = 0;
  var closeCallCount = 0;

  @override
  SshConnectionState state = SshConnectionState.idle;

  @override
  Future<void> connect() async {
    connectCallCount++;
    state = SshConnectionState.connecting;
    await connectGate.future;
    if (failWith != null) {
      state = SshConnectionState.failed;
      throw failWith!;
    }
    state = SshConnectionState.ready;
  }

  @override
  void close() {
    closeCallCount++;
    state = SshConnectionState.closed;
  }

  @override
  SSHClient get client => throw UnimplementedError('не нужен тестам пула');
}

void main() {
  group('SshConnectionPool.acquire()', () {
    test('успешный connect() — refcount становится 1, состояние ready', () async {
      final pool = SshConnectionPool();
      final fake = _FakeConnection();
      fake.connectGate.complete();

      final connection = await pool.acquire('c1', () => fake);

      expect(connection, same(fake));
      expect(pool.refCountFor('c1'), 1);
      expect(pool.stateFor('c1'), SshConnectionState.ready);
    });

    test(
      'повторный acquire() для готового соединения переиспользует его без нового connect()',
      () async {
        final pool = SshConnectionPool();
        final fake = _FakeConnection();
        fake.connectGate.complete();

        await pool.acquire('c1', () => fake);
        final second = await pool.acquire('c1', () => fake);

        expect(second, same(fake));
        expect(fake.connectCallCount, 1, reason: 'connect() не должен вызываться повторно');
        expect(pool.refCountFor('c1'), 2);
      },
    );

    test(
      'single-flight: конкурентные acquire() для одного connectionId делят один connect()',
      () async {
        final pool = SshConnectionPool();
        var factoryCallCount = 0;
        final fake = _FakeConnection();

        final f1 = pool.acquire('c1', () {
          factoryCallCount++;
          return fake;
        });
        final f2 = pool.acquire('c1', () {
          factoryCallCount++;
          return fake;
        });

        fake.connectGate.complete();
        final results = await Future.wait([f1, f2]);

        expect(
          factoryCallCount,
          1,
          reason: 'фабрика должна вызываться один раз на всех конкурентов',
        );
        expect(fake.connectCallCount, 1);
        expect(results[0], same(fake));
        expect(results[1], same(fake));
        expect(pool.refCountFor('c1'), 2, reason: 'оба acquire() должны увеличить refcount');
      },
    );

    test('неудачный connect() НЕ увеличивает refcount', () async {
      final pool = SshConnectionPool();
      final fake = _FakeConnection(failWith: Exception('auth failed'));
      fake.connectGate.complete();

      await expectLater(pool.acquire('c1', () => fake), throwsException);

      expect(pool.refCountFor('c1'), 0);
    });

    test('после провала — cooldown блокирует немедленный повторный acquire()', () async {
      final pool = SshConnectionPool(failureCooldown: const Duration(milliseconds: 200));
      final failing = _FakeConnection(failWith: Exception('auth failed'));
      failing.connectGate.complete();
      await expectLater(pool.acquire('c1', () => failing), throwsException);

      final another = _FakeConnection();
      another.connectGate.complete();
      await expectLater(
        pool.acquire('c1', () => another),
        throwsA(isA<SshPoolCooldownException>()),
      );
      expect(another.connectCallCount, 0, reason: 'фабрика не должна вызываться во время cooldown');
    });

    test('force: true игнорирует cooldown', () async {
      final pool = SshConnectionPool(failureCooldown: const Duration(seconds: 30));
      final failing = _FakeConnection(failWith: Exception('auth failed'));
      failing.connectGate.complete();
      await expectLater(pool.acquire('c1', () => failing), throwsException);

      final retry = _FakeConnection();
      retry.connectGate.complete();
      final connection = await pool.acquire('c1', () => retry, force: true);

      expect(connection, same(retry));
      expect(pool.refCountFor('c1'), 1);
    });

    test('cooldown снимается после истечения времени', () async {
      final pool = SshConnectionPool(failureCooldown: const Duration(milliseconds: 30));
      final failing = _FakeConnection(failWith: Exception('auth failed'));
      failing.connectGate.complete();
      await expectLater(pool.acquire('c1', () => failing), throwsException);

      await Future<void>.delayed(const Duration(milliseconds: 50));

      final retry = _FakeConnection();
      retry.connectGate.complete();
      final connection = await pool.acquire('c1', () => retry);
      expect(connection, same(retry));
    });

    test('разные connectionId управляются независимо', () async {
      final pool = SshConnectionPool();
      final fakeA = _FakeConnection();
      final fakeB = _FakeConnection();
      fakeA.connectGate.complete();
      fakeB.connectGate.complete();

      await pool.acquire('a', () => fakeA);
      await pool.acquire('b', () => fakeB);

      expect(pool.refCountFor('a'), 1);
      expect(pool.refCountFor('b'), 1);
    });
  });

  group('SshConnectionPool.release()', () {
    test('release() до нуля запускает idle-dispose, соединение закрывается по таймеру', () async {
      final pool = SshConnectionPool(idleDisposeDuration: const Duration(milliseconds: 30));
      final fake = _FakeConnection();
      fake.connectGate.complete();

      await pool.acquire('c1', () => fake);
      pool.release('c1');

      expect(fake.closeCallCount, 0, reason: 'сразу после release() соединение ещё не закрыто');
      await Future<void>.delayed(const Duration(milliseconds: 60));
      expect(fake.closeCallCount, 1);
    });

    test(
      'acquire() до истечения idle-таймера отменяет dispose и переиспользует соединение',
      () async {
        final pool = SshConnectionPool(idleDisposeDuration: const Duration(milliseconds: 50));
        final fake = _FakeConnection();
        fake.connectGate.complete();

        await pool.acquire('c1', () => fake);
        pool.release('c1');
        await Future<void>.delayed(const Duration(milliseconds: 10));
        final reused = await pool.acquire('c1', () => fake);

        await Future<void>.delayed(const Duration(milliseconds: 60));

        expect(reused, same(fake));
        expect(
          fake.closeCallCount,
          0,
          reason: 'idle-таймер должен был отмениться повторным acquire()',
        );
      },
    );

    test('release() без предшествующего acquire() безопасен (нет записи)', () {
      final pool = SshConnectionPool();
      expect(() => pool.release('unknown'), returnsNormally);
    });

    test('release() лишний раз (refcount уже 0) не уходит в отрицательные значения', () async {
      final pool = SshConnectionPool(idleDisposeDuration: const Duration(seconds: 30));
      final fake = _FakeConnection();
      fake.connectGate.complete();

      await pool.acquire('c1', () => fake);
      pool.release('c1');
      pool.release('c1'); // лишний вызов

      expect(pool.refCountFor('c1'), 0);
    });
  });

  group('SshConnectionPool.disposeConnection() / disposeAll()', () {
    test('disposeConnection() закрывает немедленно, игнорируя refcount', () async {
      final pool = SshConnectionPool();
      final fake = _FakeConnection();
      fake.connectGate.complete();

      await pool.acquire('c1', () => fake);
      await pool.acquire('c1', () => fake); // refcount = 2

      pool.disposeConnection('c1');

      expect(fake.closeCallCount, 1);
      expect(pool.refCountFor('c1'), 0);
    });

    test('disposeAll() закрывает все живые соединения', () async {
      final pool = SshConnectionPool();
      final fakeA = _FakeConnection();
      final fakeB = _FakeConnection();
      fakeA.connectGate.complete();
      fakeB.connectGate.complete();

      await pool.acquire('a', () => fakeA);
      await pool.acquire('b', () => fakeB);

      pool.disposeAll();

      expect(fakeA.closeCallCount, 1);
      expect(fakeB.closeCallCount, 1);
    });
  });
}
