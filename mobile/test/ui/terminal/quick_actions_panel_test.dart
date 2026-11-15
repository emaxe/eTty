import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/config/floating_button_config.dart';
import 'package:mobile/core/config/quick_actions_config.dart';
import 'package:mobile/ui/terminal/quick_actions_panel.dart';

void main() {
  late List<QuickAction> actioned;
  late int closed;

  setUp(() {
    actioned = [];
    closed = 0;
  });

  Future<void> pump(
    WidgetTester tester, {
    List<QuickAction>? actions,
    Size size = const Size(400, 800),
  }) async {
    await tester.binding.setSurfaceSize(size);
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              QuickActionsPanel(
                actions: actions ?? FloatingButtonConfig.defaultActions,
                onAction: actioned.add,
                onClose: () => closed++,
              ),
            ],
          ),
        ),
      ),
    );
  }

  testWidgets('показывает все элементы списка по умолчанию', (tester) async {
    await pump(tester);

    for (final action in FloatingButtonConfig.defaultActions) {
      expect(find.text(action.label), findsOneWidget, reason: action.label);
    }
  });

  testWidgets('тап по элементу выполняет действие и закрывает панель', (tester) async {
    await pump(tester);

    await tester.tap(find.byKey(const Key('panel-action-ctrl-c')));
    await tester.pumpAndSettle();

    expect(actioned.map((a) => a.data), ['\x03']);
    expect(closed, 1);
  });

  testWidgets('тап мимо панели закрывает её и ничего не выполняет', (tester) async {
    await pump(tester);

    await tester.tap(find.byKey(const Key('quick-actions-panel-barrier')));
    await tester.pumpAndSettle();

    expect(actioned, isEmpty);
    expect(closed, 1);
  });

  testWidgets('кнопка закрытия закрывает панель', (tester) async {
    await pump(tester);

    await tester.tap(find.byKey(const Key('quick-actions-panel-close')));
    await tester.pumpAndSettle();

    expect(closed, 1);
    expect(actioned, isEmpty);
  });

  testWidgets('длинный список прокручивается и не переполняет панель', (tester) async {
    await pump(
      tester,
      size: const Size(360, 400),
      actions: [
        for (var i = 0; i < 12; i++)
          QuickAction(id: 'a$i', label: 'Действие $i', data: 'x'),
      ],
    );

    expect(tester.takeException(), isNull);
    expect(find.byType(SingleChildScrollView), findsOneWidget);
    expect(find.text('Действие 0'), findsOneWidget);
  });

  testWidgets('панель не выше своей доли экрана', (tester) async {
    await pump(
      tester,
      size: const Size(360, 400),
      actions: [
        for (var i = 0; i < 12; i++)
          QuickAction(id: 'a$i', label: 'Действие $i', data: 'x'),
      ],
    );

    final panel = tester.getSize(find.byKey(const Key('quick-actions-panel')));
    expect(panel.height, lessThanOrEqualTo(400 * FloatingButtonConfig.panelMaxHeightFactor));
  });
}
