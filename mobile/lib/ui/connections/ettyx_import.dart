import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:mobile/app/providers/connection_providers.dart';
import 'package:mobile/data/connection_export.dart';

/// Импорт `*.ettyx` (задача #32, REQ-23): системный file picker → парольная фраза → расшифровка
/// (`connection_export.dart`) → upsert каждого профиля + его секретов через [connectionsProvider]
/// (обычный CRUD-путь, задача #21 — импорт не заводит отдельного хранилища). Возвращает тихо
/// (`return`), если пользователь отменил выбор файла или ввод пароля — это не ошибка.
Future<void> importEttyxFile(BuildContext context, WidgetRef ref) async {
  final file = await FilePicker.pickFile(
    type: FileType.custom,
    allowedExtensions: ['ettyx'],
    dialogTitle: 'Импорт подключений',
  );
  if (file == null) return;

  final String fileContents;
  try {
    fileContents = utf8.decode(await file.readAsBytes());
  } catch (error) {
    if (!context.mounted) return;
    await _showResultDialog(context, title: 'Не удалось прочитать файл', body: '$error');
    return;
  }

  if (!context.mounted) return;
  final passphrase = await _promptPassphrase(context);
  if (passphrase == null) return;

  final EttyxImportResult result;
  try {
    result = await decryptEttyxFile(fileContents, passphrase);
  } on EttyxDecryptException catch (error) {
    if (!context.mounted) return;
    await _showResultDialog(context, title: 'Импорт не удался', body: error.message);
    return;
  }

  final notifier = ref.read(connectionsProvider.notifier);
  for (final imported in result.connections) {
    await notifier.upsert(imported.profile);
    await notifier.saveSecrets(imported.profile.id, imported.secrets);
  }

  if (!context.mounted) return;
  final count = result.connections.length;
  await _showResultDialog(
    context,
    title: 'Импортировано $count ${_pluralConnections(count)}',
    body: result.warnings.isEmpty ? null : result.warnings.join('\n\n'),
  );
}

Future<String?> _promptPassphrase(BuildContext context) {
  final controller = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Парольная фраза'),
      content: TextField(
        controller: controller,
        obscureText: true,
        autofocus: true,
        decoration: const InputDecoration(hintText: 'Парольная фраза экспорта'),
        onSubmitted: (value) => Navigator.of(context).pop(value),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Отмена'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(controller.text),
          child: const Text('Импортировать'),
        ),
      ],
    ),
  );
}

Future<void> _showResultDialog(
  BuildContext context, {
  required String title,
  String? body,
}) {
  return showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: body == null ? null : Text(body),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('ОК'),
        ),
      ],
    ),
  );
}

String _pluralConnections(int count) {
  final mod10 = count % 10;
  final mod100 = count % 100;
  if (mod10 == 1 && mod100 != 11) return 'подключение';
  if ([2, 3, 4].contains(mod10) && ![12, 13, 14].contains(mod100)) {
    return 'подключения';
  }
  return 'подключений';
}
