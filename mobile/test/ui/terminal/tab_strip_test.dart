import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/domain/tab_controller.dart' as domain;
import 'package:mobile/ui/terminal/tab_strip.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  group('TabStrip', () {
    testWidgets('рендерит заголовок каждой вкладки', (tester) async {
      await tester.pumpWidget(
        _wrap(
          TabStrip(
            items: const [
              TabStripItem(
                title: 'etty-abc',
                status: domain.TabConnectionStatus.connected,
              ),
              TabStripItem(
                title: 'etty-def',
                status: domain.TabConnectionStatus.connecting,
              ),
            ],
            activeIndex: 0,
            onSelect: (_) {},
            onClose: (_) {},
            onAdd: () {},
          ),
        ),
      );

      expect(find.text('etty-abc'), findsOneWidget);
      expect(find.text('etty-def'), findsOneWidget);
    });

    testWidgets('тап по вкладке вызывает onSelect с её индексом', (
      tester,
    ) async {
      int? selected;
      await tester.pumpWidget(
        _wrap(
          TabStrip(
            items: const [
              TabStripItem(
                title: 'a',
                status: domain.TabConnectionStatus.connected,
              ),
              TabStripItem(
                title: 'b',
                status: domain.TabConnectionStatus.connected,
              ),
            ],
            activeIndex: 0,
            onSelect: (i) => selected = i,
            onClose: (_) {},
            onAdd: () {},
          ),
        ),
      );

      await tester.tap(find.text('b'));
      expect(selected, 1);
    });

    testWidgets('тап по крестику вызывает onClose, не onSelect', (
      tester,
    ) async {
      int? closed;
      int? selected;
      await tester.pumpWidget(
        _wrap(
          TabStrip(
            items: const [
              TabStripItem(
                title: 'a',
                status: domain.TabConnectionStatus.connected,
              ),
            ],
            activeIndex: 0,
            onSelect: (i) => selected = i,
            onClose: (i) => closed = i,
            onAdd: () {},
          ),
        ),
      );

      await tester.tap(find.byIcon(Icons.close));
      expect(closed, 0);
      expect(selected, isNull);
    });

    testWidgets('кнопка "+" вызывает onAdd', (tester) async {
      var added = false;
      await tester.pumpWidget(
        _wrap(
          TabStrip(
            items: const [],
            activeIndex: 0,
            onSelect: (_) {},
            onClose: (_) {},
            onAdd: () => added = true,
          ),
        ),
      );

      await tester.tap(find.byIcon(Icons.add));
      expect(added, isTrue);
    });

    testWidgets(
      'индикатор статуса показывается только для не-connected состояний',
      (tester) async {
        await tester.pumpWidget(
          _wrap(
            TabStrip(
              items: const [
                TabStripItem(
                  title: 'ok',
                  status: domain.TabConnectionStatus.connected,
                ),
                TabStripItem(
                  title: 'bad',
                  status: domain.TabConnectionStatus.error,
                ),
              ],
              activeIndex: 0,
              onSelect: (_) {},
              onClose: (_) {},
              onAdd: () {},
            ),
          ),
        );

        expect(find.byIcon(Icons.circle), findsOneWidget);
      },
    );
  });
}
