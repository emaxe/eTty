import 'package:flutter/material.dart';
import 'package:xterm/xterm.dart' as xterm;

import 'package:mobile/platform/system_clipboard.dart';

/// Сообщение пользователю из виджет-слоя терминала. `ScaffoldMessenger` может быть недоступен
/// (виджет вне `Scaffold`, юнит-тест) — тогда сообщение просто не показывается.
void showTerminalMessage(BuildContext context, String text) =>
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(text)));

/// «📋 Вставить»: текст из системного буфера → канал через `terminal.paste` (bracketed paste,
/// если приложение его включило). Пустой/недоступный буфер — сообщение, в канал ничего.
///
/// Вынесено из `TerminalGestureLayer`, потому что то же действие нужно панели плавающей кнопки и
/// её тапам: расхождение в поведении (снимать ли выделение, что писать при пустом буфере) было бы
/// багом, а не фичей.
Future<void> pasteFromClipboard(
  BuildContext context, {
  required xterm.Terminal terminal,
}) async {
  final text = await readSystemClipboard();
  if (!context.mounted) return;
  if (text == null || text.isEmpty) {
    showTerminalMessage(context, 'Буфер обмена пуст');
    return;
  }
  terminal.paste(text);
}

/// «⧉ Копировать»: выделение xterm → системный буфер. Без выделения — сообщение, буфер не трогаем.
/// Выделение снимается только после успешной записи: при отказе платформы оно остаётся, чтобы
/// пользователь мог повторить, а вместо ложного «Скопировано» показывается ошибка.
Future<void> copySelectionToClipboard(
  BuildContext context, {
  required xterm.Terminal terminal,
  required xterm.TerminalController controller,
}) async {
  final selection = controller.selection;
  final text = selection == null ? '' : terminal.buffer.getText(selection);
  if (text.isEmpty) {
    showTerminalMessage(context, 'Нет выделения: выделите текст long-press');
    return;
  }
  final written = await writeSystemClipboard(text);
  if (!context.mounted) return;
  if (!written) {
    showTerminalMessage(context, 'Не удалось записать в буфер обмена');
    return;
  }
  controller.clearSelection();
  showTerminalMessage(context, 'Скопировано: ${text.length} симв.');
}
