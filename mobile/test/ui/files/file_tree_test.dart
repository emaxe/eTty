import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/domain/ssh_fs_provider.dart';
import 'package:mobile/remote/remote_scripts.dart';
import 'package:mobile/transport/exec_channel.dart';
import 'package:mobile/ui/files/file_tree.dart';

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

/// Собирает NUL-разделённый вывод `readDirScript`/`readDirFallbackScript` — тот же формат, что
/// разбирает `RemoteParse.parseReadDir` (см. `test/domain/ssh_fs_provider_test.dart`): имена
/// каталогов, разделитель `\0`, имена файлов, всё терминировано `\0`.
Uint8List _readDirStdout({
  List<String> dirs = const [],
  List<String> files = const [],
}) {
  final buf = StringBuffer();
  for (final d in dirs) {
    buf.write(d);
    buf.write('\x00');
  }
  buf.write('\x00');
  for (final f in files) {
    buf.write(f);
    buf.write('\x00');
  }
  return _bytes(buf.toString());
}

/// Записывает каждый вызов и маршрутизирует ответ по скрипту — тот же паттерн, что
/// `_FakeRemoteExec` в `test/domain/ssh_fs_provider_test.dart` (сам `SshFsProvider` уже
/// протестирован там отдельно, здесь мокается только транспорт).
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

const _root = '/home/user';

SshFsProvider _provider(_FakeRemoteExec exec, {String root = _root}) =>
    SshFsProvider(exec: exec, root: root, statFlavorGnu: true, find0: true);

Widget _app(SshFsProvider provider, {String rootPath = _root}) {
  return MaterialApp(
    home: Scaffold(
      body: FileTree(provider: provider, rootPath: rootPath),
    ),
  );
}

void main() {
  testWidgets('корень грузится и показывает файлы/папки', (tester) async {
    final fake = _FakeRemoteExec()
      ..responder = (script, args) {
        if (script == RemoteScripts.readDirScript && args.first == _root) {
          return _ok(
            stdout: _readDirStdout(dirs: ['dir1'], files: ['file1.txt']),
          );
        }
        return _ok();
      };
    final provider = _provider(fake);

    await tester.pumpWidget(_app(provider));
    await tester.pumpAndSettle();

    expect(find.text('dir1'), findsOneWidget);
    expect(find.text('file1.txt'), findsOneWidget);

    provider.dispose();
  });

  testWidgets('раскрытие подкаталога делает ленивый readDir', (tester) async {
    final fake = _FakeRemoteExec()
      ..responder = (script, args) {
        if (script != RemoteScripts.readDirScript) return _ok();
        if (args.first == _root) {
          return _ok(stdout: _readDirStdout(dirs: ['dir1']));
        }
        if (args.first == '$_root/dir1') {
          return _ok(stdout: _readDirStdout(files: ['nested.txt']));
        }
        return _ok(stdout: _readDirStdout());
      };
    final provider = _provider(fake);

    await tester.pumpWidget(_app(provider));
    await tester.pumpAndSettle();

    expect(find.text('nested.txt'), findsNothing);
    expect(
      fake.calls.where((c) => c.script == RemoteScripts.readDirScript),
      hasLength(1),
    );

    await tester.tap(find.text('dir1'));
    await tester.pumpAndSettle();

    expect(find.text('nested.txt'), findsOneWidget);
    expect(
      fake.calls.where((c) => c.script == RemoteScripts.readDirScript),
      hasLength(2),
    );

    provider.dispose();
  });

  testWidgets('удаление файла вызывает provider.delete и убирает узел', (
    tester,
  ) async {
    var deleted = false;
    final fake = _FakeRemoteExec()
      ..responder = (script, args) {
        if (script == RemoteScripts.readDirScript) {
          return _ok(
            stdout: deleted
                ? _readDirStdout()
                : _readDirStdout(files: ['file1.txt']),
          );
        }
        if (script == RemoteScripts.deleteManyScript) {
          deleted = true;
          return _ok();
        }
        return _ok();
      };
    final provider = _provider(fake);

    await tester.pumpWidget(_app(provider));
    await tester.pumpAndSettle();
    expect(find.text('file1.txt'), findsOneWidget);

    await tester.longPress(find.text('file1.txt'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Удалить'));
    await tester.pumpAndSettle();
    // Диалог подтверждения — второй раз находим кнопку "Удалить" в AlertDialog.
    await tester.tap(find.text('Удалить'));
    await tester.pumpAndSettle();

    expect(deleted, isTrue);
    expect(find.text('file1.txt'), findsNothing);

    provider.dispose();
  });

  testWidgets('создание файла добавляет узел', (tester) async {
    var created = false;
    final fake = _FakeRemoteExec()
      ..responder = (script, args) {
        if (script == RemoteScripts.readDirScript) {
          return _ok(
            stdout: created
                ? _readDirStdout(files: ['new.txt'])
                : _readDirStdout(),
          );
        }
        if (script == RemoteScripts.createFileScript) {
          created = true;
          return _ok();
        }
        return _ok();
      };
    final provider = _provider(fake);

    await tester.pumpWidget(_app(provider));
    await tester.pumpAndSettle();
    expect(find.text('new.txt'), findsNothing);

    await tester.longPress(find.text('user')); // имя корневого узла
    await tester.pumpAndSettle();
    await tester.tap(find.text('Новый файл'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'new.txt');
    await tester.tap(find.text('Создать'));
    await tester.pumpAndSettle();

    expect(created, isTrue);
    expect(find.text('new.txt'), findsOneWidget);

    provider.dispose();
  });

  testWidgets(
    'ошибка SshFsException показывает сообщение, а не роняет виджет',
    (tester) async {
      final fake = _FakeRemoteExec()
        ..responder = (script, args) {
          if (script == RemoteScripts.readDirScript && args.first == _root) {
            return _ok(stdout: _readDirStdout(dirs: ['dir1']));
          }
          if (script == RemoteScripts.readDirScript) {
            return _fail(3); // notFound
          }
          return _ok();
        };
      final provider = _provider(fake);

      await tester.pumpWidget(_app(provider));
      await tester.pumpAndSettle();

      await tester.tap(find.text('dir1'));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('Путь не найден'), findsOneWidget);

      provider.dispose();
    },
  );
}
