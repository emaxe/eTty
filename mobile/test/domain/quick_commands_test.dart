import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/config/quick_actions_config.dart';
import 'package:mobile/domain/quick_commands.dart';

void main() {
  group('quick commands JSON', () {
    test('умолчания переживают encode/decode', () {
      final decoded = decodeQuickCommands(
        encodeQuickCommands(QuickCommandsDefaults.groups),
      )!;
      expect(decoded.map((g) => g.label), ['Ответы', 'Команды', 'Промпты']);
      expect(decoded[1].commands.map((c) => c.text), [
        '/clear',
        '/compact',
        '/model',
        '/resume',
        '/exit',
      ]);
    });

    test('null, пустая строка и битый JSON — null (берутся умолчания)', () {
      expect(decodeQuickCommands(null), isNull);
      expect(decodeQuickCommands(''), isNull);
      expect(decodeQuickCommands('{oops'), isNull);
      expect(decodeQuickCommands('{"a":1}'), isNull);
    });

    test('неверные поля — null', () {
      expect(decodeQuickCommands('[{"id":"g","label":"x"}]'), isNull);
      expect(
        decodeQuickCommands('[{"id":"g","label":"x","commands":[{"id":1}]}]'),
        isNull,
      );
    });

    test('лишние группы и команды обрезаются по лимитам', () {
      final groups = [
        for (var i = 0; i < QuickActionsConfig.maxGroups + 3; i++)
          QuickCommandGroup(
            id: 'g$i',
            label: 'G$i',
            commands: [
              for (var j = 0; j < QuickActionsConfig.maxCommandsPerGroup + 2; j++)
                QuickCommand(id: 'c$j', label: 'C$j', text: 't$j'),
            ],
          ),
      ];
      final decoded = decodeQuickCommands(encodeQuickCommands(groups))!;
      expect(decoded.length, QuickActionsConfig.maxGroups);
      expect(decoded.first.commands.length, QuickActionsConfig.maxCommandsPerGroup);
    });

    test('умолчания укладываются в лимиты и не содержат Enter', () {
      expect(QuickCommandsDefaults.groups.length, lessThanOrEqualTo(QuickActionsConfig.maxGroups));
      for (final g in QuickCommandsDefaults.groups) {
        expect(g.commands.length, lessThanOrEqualTo(QuickActionsConfig.maxCommandsPerGroup));
        for (final c in g.commands) {
          expect(c.text.contains('\r') || c.text.contains('\n'), isFalse);
        }
      }
    });
  });
}
