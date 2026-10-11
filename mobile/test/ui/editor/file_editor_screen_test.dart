import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:re_editor/re_editor.dart';

import 'package:mobile/domain/ssh_fs_provider.dart';
import 'package:mobile/remote/remote_scripts.dart';
import 'package:mobile/transport/exec_channel.dart';
import 'package:mobile/ui/editor/file_editor_screen.dart';

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

/// Записывает каждый вызов и маршрутизирует ответ по скрипту — тот же паттерн, что
/// `_FakeRemoteExec` в `test/domain/ssh_fs_provider_test.dart`/`test/ui/files/file_tree_test.dart`
/// (сам `SshFsProvider` уже протестирован там отдельно, здесь мокается только транспорт).
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

const _root = '/home/user';
const _path = '$_root/main.dart';

SshFsProvider _provider(_FakeRemoteExec exec) =>
    SshFsProvider(exec: exec, root: _root, statFlavorGnu: true, find0: true);

Widget _app(SshFsProvider provider, {String path = _path}) {
  return MaterialApp(
    home: FileEditorScreen(provider: provider, path: path),
  );
}

void main() {
  testWidgets('файл загружается и показывается в редакторе', (tester) async {
    final fake = _FakeRemoteExec()
      ..responder = (script, args) {
        if (script == RemoteScripts.readFileScript) {
          expect(args.first, _path);
          return _ok(stdout: _bytes('void main() {}'));
        }
        return _ok();
      };
    final provider = _provider(fake);

    await tester.pumpWidget(_app(provider));
    await tester.pumpAndSettle();

    expect(find.byType(CircularProgressIndicator), findsNothing);
    final editor = tester.widget<CodeEditor>(find.byType(CodeEditor));
    expect(editor.controller!.text, 'void main() {}');
    // Индикатор несохранённых изменений не показан — файл только что загружен.
    expect(find.text('●'), findsNothing);

    provider.dispose();
  });

  testWidgets('сохранение вызывает writeFile с изменённым текстом', (
    tester,
  ) async {
    final fake = _FakeRemoteExec()
      ..responder = (script, args) {
        if (script == RemoteScripts.readFileScript) {
          return _ok(stdout: _bytes('old'));
        }
        if (script == RemoteScripts.writeFileScript) {
          return _ok();
        }
        return _ok();
      };
    final provider = _provider(fake);

    await tester.pumpWidget(_app(provider));
    await tester.pumpAndSettle();

    final editor = tester.widget<CodeEditor>(find.byType(CodeEditor));
    editor.controller!.text = 'new';
    await tester.pumpAndSettle();

    // Индикатор несохранённых изменений появился, кнопка сохранения активна.
    expect(find.text('●'), findsOneWidget);
    final saveButton = tester.widget<IconButton>(
      find.widgetWithIcon(IconButton, Icons.save),
    );
    expect(saveButton.onPressed, isNotNull);

    await tester.tap(find.byIcon(Icons.save));
    await tester.pumpAndSettle();

    final writeCall = fake.calls.singleWhere(
      (c) => c.script == RemoteScripts.writeFileScript,
    );
    expect(writeCall.args, [_path]);
    expect(utf8.decode(writeCall.stdin!), 'new');
    expect(find.text('●'), findsNothing);

    provider.dispose();
  });

  testWidgets(
    'ошибка tooLarge показывает понятный экран вместо пустого редактора',
    (tester) async {
      final fake = _FakeRemoteExec()
        ..responder = (script, args) {
          if (script == RemoteScripts.readFileScript) {
            return _fail(9, stderr: '2097152');
          }
          return _ok();
        };
      final provider = _provider(fake);

      await tester.pumpWidget(_app(provider));
      await tester.pumpAndSettle();

      expect(find.byType(CodeEditor), findsNothing);
      expect(find.textContaining('слишком больш'), findsOneWidget);
      expect(find.textContaining('2.0 МБ'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Назад'), findsOneWidget);

      provider.dispose();
    },
  );

  testWidgets('ошибка notFound показывает сообщение, не роняет виджет', (
    tester,
  ) async {
    final fake = _FakeRemoteExec()
      ..responder = (script, args) {
        if (script == RemoteScripts.readFileScript) {
          return _fail(2);
        }
        return _ok();
      };
    final provider = _provider(fake);

    await tester.pumpWidget(_app(provider));
    await tester.pumpAndSettle();

    expect(find.byType(CodeEditor), findsNothing);
    expect(find.text('Путь не найден'), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, 'Назад'), findsOneWidget);
    expect(tester.takeException(), isNull);

    provider.dispose();
  });
}
