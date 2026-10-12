import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/domain/tmux_sessions.dart';
import 'package:mobile/remote/remote_scripts.dart';
import 'package:mobile/transport/exec_channel.dart';

Uint8List _bytes(String s) => Uint8List.fromList(utf8.encode(s));

ExecResult _ok({Uint8List? stdout}) => ExecResult(
  exitCode: 0,
  stdout: stdout ?? Uint8List(0),
  stderr: Uint8List(0),
  timedOut: false,
);

ExecResult _fail(int exitCode, {String stderr = ''}) => ExecResult(
  exitCode: exitCode,
  stdout: Uint8List(0),
  stderr: _bytes(stderr),
  timedOut: false,
);

ExecResult _timedOut() =>
    ExecResult(stdout: Uint8List(0), stderr: Uint8List(0), timedOut: true);

/// Один сеанс без известной активной команды — секция панелей пустая (только разделитель).
Uint8List _oneSessionStdout({
  required String name,
  int windows = 1,
  int attached = 0,
  int createdAt = 1000,
  int? activityAt,
}) {
  final activity = activityAt?.toString() ?? '';
  return _bytes(
    '$windows\x00$attached\x00$createdAt\x00$activity\x00$name\n\n',
  );
}

/// Записывает каждый вызов и отвечает результатом [responder] для `(script, args)`.
class _FakeRemoteExec implements RemoteExec {
  final List<({String script, List<String> args})> calls = [];
  ExecResult Function(String script, List<String> args) responder = (_, _) =>
      _ok();

  @override
  Future<ExecResult> exec(
    String script,
    List<String> args, {
    Uint8List? stdin,
    Duration timeout = const Duration(milliseconds: 15000),
    int maxBufferBytes = 8 * 1024 * 1024,
  }) async {
    calls.add((script: script, args: args));
    return responder(script, args);
  }
}

void main() {
  group('TmuxSessionsService — list', () {
    test('передаёт socket позиционным аргументом и парсит вывод', () async {
      final fake = _FakeRemoteExec()
        ..responder = (_, _) =>
            _ok(stdout: _oneSessionStdout(name: 'etty-abc12345'));
      final service = TmuxSessionsService(exec: fake, socket: 'etty');

      final sessions = await service.list();

      expect(fake.calls.single.script, RemoteScripts.tmuxListSessionsScript);
      expect(fake.calls.single.args, ['etty']);
      expect(sessions, hasLength(1));
      expect(sessions.single.name, 'etty-abc12345');
    });

    test('exit 127 -> TmuxSessionsErrorCode.noTmux', () async {
      final fake = _FakeRemoteExec()..responder = (_, _) => _fail(127);
      final service = TmuxSessionsService(exec: fake);

      await expectLater(
        service.list(),
        throwsA(
          isA<TmuxSessionsException>().having(
            (e) => e.code,
            'code',
            TmuxSessionsErrorCode.noTmux,
          ),
        ),
      );
    });

    test('timedOut -> TmuxSessionsErrorCode.timeout', () async {
      final fake = _FakeRemoteExec()..responder = (_, _) => _timedOut();
      final service = TmuxSessionsService(exec: fake);

      await expectLater(
        service.list(),
        throwsA(
          isA<TmuxSessionsException>().having(
            (e) => e.code,
            'code',
            TmuxSessionsErrorCode.timeout,
          ),
        ),
      );
    });

    test('прочий ненулевой код -> io с текстом stderr', () async {
      final fake = _FakeRemoteExec()
        ..responder = (_, _) => _fail(1, stderr: 'connection lost');
      final service = TmuxSessionsService(exec: fake);

      await expectLater(
        service.list(),
        throwsA(
          isA<TmuxSessionsException>()
              .having((e) => e.code, 'code', TmuxSessionsErrorCode.io)
              .having((e) => e.message, 'message', 'connection lost'),
        ),
      );
    });

    test('параллельные вызовы list() совмещаются в один exec', () async {
      final fake = _FakeRemoteExec()
        ..responder = (_, _) => _ok(stdout: _oneSessionStdout(name: 'x'));
      final service = TmuxSessionsService(exec: fake);

      final results = await Future.wait([
        service.list(),
        service.list(),
        service.list(),
      ]);

      expect(fake.calls, hasLength(1));
      expect(results.every((r) => r.single.name == 'x'), isTrue);
    });

    test(
      'list() после завершения предыдущего делает новый exec-вызов',
      () async {
        final fake = _FakeRemoteExec()
          ..responder = (_, _) => _ok(stdout: _oneSessionStdout(name: 'x'));
        final service = TmuxSessionsService(exec: fake);

        await service.list();
        await service.list();

        expect(fake.calls, hasLength(2));
      },
    );
  });

  group('TmuxSessionsService — kill', () {
    test(
      'передаёт socket и имя, невалидное имя отклоняется без exec-вызова',
      () async {
        final fake = _FakeRemoteExec();
        final service = TmuxSessionsService(exec: fake, socket: 'etty');

        await expectLater(
          service.kill('bad name!'),
          throwsA(
            isA<TmuxSessionsException>().having(
              (e) => e.code,
              'code',
              TmuxSessionsErrorCode.invalidName,
            ),
          ),
        );
        expect(fake.calls, isEmpty);
      },
    );

    test('успешный kill передаёт [socket, name]', () async {
      final fake = _FakeRemoteExec();
      final service = TmuxSessionsService(exec: fake, socket: 'etty');

      await service.kill('etty-abc12345');

      expect(fake.calls.single.script, RemoteScripts.tmuxKillSessionScript);
      expect(fake.calls.single.args, ['etty', 'etty-abc12345']);
    });

    test('exit 3 -> notFound', () async {
      final fake = _FakeRemoteExec()..responder = (_, _) => _fail(3);
      final service = TmuxSessionsService(exec: fake);

      await expectLater(
        service.kill('etty-abc12345'),
        throwsA(
          isA<TmuxSessionsException>().having(
            (e) => e.code,
            'code',
            TmuxSessionsErrorCode.notFound,
          ),
        ),
      );
    });
  });

  group('TmuxSessionsService — rename', () {
    test('оба имени валидируются до отправки', () async {
      final fake = _FakeRemoteExec();
      final service = TmuxSessionsService(exec: fake);

      await expectLater(
        service.rename('ok-name', 'bad name!'),
        throwsA(
          isA<TmuxSessionsException>().having(
            (e) => e.code,
            'code',
            TmuxSessionsErrorCode.invalidName,
          ),
        ),
      );
      expect(fake.calls, isEmpty);
    });

    test('успешный rename передаёт [socket, name, newName]', () async {
      final fake = _FakeRemoteExec();
      final service = TmuxSessionsService(exec: fake, socket: 'etty');

      await service.rename('old-name', 'new-name');

      expect(fake.calls.single.args, ['etty', 'old-name', 'new-name']);
    });

    test('exit 3 -> notFound, exit 17 -> nameTaken', () async {
      final fake = _FakeRemoteExec();
      final service = TmuxSessionsService(exec: fake);

      fake.responder = (_, _) => _fail(3);
      await expectLater(
        service.rename('a', 'b'),
        throwsA(
          isA<TmuxSessionsException>().having(
            (e) => e.code,
            'code',
            TmuxSessionsErrorCode.notFound,
          ),
        ),
      );

      fake.responder = (_, _) => _fail(17);
      await expectLater(
        service.rename('a', 'b'),
        throwsA(
          isA<TmuxSessionsException>().having(
            (e) => e.code,
            'code',
            TmuxSessionsErrorCode.nameTaken,
          ),
        ),
      );
    });
  });

  group('TmuxSessionsService — автополлинг', () {
    test(
      'refreshSoon() публикует список в onSessionsChanged после debounce-паузы',
      () async {
        final fake = _FakeRemoteExec()
          ..responder = (_, _) => _ok(stdout: _oneSessionStdout(name: 'x'));
        final service = TmuxSessionsService(exec: fake);
        final events = <List<String>>[];
        service.onSessionsChanged.listen(
          (sessions) => events.add(sessions.map((s) => s.name).toList()),
        );

        service.refreshSoon();
        await Future<void>.delayed(
          const Duration(
            milliseconds: 900,
          ), // > SshSessionConfig.sessionsRefreshDelayMs (800)
        );

        expect(events, [
          ['x'],
        ]);
        service.dispose();
      },
    );

    test('серия быстрых refreshSoon() даёт один exec-вызов (debounce, не троттлинг)', () async {
      final fake = _FakeRemoteExec()
        ..responder = (_, _) => _ok(stdout: _oneSessionStdout(name: 'x'));
      final service = TmuxSessionsService(exec: fake);

      service.refreshSoon();
      await Future<void>.delayed(const Duration(milliseconds: 100));
      service.refreshSoon();
      await Future<void>.delayed(const Duration(milliseconds: 100));
      service.refreshSoon();
      await Future<void>.delayed(const Duration(milliseconds: 900));

      expect(fake.calls, hasLength(1));
      service.dispose();
    });

    test('ошибка цикла публикуется через addError, не роняет стрим', () async {
      final fake = _FakeRemoteExec()..responder = (_, _) => _fail(127);
      final service = TmuxSessionsService(exec: fake);
      final errors = <Object>[];
      service.onSessionsChanged.listen((_) {}, onError: errors.add);

      service.refreshSoon();
      await Future<void>.delayed(const Duration(milliseconds: 900));

      expect(errors, hasLength(1));
      expect(
        (errors.single as TmuxSessionsException).code,
        TmuxSessionsErrorCode.noTmux,
      );
      service.dispose();
    });

    test('dispose() отменяет отложенный refreshSoon()', () async {
      final fake = _FakeRemoteExec()
        ..responder = (_, _) => _ok(stdout: _oneSessionStdout(name: 'x'));
      final service = TmuxSessionsService(exec: fake);

      service.refreshSoon();
      service.dispose();
      await Future<void>.delayed(const Duration(milliseconds: 900));

      expect(fake.calls, isEmpty);
    });
  });
}
