import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/remote/remote_shell_hooks.dart';

const _paths = <String>['/a b', "/it's", '/wow!', r'/$HOME', '/ёжик', '/50%', r'/back\slash'];

String _build({String? startDir, String socketName = 'etty', bool hooks = true}) =>
    RemoteShellHooks.buildRemoteInitCommand(
      persistence: 'tmux',
      sessionName: 'sess1',
      hooks: hooks,
      socketName: socketName,
      startDir: startDir,
    );

/// INNER = содержимое между `exec /bin/sh -c '` и последней `'`.
String _inner(String cmd) {
  const prefix = "exec /bin/sh -c '";
  expect(cmd.startsWith(prefix), isTrue);
  expect(cmd.endsWith("'"), isTrue);
  return cmd.substring(prefix.length, cmd.length - 1);
}

void main() {
  group('startDir == null не меняет вывод', () {
    test('совпадает с вызовом без параметра для разных комбинаций', () {
      for (final socket in ['etty', '']) {
        for (final hooks in [true, false]) {
          expect(
            RemoteShellHooks.buildRemoteInitCommand(
              persistence: 'tmux',
              sessionName: 'sess1',
              hooks: hooks,
              socketName: socket,
              startDir: null,
            ),
            RemoteShellHooks.buildRemoteInitCommand(
              persistence: 'tmux',
              sessionName: 'sess1',
              hooks: hooks,
              socketName: socket,
            ),
          );
        }
      }
      for (final hooks in [true, false]) {
        expect(
          RemoteShellHooks.buildRemoteInitCommand(hooks: hooks, startDir: null),
          RemoteShellHooks.buildRemoteInitCommand(hooks: hooks),
        );
      }
    });

    test('без startDir нет -c и присваивания d перед new-session', () {
      final inner = _inner(_build());
      expect(inner.contains(' -c "'), isFalse);
      expect(inner.contains(r'd=$(printf'), isFalse);
    });
  });

  group('инвариант L0', () {
    for (final path in _paths) {
      for (final socket in ['etty', '']) {
        test('INNER без \' и ! для "$path" (socket="$socket")', () {
          final inner = _inner(_build(startDir: path, socketName: socket));
          expect(inner.contains("'"), isFalse);
          expect(inner.contains('!'), isFalse);
          expect(inner, contains(r'new-session -A -D -s "$n" -c "$d" '));
        });
      }
    }
  });

  group('кодирование', () {
    for (final path in _paths) {
      test('printf в реальном sh восстанавливает байты "$path"', () async {
        final inner = _inner(_build(startDir: path));
        final m = RegExp(r'd=\$\(printf "([^"]*)"\)').firstMatch(inner);
        expect(m, isNotNull);
        expect(RegExp(r'^[\\0-7]+$').hasMatch(m!.group(1)!), isTrue);
        final res = await Process.run('sh', [
          '-c',
          'd=\$(printf "${m.group(1)}"); printf "%s" "\$d"',
        ], stdoutEncoding: null);
        expect(res.exitCode, 0);
        expect(res.stdout as List<int>, utf8.encode(path));
      });
    }
  });

  group('невалидные значения', () {
    final bad = <String, String>{
      'относительный': 'a/b',
      'пустая': '',
      'с \\n': '/a\nb',
      'с \\r': '/a\rb',
      'с NUL': '/a\x00b',
    };
    bad.forEach((name, value) {
      test('$name -> ArgumentError', () {
        expect(() => _build(startDir: value), throwsArgumentError);
      });
    });

    test('startDir при persistence off -> ArgumentError', () {
      expect(() => RemoteShellHooks.buildRemoteInitCommand(startDir: '/home'), throwsArgumentError);
    });
  });

  group('end-to-end с фейковым tmux', () {
    test('tmux получает -c <path>', () async {
      final tmp = await Directory.systemTemp.createTemp('etty_startdir');
      addTearDown(() => tmp.delete(recursive: true));
      final bin = Directory('${tmp.path}/bin')..createSync();
      final home = Directory('${tmp.path}/home')..createSync();
      final out = File('${tmp.path}/args.txt');
      final fake = File('${bin.path}/tmux')
        ..writeAsStringSync(
          '#!/bin/sh\nfor a in "\$@"; do printf "%s\\n" "\$a" >> "${out.path}"; done\nexit 0\n',
        );
      await Process.run('chmod', ['+x', fake.path]);

      const path = "/it's a 50%/ёжик!";
      final res = await Process.run(
        'sh',
        ['-c', _build(startDir: path)],
        environment: {'HOME': home.path, 'SHELL': '/bin/sh', 'PATH': '${bin.path}:/usr/bin:/bin'},
        includeParentEnvironment: false,
      );
      expect(res.exitCode, 0, reason: '${res.stderr}');
      final args = const LineSplitter().convert(out.readAsStringSync());
      final i = args.indexOf('-c');
      expect(i, greaterThanOrEqualTo(0));
      expect(args[i + 1], path);
    });
  });
}
