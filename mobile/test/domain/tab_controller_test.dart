import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dartssh2/dartssh2.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/domain/tab_controller.dart';
import 'package:mobile/remote/session_name.dart';
import 'package:mobile/transport/ssh_connection.dart';
import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';

import 'tab_controller_test.mocks.dart';

// dart run build_runner build (после правки этого файла) генерирует tab_controller_test.mocks.dart.
@GenerateNiceMocks([MockSpec<SSHClient>(), MockSpec<SSHSession>()])
class _FakeClientSource implements SshClientSource {
  _FakeClientSource(this.client);

  @override
  final SSHClient client;
}

Uint8List _bytes(String s) => Uint8List.fromList(utf8.encode(s));

/// Ждёт, пока стекут все отложенные микрозадачи/таймеры нулевой длительности — статус-стрим
/// [TabController] и мок-ответы (`thenAnswer((_) async => ...)`) доставляются асинхронно.
Future<void> _settle() async {
  await Future<void>.delayed(Duration.zero);
  await Future<void>.delayed(Duration.zero);
}

void main() {
  late MockSSHClient client;
  late MockSSHSession session;
  late _FakeClientSource clientSource;

  /// Команды, с которыми реально вызывался `client.execute()` — ведём вручную вместо
  /// `verify(...).captured`: mockito считает интеракцию «использованной» после первого же
  /// `verify()` для того же метода, поэтому повторный `verify()` в одном тесте видит только
  /// вызовы ПОСЛЕ предыдущего — свой независимый журнал надёжнее для тестов с несколькими
  /// реконнектами.
  late List<String> commands;

  setUp(() {
    client = MockSSHClient();
    session = MockSSHSession();
    clientSource = _FakeClientSource(client);
    commands = [];
    when(client.execute(any, pty: anyNamed('pty')))
        .thenAnswer((invocation) async {
          commands.add(invocation.positionalArguments[0] as String);
          return session;
        });
    when(session.stdout).thenAnswer((_) => const Stream<Uint8List>.empty());
    when(session.stderr).thenAnswer((_) => const Stream<Uint8List>.empty());
    when(session.close()).thenReturn(null);
    when(session.write(any)).thenReturn(null);
    when(session.resizeTerminal(any, any, any, any)).thenReturn(null);
    when(session.done).thenAnswer(
      (_) => Completer<void>().future,
    ); // не завершается, пока не переармировано
    when(session.exitCode).thenReturn(null);
    when(session.exitSignal).thenReturn(null);
  });

  group('TabController — выбор имени сессии', () {
    test('persistence=tmux без явного sessionName берёт buildSessionNameBase(connectionId)', () {
      final controller = TabController(
        clientSource: clientSource,
        connectionId: 'my-conn-id',
        cols: 80,
        rows: 24,
      );
      expect(controller.sessionName, buildSessionNameBase('my-conn-id'));
    });

    test('persistence=tmux с занятыми именами выбирает первое свободное', () {
      final base = buildSessionNameBase('my-conn-id');
      final controller = TabController(
        clientSource: clientSource,
        connectionId: 'my-conn-id',
        cols: 80,
        rows: 24,
        takenSessionNames: [base],
      );
      expect(controller.sessionName, '$base-2');
    });

    test('persistence=off — sessionName всегда null', () {
      final controller = TabController(
        clientSource: clientSource,
        connectionId: 'my-conn-id',
        cols: 80,
        rows: 24,
        persistence: 'off',
      );
      expect(controller.sessionName, isNull);
    });
  });

  group('TabController — connect()', () {
    test('запускает канал с заданными cols/rows и переходит connecting -> connected', () async {
      final controller = TabController(
        clientSource: clientSource,
        connectionId: 'c1',
        cols: 100,
        rows: 40,
        persistence: 'off',
      );
      final statuses = <TabConnectionStatus>[];
      controller.status.listen((e) => statuses.add(e.status));

      await controller.connect();
      await _settle();

      expect(statuses, [
        TabConnectionStatus.connecting,
        TabConnectionStatus.connected,
      ]);
      expect(commands, hasLength(1));
      final captured = verify(client.execute(any, pty: captureAnyNamed('pty')))
          .captured;
      final pty = captured.single as SSHPtyConfig;
      expect(pty.width, 100);
      expect(pty.height, 40);
      expect(controller.isConnected, isTrue);
    });

    test(
      'persistence=off, hooks=true строит команду с хуками (_etty_emit)',
      () async {
        final controller = TabController(
          clientSource: clientSource,
          connectionId: 'c1',
          cols: 80,
          rows: 24,
          persistence: 'off',
        );
        await controller.connect();
        await _settle();
        expect(commands.single, contains('_etty_emit'));
      },
    );

    test('persistence=off, hooks=false строит команду без хуков', () async {
      final controller = TabController(
        clientSource: clientSource,
        connectionId: 'c1',
        cols: 80,
        rows: 24,
        persistence: 'off',
        hooksEnabled: false,
      );
      await controller.connect();
      await _settle();
      expect(commands.single, isNot(contains('_etty_emit')));
    });

    test('ошибка execute() даёт статус error, не бросает наружу', () async {
      when(client.execute(any, pty: anyNamed('pty')))
          .thenThrow(Exception('auth failed'));
      final controller = TabController(
        clientSource: clientSource,
        connectionId: 'c1',
        cols: 80,
        rows: 24,
        persistence: 'off',
      );
      final statuses = <TabStatusEvent>[];
      controller.status.listen(statuses.add);

      await controller.connect();
      await _settle();

      expect(statuses.last.status, TabConnectionStatus.error);
      expect(statuses.last.error, isNotNull);
      expect(controller.isConnected, isFalse);
    });
  });

  group('TabController — вывод через OscTap', () {
    test(
      'OSC 7 из вывода вызывает onCwdChange и не попадает в output',
      () async {
        final stdoutController = StreamController<Uint8List>();
        when(session.stdout).thenAnswer((_) => stdoutController.stream);
        final cwdEvents = <String>[];
        final controller = TabController(
          clientSource: clientSource,
          connectionId: 'c1',
          cols: 80,
          rows: 24,
          persistence: 'off',
          onCwdChange: cwdEvents.add,
        );
        final outputBytes = <int>[];
        controller.output.listen(outputBytes.addAll);

        await controller.connect();
        await _settle();
        stdoutController.add(_bytes('before\x1b]7;file:///home/x\x07after'));
        await stdoutController.close();
        await _settle();

        expect(cwdEvents, ['/home/x']);
        expect(utf8.decode(outputBytes), 'beforeafter');
      },
    );
  });

  group('TabController — REQ-12: перехват tmux-сессии', () {
    test(
      'persistence=tmux, exitCode 0 после успешного connect -> intercepted',
      () async {
        final doneCompleter = Completer<void>();
        when(session.done).thenAnswer((_) => doneCompleter.future);
        final controller = TabController(
          clientSource: clientSource,
          connectionId: 'c1',
          cols: 80,
          rows: 24,
          persistence: 'tmux',
        );
        final statuses = <TabConnectionStatus>[];
        controller.status.listen((e) => statuses.add(e.status));

        await controller.connect();
        await _settle();
        when(session.exitCode).thenReturn(0);
        doneCompleter.complete();
        await _settle();

        expect(statuses, [
          TabConnectionStatus.connecting,
          TabConnectionStatus.connected,
          TabConnectionStatus.intercepted,
        ]);
      },
    );

    test(
      'persistence=off, exitCode 0 — НЕ intercepted (перехват только для tmux)',
      () async {
        final doneCompleter = Completer<void>();
        when(session.done).thenAnswer((_) => doneCompleter.future);
        final controller = TabController(
          clientSource: clientSource,
          connectionId: 'c1',
          cols: 80,
          rows: 24,
          persistence: 'off',
        );
        final statuses = <TabConnectionStatus>[];
        controller.status.listen((e) => statuses.add(e.status));

        await controller.connect();
        await _settle();
        when(session.exitCode).thenReturn(0);
        doneCompleter.complete();
        await _settle();

        expect(statuses.last, TabConnectionStatus.error);
      },
    );
  });

  group('TabController — авто-ретрай без хуков', () {
    test(
      'быстрое ненулевое падение с хуками -> один реконнект без хуков',
      () async {
        final firstDone = Completer<void>();
        when(session.done).thenAnswer((_) => firstDone.future);
        final controller = TabController(
          clientSource: clientSource,
          connectionId: 'c1',
          cols: 80,
          rows: 24,
          persistence: 'off',
          hooksEnabled: true,
        );
        final statuses = <TabConnectionStatus>[];
        controller.status.listen((e) => statuses.add(e.status));

        await controller.connect();
        await _settle();
        expect(commands, hasLength(1));
        expect(
          commands[0],
          contains('_etty_emit'),
          reason: 'первая попытка — с хуками',
        );

        final secondDone = Completer<void>();
        when(session.done).thenAnswer((_) => secondDone.future);
        when(session.exitCode).thenReturn(1);
        firstDone.complete();
        await _settle();

        expect(commands, hasLength(2), reason: 'ровно один авто-реконнект');
        expect(
          commands[1],
          isNot(contains('_etty_emit')),
          reason: 'ретрай — без хуков',
        );

        // Второе быстрое падение в том же цикле — уже НЕ ретраится повторно, сразу error.
        when(session.exitCode).thenReturn(1);
        secondDone.complete();
        await _settle();

        expect(statuses.last, TabConnectionStatus.error);
        expect(
          commands,
          hasLength(2),
          reason: 'третьего вызова execute() быть не должно',
        );
      },
    );

    test('быстрое падение БЕЗ хуков не ретраится (нечего отключать)', () async {
      final doneCompleter = Completer<void>();
      when(session.done).thenAnswer((_) => doneCompleter.future);
      final controller = TabController(
        clientSource: clientSource,
        connectionId: 'c1',
        cols: 80,
        rows: 24,
        persistence: 'off',
        hooksEnabled: false,
      );
      final statuses = <TabConnectionStatus>[];
      controller.status.listen((e) => statuses.add(e.status));

      await controller.connect();
      await _settle();
      when(session.exitCode).thenReturn(1);
      doneCompleter.complete();
      await _settle();

      expect(statuses.last, TabConnectionStatus.error);
      expect(commands, hasLength(1));
    });

    test(
      'повторный connect() пользователем сбрасывает флаг ретрая (новый цикл)',
      () async {
        final firstDone = Completer<void>();
        when(session.done).thenAnswer((_) => firstDone.future);
        final controller = TabController(
          clientSource: clientSource,
          connectionId: 'c1',
          cols: 80,
          rows: 24,
          persistence: 'off',
        );

        await controller.connect();
        await _settle();
        final secondDone = Completer<void>();
        when(session.done).thenAnswer((_) => secondDone.future);
        when(session.exitCode).thenReturn(1);
        firstDone.complete();
        await _settle(); // авто-ретрай (2-й execute)
        expect(commands, hasLength(2));

        final thirdDone = Completer<void>();
        when(session.done).thenAnswer((_) => thirdDone.future);
        when(session.exitCode).thenReturn(1);
        secondDone.complete();
        await _settle(); // это уже error, ретрай исчерпан
        expect(commands, hasLength(2));

        // Пользователь жмёт «переподключиться» — новый цикл, ретрай снова доступен.
        when(session.exitCode).thenReturn(null);
        await controller.connect();
        await _settle();
        expect(commands, hasLength(3));

        final fourthDone = Completer<void>();
        when(session.done).thenAnswer((_) => fourthDone.future);
        when(session.exitCode).thenReturn(1);
        thirdDone.complete();
        await _settle();

        expect(
          commands,
          hasLength(4),
          reason: '2 попытки первого цикла + 2 попытки второго (ручной + его собственный ретрай)',
        );
      },
    );
  });

  group('TabController — close()/dispose()', () {
    test(
      'close() публикует detached и закрывает канал, поздний exit игнорируется',
      () async {
        final doneCompleter = Completer<void>();
        when(session.done).thenAnswer((_) => doneCompleter.future);
        final controller = TabController(
          clientSource: clientSource,
          connectionId: 'c1',
          cols: 80,
          rows: 24,
          persistence: 'off',
        );
        final statuses = <TabConnectionStatus>[];
        controller.status.listen((e) => statuses.add(e.status));

        await controller.connect();
        await _settle();
        await controller.close();
        verify(session.close()).called(1);
        expect(controller.isConnected, isFalse);

        // Обрыв реального канала приходит уже ПОСЛЕ того, как мы сами его закрыли — не должен
        // переписать detached на intercepted/error.
        when(session.exitCode).thenReturn(0);
        doneCompleter.complete();
        await _settle();

        expect(statuses, [
          TabConnectionStatus.connecting,
          TabConnectionStatus.connected,
          TabConnectionStatus.detached,
        ]);
      },
    );

    test('dispose() запрещает дальнейшие connect()', () async {
      final controller = TabController(
        clientSource: clientSource,
        connectionId: 'c1',
        cols: 80,
        rows: 24,
        persistence: 'off',
      );
      await controller.dispose();

      await controller.connect();
      await _settle();

      expect(commands, isEmpty);
    });
  });

  group('TabController — write()/resize()', () {
    test('write()/resize() без подключения не бросают исключение', () {
      final controller = TabController(
        clientSource: clientSource,
        connectionId: 'c1',
        cols: 80,
        rows: 24,
        persistence: 'off',
      );
      expect(() => controller.write(_bytes('x')), returnsNormally);
      expect(() => controller.resize(100, 30), returnsNormally);
    });

    test('write()/resize() при подключении делегируют в сессию', () async {
      final controller = TabController(
        clientSource: clientSource,
        connectionId: 'c1',
        cols: 80,
        rows: 24,
        persistence: 'off',
      );
      await controller.connect();
      await _settle();

      controller.write(_bytes('ls\n'));
      controller.resize(120, 50);

      verify(session.write(_bytes('ls\n'))).called(1);
      verify(session.resizeTerminal(120, 50, 0, 0)).called(1);
    });
  });
}
