import 'package:flutter/material.dart';

Future<bool> confirmDialog(BuildContext context, String title, String body) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Text(body),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Отмена')),
        FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Да')),
      ],
    ),
  );
  return result ?? false;
}

Future<String?> promptTextDialog(
  BuildContext context,
  String title,
  String hint, {
  String initial = '',
}) {
  final controller = TextEditingController(text: initial);
  return showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: TextField(
        controller: controller,
        autofocus: true,
        decoration: InputDecoration(labelText: hint),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Отмена')),
        FilledButton(
          onPressed: () {
            final value = controller.text.trim();
            Navigator.pop(context, value.isEmpty ? null : value);
          },
          child: const Text('Сохранить'),
        ),
      ],
    ),
  );
}
