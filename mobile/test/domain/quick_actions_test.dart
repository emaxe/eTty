import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/config/quick_actions_config.dart';
import 'package:mobile/domain/quick_actions.dart';

void main() {
  group('encode/decode', () {
    test('round-trip набора по умолчанию', () {
      final decoded = decodeQuickActions(encodeQuickActions(QuickActionsConfig.defaultActions));
      expect(decoded, isNotNull);
      expect(
        [for (final a in decoded!) a.id],
        [for (final a in QuickActionsConfig.defaultActions) a.id],
      );
      expect(decoded[1].data, '\x1b');
      expect(decoded.last.kind, QuickActionKind.attach);
    });

    test('битый JSON, неверная структура и неизвестный kind -> null', () {
      expect(decodeQuickActions(null), isNull);
      expect(decodeQuickActions(''), isNull);
      expect(decodeQuickActions('{'), isNull);
      expect(decodeQuickActions('{}'), isNull);
      expect(decodeQuickActions('[{"id":"a"}]'), isNull);
      expect(decodeQuickActions('[{"id":"a","label":"A","kind":"boom","data":""}]'), isNull);
    });

    test('лишние действия отбрасываются', () {
      final many = [for (var i = 0; i < 12; i++) QuickAction(id: 'a$i', label: '$i', data: 'x')];
      expect(decodeQuickActions(encodeQuickActions(many))!.length, QuickActionsConfig.maxActions);
    });

    test('пустой список — валидный выбор пользователя', () {
      expect(decodeQuickActions('[]'), isEmpty);
    });
  });

  group('parseKeySequence', () {
    test('Ctrl+буква и escape-последовательности', () {
      expect(parseKeySequence('^C'), '\x03');
      expect(parseKeySequence('^r'), '\x12');
      expect(parseKeySequence(r'\e[A'), '\x1b[A');
      expect(parseKeySequence(r'\x1b'), '\x1b');
      expect(parseKeySequence(r'ls\r'), 'ls\r');
      expect(parseKeySequence(r'\t\n'), '\t\n');
      expect(parseKeySequence(r'\^\\'), '^\\');
    });

    test('ошибки: пусто, висящий ^ или \\, неверный hex и управляющая', () {
      expect(parseKeySequence(''), isNull);
      expect(parseKeySequence('^'), isNull);
      expect(parseKeySequence('^1'), isNull);
      expect(parseKeySequence(r'\'), isNull);
      expect(parseKeySequence(r'\q'), isNull);
      expect(parseKeySequence(r'\x1'), isNull);
      expect(parseKeySequence(r'\xzz'), isNull);
    });
  });

  group('formatKeySequence', () {
    test('обратимо с parseKeySequence', () {
      for (final data in ['\x03', '\x1b[A', '\x1b[Z', '\r', '\t', 'a^b\\c', '\x7f', 'ls\r']) {
        expect(parseKeySequence(formatKeySequence(data)), data);
      }
      expect(formatKeySequence('\x03'), '^C');
      expect(formatKeySequence('\x1b[A'), r'\e[A');
    });
  });
}
