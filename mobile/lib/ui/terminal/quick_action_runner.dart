import 'package:flutter/widgets.dart';
import 'package:xterm/xterm.dart' as xterm;

import 'package:mobile/core/config/quick_actions_config.dart';
import 'package:mobile/ui/terminal/clipboard_actions.dart';

/// Единая точка исполнения [QuickAction]: колесо по трём пальцам, панель плавающей кнопки и её
/// тапы обязаны трактовать виды действий одинаково — что считать «вставить», когда снимать
/// выделение, что делать без канала. Копия `switch` в трёх виджетах разъезжается при первом же
/// новом виде действия.
///
/// [write] — прямая инъекция байт в канал (как у `KeyBar`), мимо `terminal.onOutput`: это не
/// напечатанный пользователем текст.
Future<void> runQuickAction(
  BuildContext context,
  QuickAction action, {
  required xterm.Terminal terminal,
  required xterm.TerminalController controller,
  required void Function(String data) write,
  Future<void> Function()? onAttach,
}) async {
  switch (action.kind) {
    case QuickActionKind.send:
      write(action.data);
    case QuickActionKind.paste:
      await pasteFromClipboard(context, terminal: terminal);
    case QuickActionKind.copy:
      await copySelectionToClipboard(context, terminal: terminal, controller: controller);
    case QuickActionKind.attach:
      await onAttach?.call();
  }
}
