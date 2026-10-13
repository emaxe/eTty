import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dartssh2/dartssh2.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/transport/shell_session.dart';
import 'package:mobile/transport/ssh_connection.dart';
import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';

import 'shell_session_test.mocks.dart';

// dart run build_runner build (после правки этого файла) генерирует shell_session_test.mocks.dart.
@GenerateNiceMocks([MockSpec<SSHClient>(), MockSpec<SSHSession>()])
class _FakeClientSource implements SshClientSource {
  _FakeClientSource(this.client);

  @override
  final SSHClient client;
}

Uint8List _bytes(String s) => Uint8List.fromList(utf8.encode(s));

void main() {
  group('ShellSession.start()', () {
    test('вызывает execute() с PTY и заданными cols/rows', () async {
      final client = MockSSHClient();
      final session = MockSSHSession();
      when(client.execute(any, pty: anyNamed('pty'))).thenAnswer((_) async => session);
      when(session.stdout).thenAnswer((_) => const Stream<Uint8List>.empty());
      when(session.stderr).thenAnswer((_) => const Stream<Uint8List>.empty());

      await ShellSession.start(
        clientSource: _FakeClientSource(client),
        remoteCommand: 'exec /bin/sh -c \'...\'',
        cols: 100,
        rows: 40,
      );

      final captured = verify(client.execute(captureAny, pty: captureAnyNamed('pty'))).captured;
      expect(captured[0], 'exec /bin/sh -c \'...\'');
      final pty = captured[1] as SSHPtyConfig;
      expect(pty.width, 100);
      expect(pty.height, 40);
      expect(pty.type, 'xterm-256color');
    });

    test('remoteCommand хранится как есть', () async {
      final client = MockSSHClient();
      final session = MockSSHSession();
      when(client.execute(any, pty: anyNamed('pty'))).thenAnswer((_) async => session);
      when(session.stdout).thenAnswer((_) => const Stream<Uint8List>.empty());
      when(session.stderr).thenAnswer((_) => const Stream<Uint8List>.empty());

      final shell = await ShellSession.start(
        clientSource: _FakeClientSource(client),
        remoteCommand: 'my-command',
        cols: 80,
        rows: 24,
      );

      expect(shell.remoteCommand, 'my-command');
    });
  });

  group('ShellSession — вывод/ввод/resize/exit', () {
    late MockSSHClient client;
    late MockSSHSession session;
    late ShellSession shell;

    setUp(() async {
      client = MockSSHClient();
      session = MockSSHSession();
      when(client.execute(any, pty: anyNamed('pty'))).thenAnswer((_) async => session);
    });

    Future<void> startWith({Stream<Uint8List>? stdout, Stream<Uint8List>? stderr}) async {
      when(session.stdout).thenAnswer((_) => stdout ?? const Stream<Uint8List>.empty());
      when(session.stderr).thenAnswer((_) => stderr ?? const Stream<Uint8List>.empty());
      shell = await ShellSession.start(
        clientSource: _FakeClientSource(client),
        remoteCommand: 'cmd',
        cols: 80,
        rows: 24,
      );
    }

    test('output объединяет stdout и stderr без потерь', () async {
      final stdoutController = StreamController<Uint8List>();
      final stderrController = StreamController<Uint8List>();
      await startWith(stdout: stdoutController.stream, stderr: stderrController.stream);

      final received = <int>[];
      final subscription = shell.output.listen(received.addAll);

      stdoutController.add(_bytes('out1'));
      stderrController.add(_bytes('err1'));
      stdoutController.add(_bytes('out2'));
      await stdoutController.close();
      await stderrController.close();
      await Future<void>.delayed(Duration.zero);
      await subscription.cancel();

      final receivedText = utf8.decode(received);
      expect(receivedText.contains('out1'), isTrue);
      expect(receivedText.contains('err1'), isTrue);
      expect(receivedText.contains('out2'), isTrue);
    });

    test('output закрывается только после исчерпания ОБОИХ потоков', () async {
      final stdoutController = StreamController<Uint8List>();
      final stderrController = StreamController<Uint8List>();
      await startWith(stdout: stdoutController.stream, stderr: stderrController.stream);

      var outputDone = false;
      final subscription = shell.output.listen((_) {}, onDone: () => outputDone = true);

      await stdoutController.close();
      await Future<void>.delayed(Duration.zero);
      expect(outputDone, isFalse, reason: 'stderr ещё не закрыт');

      await stderrController.close();
      await Future<void>.delayed(Duration.zero);
      expect(outputDone, isTrue);

      await subscription.cancel();
    });

    test('write() пишет в session.write()', () async {
      when(session.write(any)).thenReturn(null);
      await startWith();

      shell.write(_bytes('hello'));

      verify(session.write(_bytes('hello'))).called(1);
    });

    test('write() НЕ закрывает stdin (в отличие от ExecChannel)', () async {
      await startWith();
      shell.write(_bytes('x'));
      // ShellSession никогда не трогает session.stdin напрямую (только через write()) — если
      // бы он закрывал stdin, здесь стоило бы verifyNever(session.stdin), но т.к. write()
      // делегирует в session.write(), а session — мок, единственное, что можно проверить —
      // что stdin-специфичные методы не вызывались вовсе.
      verifyNever(session.stdin);
    });

    test('resize() вызывает session.resizeTerminal()', () async {
      when(session.resizeTerminal(any, any, any, any)).thenReturn(null);
      await startWith();

      shell.resize(120, 40);

      verify(session.resizeTerminal(120, 40, 0, 0)).called(1);
    });

    test('exitCode/exitSignalName проксируют session', () async {
      when(session.exitCode).thenReturn(0);
      when(session.exitSignal).thenReturn(null);
      await startWith();

      expect(shell.exitCode, 0);
      expect(shell.exitSignalName, isNull);
    });

    test('exitSignalName берёт имя из exitSignal', () async {
      when(session.exitCode).thenReturn(null);
      when(session.exitSignal).thenReturn(
        SSHSessionExitSignal(
          signalName: 'KILL',
          coreDumped: false,
          errorMessage: '',
          languageTag: '',
        ),
      );
      await startWith();

      expect(shell.exitCode, isNull);
      expect(shell.exitSignalName, 'KILL');
    });

    test('done проксирует session.done', () async {
      final completer = Completer<void>();
      when(session.done).thenAnswer((_) => completer.future);
      await startWith();

      var doneCompleted = false;
      unawaited(shell.done.then((_) => doneCompleted = true));

      await Future<void>.delayed(Duration.zero);
      expect(doneCompleted, isFalse);

      completer.complete();
      await Future<void>.delayed(Duration.zero);
      expect(doneCompleted, isTrue);
    });

    test('close() вызывает session.close()', () async {
      when(session.close()).thenReturn(null);
      await startWith();

      shell.close();

      verify(session.close()).called(1);
    });
  });
}
