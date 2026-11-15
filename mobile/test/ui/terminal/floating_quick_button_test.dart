import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/config/floating_button_config.dart';
import 'package:mobile/domain/floating_button.dart';
import 'package:mobile/ui/terminal/floating_quick_button.dart';

final Finder _button = find.byKey(const Key('floating-quick-button'));

void main() {
  late int taps;
  late int doubleTaps;
  late int longPresses;
  late List<(double, double)> moves;

  setUp(() {
    taps = 0;
    doubleTaps = 0;
    longPresses = 0;
    moves = [];
  });

  /// Экран 400 × 800: пробег кнопки по X — 400 − 48 − 2·8 = 336, по Y — 800 − 48 − 16 = 736.
  Future<void> pump(
    WidgetTester tester, {
    FloatingButtonSettings? settings,
  }) async {
    await tester.binding.setSurfaceSize(const Size(400, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: FloatingQuickButton(
            settings: settings ?? const FloatingButtonSettings(),
            onTap: () => taps++,
            onDoubleTap: () => doubleTaps++,
            onLongPress: () => longPresses++,
            onMoved: (x, y) => moves.add((x, y)),
          ),
        ),
      ),
    );
  }

  testWidgets('позиция из настроек: (1.0, 0.74) — правый край, нижняя треть', (
    tester,
  ) async {
    await pump(tester);

    expect(tester.getTopLeft(_button), const Offset(344, 552.64));
  });

  testWidgets('одиночный тап срабатывает после окна двойного тапа', (
    tester,
  ) async {
    await pump(tester);

    await tester.tap(_button);
    expect(taps, 0, reason: 'до истечения окна действие не отправляется');
    await tester.pump(const Duration(milliseconds: 350));

    expect(taps, 1);
    expect(doubleTaps, 0);
  });

  testWidgets('двойной тап выполняет только своё действие', (tester) async {
    await pump(tester);

    await tester.tap(_button);
    await tester.pump(const Duration(milliseconds: 60));
    await tester.tap(_button);
    await tester.pumpAndSettle();

    expect(doubleTaps, 1);
    expect(taps, 0);
  });

  testWidgets('долгое нажатие открывает меню, а не тап', (tester) async {
    await pump(tester);

    await tester.longPress(_button);
    await tester.pumpAndSettle();

    expect(longPresses, 1);
    expect(taps, 0);
    expect(doubleTaps, 0);
  });

  testWidgets(
    'перетаскивание отдаёт нормализованную позицию и не считается тапом',
    (tester) async {
      await pump(tester);

      await tester.drag(_button, const Offset(-100, -200));
      await tester.pumpAndSettle();

      expect(taps, 0);
      expect(moves, hasLength(1));
      // Точное смещение зависит от порога распознавания жеста (первые 10-20 px съедаются), поэтому
      // проверяем, что кнопка уехала вверх-влево примерно на столько, сколько провели пальцем.
      expect(moves.single.$1, closeTo((344 - 100 - 8) / 336, 0.06));
      expect(moves.single.$2, closeTo((552.64 - 200 - 8) / 736, 0.06));

      // Кнопка осталась там, где её отпустили: запись настроек асинхронная, и прыжок назад к
      // старой позиции выглядел бы как «перетаскивание не сработало».
      final topLeft = tester.getTopLeft(_button);
      expect(topLeft.dx, closeTo(244, 25));
      expect(topLeft.dy, closeTo(352.64, 25));
      expect(moves.single.$1, closeTo((topLeft.dx - 8) / 336, 0.001));
      expect(moves.single.$2, closeTo((topLeft.dy - 8) / 736, 0.001));
    },
  );

  testWidgets('после сохранения настроек кнопка стоит по сохранённой позиции', (
    tester,
  ) async {
    await pump(tester);
    await tester.drag(_button, const Offset(-100, -200));
    await tester.pumpAndSettle();
    final dropped = moves.single;

    // Родитель сохранил ровно то, что отдала кнопка, — позиция не должна измениться (никакого
    // «дрожания» на стыке локального состояния и настроек).
    await pump(
      tester,
      settings: FloatingButtonSettings(
        positionX: dropped.$1,
        positionY: dropped.$2,
      ),
    );
    final confirmed = tester.getTopLeft(_button);
    expect(confirmed.dx, closeTo(244, 25));
    expect(confirmed.dy, closeTo(352.64, 25));

    // Настройки поменялись извне (сброс, поворот) — теперь командует уже они.
    await pump(
      tester,
      settings: const FloatingButtonSettings(positionX: 0, positionY: 0),
    );
    expect(tester.getTopLeft(_button), const Offset(8, 8));
  });

  testWidgets('перетаскивание за границу зажимается в 0..1', (tester) async {
    // Кнопка уже на правом краю — тянуть дальше вправо некуда.
    await pump(tester);
    await tester.drag(_button, const Offset(30, 0));
    await tester.pumpAndSettle();
    expect(moves.single.$1, 1.0);
    expect(tester.getTopLeft(_button).dx, 344);

    // Левый верхний угол — тянуть дальше влево тоже некуда.
    await pump(
      tester,
      settings: const FloatingButtonSettings(positionX: 0, positionY: 0),
    );
    await tester.drag(_button, const Offset(-30, 0));
    await tester.pumpAndSettle();
    expect(moves.last.$1, 0.0);
    expect(tester.getTopLeft(_button).dx, 8);
  });

  testWidgets(
    'позиция из настроек за пределами 0..1 не выносит кнопку за край',
    (tester) async {
      await pump(
        tester,
        settings: const FloatingButtonSettings(positionX: 1.5, positionY: -3),
      );

      expect(tester.getTopLeft(_button), const Offset(344, 8));
    },
  );

  testWidgets('касание мимо кнопки не срабатывает', (tester) async {
    await pump(tester);

    await tester.tapAt(const Offset(40, 40));
    await tester.pump(const Duration(milliseconds: 350));

    expect(taps, 0);
    expect(doubleTaps, 0);
    expect(longPresses, 0);
    expect(moves, isEmpty);
  });

  testWidgets('на узкой области кнопка прижимается к отступу, а не уезжает', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(60, 60));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: FloatingQuickButton(
            settings: const FloatingButtonSettings(),
            onTap: () {},
            onDoubleTap: () {},
            onLongPress: () {},
            onMoved: (_, _) {},
          ),
        ),
      ),
    );

    expect(
      tester.getTopLeft(_button),
      const Offset(
        FloatingButtonConfig.marginPx,
        FloatingButtonConfig.marginPx,
      ),
    );
  });
}
