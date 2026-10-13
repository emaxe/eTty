import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/config/quick_actions_config.dart';

int? sector(double dx, double dy, {double? radius}) => quickActionSectorAt(
      dx,
      dy,
      count: 5,
      deadZone: 34,
      radius: radius,
    );

void main() {
  group('quickActionSectorAt', () {
    test('мёртвая зона — null', () {
      expect(sector(0, 0), isNull);
      expect(sector(10, -20), isNull);
    });

    test('вверх — сектор 0, вправо-вверх — 1', () {
      expect(sector(0, -60), 0);
      expect(sector(60, -10), 1);
    });

    test('сектора идут по часовой стрелке', () {
      expect(sector(40, 50), 2);
      expect(sector(-40, 50), 3);
      expect(sector(-60, -10), 4);
    });

    test('границы: чуть левее/правее 12 часов остаются сектором 0', () {
      expect(sector(-10, -60), 0);
      expect(sector(10, -60), 0);
    });

    test('за радиусом — null только если радиус задан', () {
      expect(sector(0, -200), 0);
      expect(sector(0, -200, radius: QuickActionsConfig.radiusPx), isNull);
      expect(sector(0, -100, radius: QuickActionsConfig.radiusPx), 0);
    });

    test('у каждого действия есть данные, слэш-команды без Enter', () {
      for (final a in QuickActionsConfig.defaultActions) {
        if (a.kind == QuickActionKind.send) expect(a.data, isNotEmpty);
        if (a.data.startsWith('/')) expect(a.data.contains('\r'), isFalse);
      }
    });

    test('в колесе есть Esc и вложение файла', () {
      final byId = {for (final a in QuickActionsConfig.defaultActions) a.id: a};
      expect(byId['esc']!.data, '\x1b');
      expect(byId['ctrl-o']!.data, '\x0f');
      expect(byId['ctrl-d']!.data, '\x04');
      expect(byId['ctrl-l']!.data, '\x0c');
      expect(byId['attach']!.kind, QuickActionKind.attach);
    });

    test('каталог: уникальные id, содержит набор по умолчанию', () {
      final ids = [for (final a in QuickActionsConfig.catalog) a.id];
      expect(ids.toSet().length, ids.length);
      for (final a in QuickActionsConfig.defaultActions) {
        expect(ids, contains(a.id));
      }
    });
  });
}
