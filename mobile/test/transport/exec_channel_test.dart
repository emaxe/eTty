import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dartssh2/dartssh2.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/transport/exec_channel.dart';
import 'package:mobile/transport/ssh_connection.dart';
import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';

import 'exec_channel_test.mocks.dart';

// dart run build_runner build --delete-conflicting-outputs (после правки этого файла)
// генерирует exec_channel_test.mocks.dart — не редактировать вручную, не коммитить в lib/.
@GenerateNiceMocks([MockSpec<SSHClient>(), MockSpec<SSHSession>()])
class _FakeClientSource implements SshClientSource {
  _FakeClientSource(this.client);

  @override
  final SSHClient client;
}

Uint8List _bytes(String s) => Uint8List.fromList(utf8.encode(s));

void main() {
  group('Semaphore', () {
    test('не более max одновременно выполняющихся задач', () async {
      final semaphore = Semaphore(2);
      var active = 0;
      var maxObservedActive = 0;

      Future<void> task() async {
        await semaphore.run(() async {
          active++;
          maxObservedActive = active > maxObservedActive ? active : maxObservedActive;
          await Future<void>.delayed(const Duration(milliseconds: 30));
          active--;
        });
      }

      await Future.wait([task(), task(), task(), task(), task()]);

      expect(maxObservedActive, lessThanOrEqualTo(2));
    });

    test('FIFO: задачи выполняются в порядке постановки в очередь', () async {
      final semaphore = Semaphore(1);
      final order = <int>[];

      Future<void> task(int id) => semaphore.run(() async {
            order.add(id);
            await Future<void>.delayed(const Duration(milliseconds: 5));
          });

      final futures = [for (var i = 0; i < 5; i++) task(i)];
      // Небольшая пауза, чтобы все вызовы run() успели встать в очередь ДО завершения первой
      // задачи (иначе порядок постановки в очередь не гарантирован таймингом теста).
      await Future.wait(futures);

      expect(order, [0, 1, 2, 3, 4]);
    });

    test('updateLimit(): увеличение лимита сразу пробуждает ожидающих', () async {
      final semaphore = Semaphore(1);
      final started = <int>[];
      final blockers = <Completer<void>>[];

      Future<void> task(int id) => semaphore.run(() async {
            started.add(id);
            final c = Completer<void>();
            blockers.add(c);
            await c.future;
          });

      final f1 = task(0);
      await Future<void>.delayed(const Duration(milliseconds: 10));
      final f2 = task(1); // ждёт в очереди — лимит 1, задача 0 ещё активна
      await Future<void>.delayed(const Duration(milliseconds: 10));

      expect(started, [0]);

      semaphore.updateLimit(2);
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(started, [0, 1]);

      blockers[0].complete();
      blockers[1].complete();
      await Future.wait([f1, f2]);
    });
  });

  group('ExecChannel.exec()', () {
    late MockSSHClient client;
    late MockSSHSession session;
    late ExecChannel channel;

    setUp(() {
      client = MockSSHClient();
      session = MockSSHSession();
      channel = ExecChannel(clientSource: _FakeClientSource(client));
    });

    // В реальном dartssh2 `SSHSession.done` — это `_channel.done`, которое завершается ПОСЛЕ
    // того, как по каналу пришли все данные stdout/stderr (порядок SSH-сообщений: данные →
    // exit-status → channel-close). Наивный `Future.value()` в моке этот инвариант не
    // воспроизводит и создаёт гонку с ещё не доставленными чанками — поэтому здесь `done`
    // явно завязан на исчерпание потоков (broadcast, чтобы у стрима было два слушателя: сам
    // ExecChannel и это ожидание).
    void wireSession({
      Stream<Uint8List>? stdout,
      Stream<Uint8List>? stderr,
      int? exitCode,
    }) {
      final stdoutStream = (stdout ?? const Stream<Uint8List>.empty()).asBroadcastStream();
      final stderrStream = (stderr ?? const Stream<Uint8List>.empty()).asBroadcastStream();
      when(client.execute(any)).thenAnswer((_) async => session);
      when(session.stdout).thenAnswer((_) => stdoutStream);
      when(session.stderr).thenAnswer((_) => stderrStream);
      when(session.stdin).thenReturn(StreamController<Uint8List>().sink);
      when(session.exitCode).thenReturn(exitCode);
      when(session.exitSignal).thenReturn(null);
      when(session.done).thenAnswer(
        (_) => Future.wait([stdoutStream.drain<void>(), stderrStream.drain<void>()]),
      );
    }

    test('собирает stdout/stderr и возвращает exitCode', () async {
      wireSession(
        stdout: Stream.fromIterable([_bytes('hello '), _bytes('world')]),
        stderr: Stream.fromIterable([_bytes('warn')]),
        exitCode: 0,
      );

      final result = await channel.exec('echo hi', ['a', 'b']);

      expect(utf8.decode(result.stdout), 'hello world');
      expect(utf8.decode(result.stderr), 'warn');
      expect(result.exitCode, 0);
      expect(result.succeeded, isTrue);
      expect(result.timedOut, isFalse);
      expect(result.error, isNull);
    });

    test('квотирует script/args в единую команду для execute()', () async {
      wireSession(exitCode: 0);

      await channel.exec('echo "\$1"', ["it's a test"]);

      final captured = verify(client.execute(captureAny)).captured.single as String;
      expect(captured, "'/bin/sh' '-c' 'echo \"\$1\"' 'etty' 'it'\\''s a test'");
    });

    test('ненулевой exitCode — не succeeded, но и не error', () async {
      wireSession(exitCode: 13);

      final result = await channel.exec('exit 13', []);

      expect(result.exitCode, 13);
      expect(result.error, isNull);
      expect(result.succeeded, isFalse);
    });

    test('maxBuffer: данные сверх лимита отбрасываются, но не ломают выполнение', () async {
      wireSession(
        stdout: Stream.fromIterable([_bytes('a' * 10), _bytes('b' * 10), _bytes('c' * 10)]),
        exitCode: 0,
      );

      final result = await channel.exec('big-output', [], maxBufferBytes: 15);

      expect(result.stdout.length, lessThanOrEqualTo(15 + 9), reason: 'может захватить один чанк целиком до проверки, но не больше одного лишнего чанка');
      expect(result.error, isNull);
    });

    test('таймаут: session.close() вызывается, timedOut=true', () async {
      // done зависит от close() — как в реальном SSHSession (close() → канал закрывается →
      // _channel.done завершается). Без этой связи тест не сможет отличить «done завис
      // навсегда» от «ExecChannel правильно среагировал на таймаут».
      final closeCompleter = Completer<void>();
      when(client.execute(any)).thenAnswer((_) async => session);
      when(session.stdout).thenAnswer((_) => const Stream<Uint8List>.empty());
      when(session.stderr).thenAnswer((_) => const Stream<Uint8List>.empty());
      when(session.stdin).thenReturn(StreamController<Uint8List>().sink);
      when(session.exitCode).thenReturn(null);
      when(session.exitSignal).thenReturn(null);
      when(session.done).thenAnswer((_) => closeCompleter.future);
      when(session.close()).thenAnswer((_) {
        if (!closeCompleter.isCompleted) closeCompleter.complete();
      });

      final result = await channel.exec(
        'sleep 100',
        [],
        timeout: const Duration(milliseconds: 20),
      );

      expect(result.timedOut, isTrue);
      verify(session.close()).called(1);
    });

    test('client.execute() бросает — возвращается error, не исключение', () async {
      when(client.execute(any)).thenThrow(Exception('channel open failed'));

      final result = await channel.exec('script', []);

      expect(result.error, isNotNull);
      expect(result.succeeded, isFalse);
    });

    test('stdin передаётся и закрывается', () async {
      final sinkController = StreamController<Uint8List>();
      final written = <int>[];
      sinkController.stream.listen(written.addAll);

      when(client.execute(any)).thenAnswer((_) async => session);
      when(session.stdout).thenAnswer((_) => const Stream<Uint8List>.empty());
      when(session.stderr).thenAnswer((_) => const Stream<Uint8List>.empty());
      when(session.stdin).thenReturn(sinkController.sink);
      when(session.exitCode).thenReturn(0);
      when(session.exitSignal).thenReturn(null);
      when(session.done).thenAnswer((_) async {
        await sinkController.close();
      });

      await channel.exec('cat', [], stdin: _bytes('payload'));

      expect(utf8.decode(written), 'payload');
    });

    test('не более maxConcurrent одновременных exec() на одном канале', () async {
      final limitedChannel = ExecChannel(clientSource: _FakeClientSource(client), maxConcurrent: 2);
      var active = 0;
      var maxActive = 0;
      final gate = Completer<void>();

      when(client.execute(any)).thenAnswer((_) async {
        active++;
        maxActive = active > maxActive ? active : maxActive;
        await gate.future;
        active--;
        return session;
      });
      when(session.stdout).thenAnswer((_) => const Stream<Uint8List>.empty());
      when(session.stderr).thenAnswer((_) => const Stream<Uint8List>.empty());
      when(session.stdin).thenReturn(StreamController<Uint8List>().sink);
      when(session.exitCode).thenReturn(0);
      when(session.exitSignal).thenReturn(null);
      when(session.done).thenAnswer((_) async {});

      final futures = [for (var i = 0; i < 5; i++) limitedChannel.exec('cmd$i', [])];
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(maxActive, lessThanOrEqualTo(2));
      gate.complete();
      await Future.wait(futures);
    });
  });
}
