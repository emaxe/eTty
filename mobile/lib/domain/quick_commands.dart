import 'dart:convert';

import 'package:mobile/core/config/quick_actions_config.dart';

/// Пользовательская команда второго колеса: [text] вставляется в терминал без Enter.
class QuickCommand {
  const QuickCommand({required this.id, required this.label, required this.text});

  final String id;
  final String label;
  final String text;

  QuickCommand copyWith({String? label, String? text}) =>
      QuickCommand(id: id, label: label ?? this.label, text: text ?? this.text);

  Map<String, Object?> toJson() => {'id': id, 'label': label, 'text': text};
}

class QuickCommandGroup {
  const QuickCommandGroup({
    required this.id,
    required this.label,
    required this.commands,
  });

  final String id;
  final String label;
  final List<QuickCommand> commands;

  QuickCommandGroup copyWith({String? label, List<QuickCommand>? commands}) =>
      QuickCommandGroup(
        id: id,
        label: label ?? this.label,
        commands: commands ?? this.commands,
      );

  Map<String, Object?> toJson() => {
    'id': id,
    'label': label,
    'commands': [for (final c in commands) c.toJson()],
  };
}

/// Примеры по умолчанию — для Claude Code (на десктопе аналог: плоский список quickReplies).
abstract final class QuickCommandsDefaults {
  static const List<QuickCommandGroup> groups = [
    QuickCommandGroup(
      id: 'g-answers',
      label: 'Ответы',
      commands: [
        QuickCommand(id: 'c-ok', label: 'Ok', text: 'Ok'),
        QuickCommand(id: 'c-continue', label: 'Продолжай', text: 'Продолжай'),
        QuickCommand(id: 'c-yes', label: 'Да', text: 'Да'),
        QuickCommand(id: 'c-no', label: 'Нет', text: 'Нет'),
      ],
    ),
    QuickCommandGroup(
      id: 'g-commands',
      label: 'Команды',
      commands: [
        QuickCommand(id: 'c-clear', label: '/clear', text: '/clear'),
        QuickCommand(id: 'c-compact', label: '/compact', text: '/compact'),
        QuickCommand(id: 'c-model', label: '/model', text: '/model'),
        QuickCommand(id: 'c-resume', label: '/resume', text: '/resume'),
        QuickCommand(id: 'c-exit', label: '/exit', text: '/exit'),
      ],
    ),
    QuickCommandGroup(
      id: 'g-prompts',
      label: 'Промпты',
      commands: [
        QuickCommand(
          id: 'c-tests',
          label: 'Тесты',
          text: 'Запусти тесты и исправь ошибки',
        ),
        QuickCommand(
          id: 'c-review',
          label: 'Ревью',
          text: 'Сделай ревью изменений',
        ),
        QuickCommand(
          id: 'c-commit',
          label: 'Коммит',
          text: 'Закоммить изменения',
        ),
        QuickCommand(
          id: 'c-explain',
          label: 'Объясни',
          text: 'Объясни, что делает этот код',
        ),
      ],
    ),
  ];
}

String encodeQuickCommands(List<QuickCommandGroup> groups) =>
    jsonEncode([for (final g in groups) g.toJson()]);

/// `null` — JSON битый или структура неверна: вызывающая сторона берёт умолчания. Лишние
/// группы/команды сверх лимитов отбрасываются.
List<QuickCommandGroup>? decodeQuickCommands(String? json) {
  if (json == null || json.isEmpty) return null;
  try {
    final raw = jsonDecode(json);
    if (raw is! List) return null;
    final groups = <QuickCommandGroup>[];
    for (final g in raw.take(QuickActionsConfig.maxGroups)) {
      if (g is! Map) return null;
      final id = g['id'];
      final label = g['label'];
      final cmds = g['commands'];
      if (id is! String || label is! String || cmds is! List) return null;
      final commands = <QuickCommand>[];
      for (final c in cmds.take(QuickActionsConfig.maxCommandsPerGroup)) {
        if (c is! Map) return null;
        final cid = c['id'];
        final clabel = c['label'];
        final text = c['text'];
        if (cid is! String || clabel is! String || text is! String) return null;
        commands.add(QuickCommand(id: cid, label: clabel, text: text));
      }
      groups.add(QuickCommandGroup(id: id, label: label, commands: commands));
    }
    return groups;
  } on FormatException {
    return null;
  }
}
