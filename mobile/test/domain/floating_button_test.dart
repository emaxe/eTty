import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/config/floating_button_config.dart';
import 'package:mobile/core/config/quick_actions_config.dart';
import 'package:mobile/domain/floating_button.dart';

void main() {
  group('FloatingButtonConfig', () {
    test('умолчания: включена, правый край, ⇧⏎ и вставка на тапах', () {
      final defaults = const FloatingButtonSettings();

      expect(defaults.enabled, isTrue);
      expect(defaults.positionX, FloatingButtonConfig.defaultPositionX);
      expect(defaults.positionY, FloatingButtonConfig.defaultPositionY);
      expect(defaults.tapAction.data, '\x1b[13;2u');
      expect(defaults.tapAction.kind, QuickActionKind.send);
      expect(defaults.doubleTapAction.kind, QuickActionKind.paste);
      expect([for (final a in defaults.actions) a.label], [
        '⇧⏎',
        '^C',
        'Esc',
        'Tab',
        '^D',
        '^L',
        '📋 Вставить',
        '⧉ Копировать',
        '📎 Файл',
      ]);
    });

    test('каталог кнопки: буфер есть, у колеса его нет (REQ-22)', () {
      final buttonKinds = {for (final a in FloatingButtonConfig.catalog) a.kind};
      final wheelKinds = {for (final a in QuickActionsConfig.catalog) a.kind};

      expect(buttonKinds, contains(QuickActionKind.paste));
      expect(buttonKinds, contains(QuickActionKind.copy));
      expect(wheelKinds, isNot(contains(QuickActionKind.paste)));
      expect(wheelKinds, isNot(contains(QuickActionKind.copy)));
    });

    test('все элементы по умолчанию есть в каталоге — редактор не предложит дубли', () {
      final catalogIds = {for (final a in FloatingButtonConfig.catalog) a.id};
      for (final action in FloatingButtonConfig.defaultActions) {
        expect(catalogIds, contains(action.id), reason: action.label);
      }
      expect(catalogIds, contains(FloatingButtonConfig.defaultTapAction.id));
      expect(catalogIds, contains(FloatingButtonConfig.defaultDoubleTapAction.id));
    });
  });

  group('encode/decode', () {
    test('round-trip сохраняет флаг, позицию, тапы и список', () {
      final settings = const FloatingButtonSettings().copyWith(
        enabled: false,
        positionX: 0.25,
        positionY: 0.5,
        actions: const [
          QuickAction(id: 'ctrl-c', label: '^C', data: '\x03'),
          QuickAction(id: 'copy', label: '⧉ Копировать', kind: QuickActionKind.copy),
        ],
      );

      final decoded = decodeFloatingButton(encodeFloatingButton(settings));

      expect(decoded, isNotNull);
      expect(decoded!.enabled, isFalse);
      expect(decoded.positionX, 0.25);
      expect(decoded.positionY, 0.5);
      expect(decoded.tapAction.id, settings.tapAction.id);
      expect(decoded.doubleTapAction.id, settings.doubleTapAction.id);
      expect([for (final a in decoded.actions) a.kind], [
        QuickActionKind.send,
        QuickActionKind.copy,
      ]);
    });

    test('битый JSON, неверные типы и неизвестный вид действия -> null', () {
      expect(decodeFloatingButton(null), isNull);
      expect(decodeFloatingButton(''), isNull);
      expect(decodeFloatingButton('{'), isNull);
      expect(decodeFloatingButton('[]'), isNull);
      expect(decodeFloatingButton('{"enabled":true}'), isNull);
      expect(
        decodeFloatingButton(
          '{"enabled":true,"x":0.5,"y":0.5,"tap":{"id":"a","label":"A","kind":"boom","data":""},'
          '"doubleTap":{"id":"a","label":"A","kind":"send","data":""},"actions":[]}',
        ),
        isNull,
      );
      expect(
        decodeFloatingButton(
          '{"enabled":true,"x":0.5,"y":0.5,"tap":{"id":"a","label":"A","kind":"send","data":""},'
          '"doubleTap":{"id":"a","label":"A","kind":"send","data":""},"actions":{}}',
        ),
        isNull,
      );
    });

    test('координаты вне 0..1 зажимаются, а не роняют настройки', () {
      final decoded = decodeFloatingButton(
        '{"enabled":true,"x":1.7,"y":-0.4,'
        '"tap":{"id":"t","label":"T","kind":"send","data":"\\u0003"},'
        '"doubleTap":{"id":"d","label":"D","kind":"paste","data":""},"actions":[]}',
      );

      expect(decoded, isNotNull);
      expect(decoded!.positionX, 1.0);
      expect(decoded.positionY, 0.0);
      expect(decoded.actions, isEmpty);
    });

    test('список не ограничен восемью элементами', () {
      final many = [
        for (var i = 0; i < 12; i++) QuickAction(id: 'a$i', label: '$i', data: 'x'),
      ];
      final decoded = decodeFloatingButton(
        encodeFloatingButton(const FloatingButtonSettings().copyWith(actions: many)),
      );

      expect(decoded!.actions.length, 12);
    });
  });
}
