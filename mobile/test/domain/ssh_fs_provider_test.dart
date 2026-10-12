import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/domain/ssh_fs_provider.dart';
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

/// Записывает каждый вызов и отвечает результатом, который вернёт [responder] для этого
/// `(script, args)` — детерминированный фейк [RemoteExec] вместо реального сервера/сети,
/// как `SshClientSource` в транспортном слое.
class _FakeRemoteExec implements RemoteExec {
  final List<({String script, List<String> args, Uint8List? stdin})> calls = [];
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
    calls.add((script: script, args: args, stdin: stdin));
    return responder(script, args);
  }
}

SshFsProvider _provider(
  _FakeRemoteExec exec, {
  String root = '/home/user',
  bool statFlavorGnu = true,
  bool find0 = true,
}) => SshFsProvider(
  exec: exec,
  root: root,
  statFlavorGnu: statFlavorGnu,
  find0: find0,
);

void main() {
  group('SshFsProvider — readDir', () {
    test('find0=true использует readDirScript', () async {
      final fake = _FakeRemoteExec();
      fake.responder = (script, args) => _ok(stdout: _bytes('\x00\x00'));
      final provider = _provider(fake, find0: true);

      await provider.readDir('/home/user/sub');

      expect(fake.calls.single.script, RemoteScripts.readDirScript);
      expect(fake.calls.single.args, ['/home/user/sub']);
    });

    test('find0=false использует readDirFallbackScript', () async {
      final fake = _FakeRemoteExec();
      fake.responder = (script, args) => _ok(stdout: _bytes('\x00\x00'));
      final provider = _provider(fake, find0: false);

      await provider.readDir('/home/user/sub');

      expect(fake.calls.single.script, RemoteScripts.readDirFallbackScript);
    });

    test('парсит папки и файлы из NUL-разделённого вывода', () async {
      final fake = _FakeRemoteExec();
      fake.responder = (_, _) =>
          _ok(stdout: _bytes('dir1\x00dir2\x00\x00file1\x00file2\x00'));
      final provider = _provider(fake);

      final entries = await provider.readDir('/home/user');

      expect(entries.where((e) => e.isDirectory).map((e) => e.name), [
        'dir1',
        'dir2',
      ]);
      expect(entries.where((e) => !e.isDirectory).map((e) => e.name), [
        'file1',
        'file2',
      ]);
      expect(entries.first.path, '/home/user/dir1');
    });

    test('exit 3 бросает SshFsException(notFound)', () async {
      final fake = _FakeRemoteExec();
      fake.responder = (_, _) => _fail(3);
      final provider = _provider(fake);

      await expectLater(
        provider.readDir('/missing'),
        throwsA(
          isA<SshFsException>().having(
            (e) => e.code,
            'code',
            SshFsErrorCode.notFound,
          ),
        ),
      );
    });

    test(
      'прочий ненулевой код бросает SshFsException(io) с текстом stderr',
      () async {
        final fake = _FakeRemoteExec();
        fake.responder = (_, _) => _fail(1, stderr: 'permission denied');
        final provider = _provider(fake);

        await expectLater(
          provider.readDir('/x'),
          throwsA(
            isA<SshFsException>()
                .having((e) => e.code, 'code', SshFsErrorCode.io)
                .having((e) => e.message, 'message', 'permission denied'),
          ),
        );
      },
    );
  });

  group('SshFsProvider — createFile/createDir/rename', () {
    test('createFile передаёт root и путь позиционными аргументами', () async {
      final fake = _FakeRemoteExec();
      final provider = _provider(fake, root: '/root');

      await provider.createFile('/root/new.txt');

      expect(fake.calls.single.script, RemoteScripts.createFileScript);
      expect(fake.calls.single.args, ['/root', '/root/new.txt']);
    });

    test('createFile exit 13 -> traversalDenied', () async {
      final fake = _FakeRemoteExec()..responder = (_, _) => _fail(13);
      final provider = _provider(fake);

      await expectLater(
        provider.createFile('/etc/passwd'),
        throwsA(
          isA<SshFsException>().having(
            (e) => e.code,
            'code',
            SshFsErrorCode.traversalDenied,
          ),
        ),
      );
    });

    test('createDir exit 13 -> traversalDenied', () async {
      final fake = _FakeRemoteExec()..responder = (_, _) => _fail(13);
      final provider = _provider(fake);

      await expectLater(
        provider.createDir('/etc'),
        throwsA(
          isA<SshFsException>().having(
            (e) => e.code,
            'code',
            SshFsErrorCode.traversalDenied,
          ),
        ),
      );
    });

    test('rename exit 17 -> alreadyExists', () async {
      final fake = _FakeRemoteExec()..responder = (_, _) => _fail(17);
      final provider = _provider(fake);

      await expectLater(
        provider.rename('/a', '/b'),
        throwsA(
          isA<SshFsException>().having(
            (e) => e.code,
            'code',
            SshFsErrorCode.alreadyExists,
          ),
        ),
      );
    });

    test('успешные CRUD-операции не бросают исключение', () async {
      final fake = _FakeRemoteExec();
      final provider = _provider(fake);
      await provider.createFile('/root/a');
      await provider.createDir('/root/b');
      await provider.rename('/root/a', '/root/c');
      // Если бы что-то бросило, тест бы упал до этой точки.
    });
  });

  group('SshFsProvider — deleteMany и батчинг', () {
    test(
      'чанкует по SshFsConfig.batchSize (150) — 200 путей дают 2 вызова',
      () async {
        final fake = _FakeRemoteExec();
        final provider = _provider(fake);
        final paths = List.generate(200, (i) => '/root/f$i');

        await provider.deleteMany(paths);

        expect(fake.calls, hasLength(2));
        expect(fake.calls[0].args.length, 1 + 150); // root + 150 путей
        expect(fake.calls[1].args.length, 1 + 50);
      },
    );

    test('пустой список не делает ни одного exec-вызова', () async {
      final fake = _FakeRemoteExec();
      final provider = _provider(fake);

      await provider.deleteMany([]);

      expect(fake.calls, isEmpty);
    });

    test('delete(single) — обёртка над deleteMany с одним путём', () async {
      final fake = _FakeRemoteExec();
      final provider = _provider(fake);

      await provider.delete('/root/x');

      expect(fake.calls.single.args, ['/home/user', '/root/x']);
    });

    test('ненулевой код в середине батчей бросает исключение', () async {
      var call = 0;
      final fake = _FakeRemoteExec();
      fake.responder = (_, _) {
        call++;
        return call == 2 ? _fail(1, stderr: 'boom') : _ok();
      };
      final provider = _provider(fake);
      final paths = List.generate(200, (i) => '/root/f$i');

      await expectLater(
        provider.deleteMany(paths),
        throwsA(isA<SshFsException>()),
      );
    });
  });

  group('SshFsProvider — copy/copyMany/move', () {
    test('copy возвращает newPath из parseSinglePathResult', () async {
      final fake = _FakeRemoteExec()
        ..responder = (_, _) => _ok(stdout: _bytes('/dest/a.txt\x00'));
      final provider = _provider(fake);

      final newPath = await provider.copy('/root/a.txt', '/dest');

      expect(newPath, '/dest/a.txt');
    });

    test('copy exit 13 -> traversalDenied', () async {
      final fake = _FakeRemoteExec()..responder = (_, _) => _fail(13);
      final provider = _provider(fake);

      await expectLater(
        provider.copy('/etc/passwd', '/dest'),
        throwsA(
          isA<SshFsException>().having(
            (e) => e.code,
            'code',
            SshFsErrorCode.traversalDenied,
          ),
        ),
      );
    });

    test('copyMany чанкует и объединяет результаты всех батчей', () async {
      var batchN = 0;
      final fake = _FakeRemoteExec();
      fake.responder = (_, args) {
        batchN++;
        final srcs = args.sublist(2); // root, destDir, затем сами пути
        final buf = BytesBuilder();
        for (final s in srcs) {
          buf.add(utf8.encode('O\x00$s-copy\x00'));
        }
        return _ok(stdout: buf.toBytes());
      };
      final provider = _provider(fake);
      final paths = List.generate(160, (i) => '/root/f$i');

      final results = await provider.copyMany(paths, '/dest');

      expect(batchN, 2);
      expect(results, hasLength(160));
      expect(results.every((r) => r.success), isTrue);
    });

    test(
      'move возвращает частичный отказ отдельным путём (пары O/E из скрипта)',
      () async {
        final fake = _FakeRemoteExec()
          ..responder = (_, _) =>
              _ok(stdout: _bytes('O\x00/dest/a\x00E\x00/root/b\x00'));
        final provider = _provider(fake);

        final results = await provider.move(['/root/a', '/root/b'], '/dest');

        expect(results[0].success, isTrue);
        expect(results[0].newPath, '/dest/a');
        expect(results[1].success, isFalse);
      },
    );

    test(
      'move: неуспешный батч помечает весь батч ошибкой, не бросает исключение',
      () async {
        final fake = _FakeRemoteExec()
          ..responder = (_, _) => _fail(1, stderr: 'no space');
        final provider = _provider(fake);

        final results = await provider.move(['/root/a', '/root/b'], '/dest');

        expect(results, hasLength(2));
        expect(results.every((r) => !r.success), isTrue);
        expect(results.first.error, 'no space');
      },
    );
  });

  group('SshFsProvider — readFile/writeFile', () {
    test('readFile возвращает содержимое и размер', () async {
      final fake = _FakeRemoteExec()
        ..responder = (_, _) => _ok(stdout: _bytes('hello'));
      final provider = _provider(fake);

      final content = await provider.readFile('/root/a.txt');

      expect(content.content, 'hello');
      expect(content.size, 5);
    });

    test('readFile exit 2 -> notFound', () async {
      final fake = _FakeRemoteExec()..responder = (_, _) => _fail(2);
      final provider = _provider(fake);

      await expectLater(
        provider.readFile('/missing'),
        throwsA(
          isA<SshFsException>().having(
            (e) => e.code,
            'code',
            SshFsErrorCode.notFound,
          ),
        ),
      );
    });

    test('readFile exit 9 -> tooLarge с размером из stderr', () async {
      final fake = _FakeRemoteExec()
        ..responder = (_, _) => _fail(9, stderr: '999999');
      final provider = _provider(fake);

      await expectLater(
        provider.readFile('/big'),
        throwsA(
          isA<SshFsException>()
              .having((e) => e.code, 'code', SshFsErrorCode.tooLarge)
              .having((e) => e.size, 'size', 999999),
        ),
      );
    });

    test('writeFile передаёт содержимое через stdin', () async {
      final fake = _FakeRemoteExec();
      final provider = _provider(fake);

      await provider.writeFile('/root/a.txt', 'новый текст');

      expect(fake.calls.single.script, RemoteScripts.writeFileScript);
      expect(utf8.decode(fake.calls.single.stdin!), 'новый текст');
    });
  });

  group('SshFsProvider — statFile', () {
    test('statFlavorGnu=true использует GNU-скрипт и парсит вывод', () async {
      final fake = _FakeRemoteExec()
        ..responder = (_, _) => _ok(stdout: _bytes('1700000000 42'));
      final provider = _provider(fake, statFlavorGnu: true);

      final stat = await provider.statFile('/root/a.txt');

      expect(fake.calls.single.script, RemoteScripts.statFileGnuScript);
      expect(stat.mtimeMs, 1700000000 * 1000);
      expect(stat.size, 42);
    });

    test('statFlavorGnu=false использует BSD-скрипт', () async {
      final fake = _FakeRemoteExec()
        ..responder = (_, _) => _ok(stdout: _bytes('1700000000 42'));
      final provider = _provider(fake, statFlavorGnu: false);

      await provider.statFile('/root/a.txt');

      expect(fake.calls.single.script, RemoteScripts.statFileBsdScript);
    });
  });

  group('SshFsProvider — polling-watcher', () {
    test('pollOnce без watchDir ничего не опрашивает', () async {
      final fake = _FakeRemoteExec();
      final provider = _provider(fake);

      await provider.pollOnce();

      expect(fake.calls, isEmpty);
      provider.dispose();
    });

    test('первый цикл только кеширует mtime — событие не летит без предыдущего значения', () async {
      final fake = _FakeRemoteExec()
        ..responder = (_, _) => _ok(stdout: _bytes('100\n'));
      final provider = _provider(fake);
      final changed = <String>[];
      provider.onDirChanged.listen(changed.add);
      provider.watchDir('/root');

      await provider.pollOnce();
      await Future<void>.delayed(Duration.zero);

      expect(changed, isEmpty);
      provider.dispose();
    });

    test(
      'изменившийся mtime между циклами публикует событие в onDirChanged',
      () async {
        var mtime = 100;
        final fake = _FakeRemoteExec()
          ..responder = (_, _) => _ok(stdout: _bytes('$mtime\n'));
        final provider = _provider(fake);
        final changed = <String>[];
        provider.onDirChanged.listen(changed.add);
        provider.watchDir('/root');

        await provider.pollOnce(); // кеширует 100
        mtime = 200;
        await provider.pollOnce(); // видит смену 100 -> 200
        await Future<void>.delayed(Duration.zero);

        expect(changed, ['/root']);
        provider.dispose();
      },
    );

    test('неизменный mtime между циклами не публикует событие', () async {
      final fake = _FakeRemoteExec()
        ..responder = (_, _) => _ok(stdout: _bytes('100\n'));
      final provider = _provider(fake);
      final changed = <String>[];
      provider.onDirChanged.listen(changed.add);
      provider.watchDir('/root');

      await provider.pollOnce();
      await provider.pollOnce();
      await Future<void>.delayed(Duration.zero);

      expect(changed, isEmpty);
      provider.dispose();
    });

    test(
      'unwatchDir убирает каталог из следующего poll-цикла и его кеша',
      () async {
        final fake = _FakeRemoteExec()
          ..responder = (_, args) => _ok(stdout: _bytes('100\n200\n'));
        final provider = _provider(fake);
        provider.watchDir('/a');
        provider.watchDir('/b');
        await provider.pollOnce();
        fake.calls.clear();

        provider.unwatchDir('/a');
        fake.responder = (_, args) => _ok(stdout: _bytes('999\n'));
        await provider.pollOnce();

        expect(fake.calls.single.args, ['/b']);
        provider.dispose();
      },
    );

    test('unwatchAll останавливает polling целиком', () async {
      final fake = _FakeRemoteExec()
        ..responder = (_, _) => _ok(stdout: _bytes('100\n'));
      final provider = _provider(fake);
      provider.watchDir('/a');
      await provider.pollOnce();
      fake.calls.clear();

      provider.unwatchAll();
      await provider.pollOnce();

      expect(fake.calls, isEmpty);
      provider.dispose();
    });

    test('мутация (writeFile) наблюдаемого каталога шлёт событие немедленно, не дожидаясь poll', () async {
      final fake = _FakeRemoteExec();
      final provider = _provider(fake, root: '/root');
      final changed = <String>[];
      provider.onDirChanged.listen(changed.add);
      provider.watchDir('/root');

      await provider.writeFile('/root/a.txt', 'x');
      await Future<void>.delayed(Duration.zero);

      expect(changed, ['/root']);
      provider.dispose();
    });

    test('мутация ненаблюдаемого каталога не шлёт событие', () async {
      final fake = _FakeRemoteExec();
      final provider = _provider(fake, root: '/root');
      final changed = <String>[];
      provider.onDirChanged.listen(changed.add);
      // /root не наблюдается

      await provider.writeFile('/root/a.txt', 'x');
      await Future<void>.delayed(Duration.zero);

      expect(changed, isEmpty);
      provider.dispose();
    });
  });
}
