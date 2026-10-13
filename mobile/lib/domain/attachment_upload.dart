import 'dart:math';
import 'dart:typed_data';

import 'package:mobile/core/config/attachment_config.dart';
import 'package:mobile/core/config/ssh_fs_config.dart';
import 'package:mobile/remote/remote_scripts.dart';
import 'package:mobile/transport/exec_channel.dart';

class AttachmentUploadException implements Exception {
  const AttachmentUploadException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Имя файла на сервере: без `/`, пробелов и спецсимволов, с уникальным префиксом, чтобы повторная
/// загрузка одноимённого файла не затирала предыдущий.
String attachmentRemoteName(String original, {DateTime? now, Random? random}) {
  var base = original.split(RegExp(r'[/\\]')).last;
  base = base.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_').replaceAll(RegExp(r'^\.+'), '');
  if (base.isEmpty) base = 'file';
  if (base.length > AttachmentConfig.maxNameLength) {
    base = base.substring(base.length - AttachmentConfig.maxNameLength);
  }
  final ms = (now ?? DateTime.now()).millisecondsSinceEpoch;
  final hex = (random ?? Random()).nextInt(0x10000).toRadixString(16).padLeft(4, '0');
  return '$ms-$hex-$base';
}

/// Заливает [bytes] в `${TMPDIR:-/tmp}/etty-paste/` на сервере (скрипт общий с десктопным
/// вставлением картинки) и возвращает абсолютный путь файла.
Future<String> uploadAttachment(
  RemoteExec exec,
  String originalName,
  Uint8List bytes,
) async {
  if (bytes.isEmpty) {
    throw const AttachmentUploadException('Файл пустой');
  }
  if (bytes.length > AttachmentConfig.maxBytes) {
    throw AttachmentUploadException(
      'Файл больше ${AttachmentConfig.maxBytes ~/ (1024 * 1024)} МБ',
    );
  }
  final result = await exec.exec(
    RemoteScripts.uploadPasteImageScript,
    [attachmentRemoteName(originalName)],
    stdin: bytes,
    timeout: const Duration(milliseconds: SshFsConfig.ioTimeoutMs),
  );
  if (result.timedOut) {
    throw const AttachmentUploadException('Время загрузки истекло');
  }
  if (result.error != null) {
    throw AttachmentUploadException('Ошибка соединения: ${result.error}');
  }
  if (result.exitCode != 0) {
    throw AttachmentUploadException('Сервер не принял файл (код ${result.exitCode})');
  }
  final path = String.fromCharCodes(result.stdout).trim();
  if (path.isEmpty) {
    throw const AttachmentUploadException('Сервер не вернул путь к файлу');
  }
  return path;
}
