import 'dart:math';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/config/attachment_config.dart';
import 'package:mobile/domain/attachment_upload.dart';
import 'package:mobile/remote/remote_scripts.dart';
import 'package:mobile/transport/exec_channel.dart';

class _FakeExec implements RemoteExec {
  _FakeExec(this.result);
  final ExecResult result;
  String? script;
  List<String>? args;
  Uint8List? stdin;
  int calls = 0;

  @override
  Future<ExecResult> exec(
    String script,
    List<String> args, {
    Uint8List? stdin,
    Duration timeout = const Duration(seconds: 15),
    int maxBufferBytes = 8 * 1024 * 1024,
  }) async {
    calls++;
    this.script = script;
    this.args = args;
    this.stdin = stdin;
    return result;
  }
}

ExecResult _ok(String path) => ExecResult(
  exitCode: 0,
  stdout: Uint8List.fromList(path.codeUnits),
  stderr: Uint8List(0),
  timedOut: false,
);

void main() {
  group('attachmentRemoteName', () {
    test('убирает путь и спецсимволы, добавляет уникальный префикс', () {
      final name = attachmentRemoteName(
        '/storage/DCIM/my photo (1).png',
        now: DateTime.fromMillisecondsSinceEpoch(1000),
        random: Random(1),
      );
      expect(name, matches(RegExp(r'^1000-[0-9a-f]{4}-my_photo__1_\.png$')));
      expect(name.contains('/'), isFalse);
    });

    test('пустое имя и ведущие точки не дают скрытый/пустой файл', () {
      expect(attachmentRemoteName('..'), endsWith('-file'));
      expect(attachmentRemoteName('.env'), endsWith('-env'));
    });

    test('длинное имя обрезается', () {
      final name = attachmentRemoteName('${'a' * 300}.png');
      expect(name.length, lessThan(AttachmentConfig.maxNameLength + 30));
      expect(name, endsWith('.png'));
    });
  });

  group('uploadAttachment', () {
    test('шлёт скрипт, имя аргументом и байты в stdin, возвращает путь', () async {
      final exec = _FakeExec(_ok('/tmp/etty-paste/x.png\n'));
      final bytes = Uint8List.fromList([1, 2, 3]);

      final path = await uploadAttachment(exec, 'x.png', bytes);

      expect(path, '/tmp/etty-paste/x.png');
      expect(exec.script, RemoteScripts.uploadPasteImageScript);
      expect(exec.args!.single, endsWith('-x.png'));
      expect(exec.stdin, bytes);
    });

    test('ненулевой код — исключение', () {
      final exec = _FakeExec(
        ExecResult(exitCode: 1, stdout: Uint8List(0), stderr: Uint8List(0), timedOut: false),
      );
      expect(
        uploadAttachment(exec, 'x', Uint8List.fromList([1])),
        throwsA(isA<AttachmentUploadException>()),
      );
    });

    test('таймаут и пустой путь — исключение', () async {
      final timedOut = _FakeExec(
        ExecResult(stdout: Uint8List(0), stderr: Uint8List(0), timedOut: true),
      );
      await expectLater(
        uploadAttachment(timedOut, 'x', Uint8List.fromList([1])),
        throwsA(isA<AttachmentUploadException>()),
      );
      final empty = _FakeExec(_ok('  '));
      await expectLater(
        uploadAttachment(empty, 'x', Uint8List.fromList([1])),
        throwsA(isA<AttachmentUploadException>()),
      );
    });

    test('пустой и слишком большой файл не доходят до exec', () async {
      final exec = _FakeExec(_ok('/p'));
      await expectLater(
        uploadAttachment(exec, 'x', Uint8List(0)),
        throwsA(isA<AttachmentUploadException>()),
      );
      await expectLater(
        uploadAttachment(exec, 'x', Uint8List(AttachmentConfig.maxBytes + 1)),
        throwsA(isA<AttachmentUploadException>()),
      );
      expect(exec.calls, 0);
    });
  });
}
