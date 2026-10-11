import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/ui/terminal/input_handler.dart';
import 'package:mobile/ui/terminal/key_bar.dart';

/// KeyBar — горизонтальный `ListView` на 17 кнопок, шире дефолтной тестовой поверхности (800px):
/// без расширения дальние кнопки (`^C`/`^D`/`^Z` и т.п.) не реализуются в дереве элементов
/// (Sliver строит только то, что попадает в viewport) и `find.text()` их не находит без прокрутки.
Future<void> _pump(WidgetTester tester, Widget child) async {
  tester.view.physicalSize = const Size(1400, 800);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(MaterialApp(home: Scaffold(body: child)));
}

void main() {
  group('KeyBar — немедленные последовательности', () {
    final cases = {
      'Esc': '\x1b',
      'Tab': '\t',
      '↑': '\x1b[A',
      '↓': '\x1b[B',
      '←': '\x1b[D',
      '→': '\x1b[C',
      'PgUp': '\x1b[5~',
      'PgDn': '\x1b[6~',
      '|': '|',
      '-': '-',
      '~': '~',
      '/': '/',
      '^C': '\x03',
      '^D': '\x04',
      '^Z': '\x1a',
    };

    for (final entry in cases.entries) {
      testWidgets('кнопка "${entry.key}" шлёт ${entry.value.codeUnits}', (
        tester,
      ) async {
        final sent = <String>[];
        await _pump(
          tester,
          KeyBar(sticky: StickyModifierController(), onSend: sent.add),
        );

        await tester.tap(find.text(entry.key));
        expect(sent, [entry.value]);
      });
    }
  });

  group('KeyBar — залипающие Ctrl/Alt', () {
    testWidgets('тап по Ctrl переключает sticky, а не вызывает onSend', (
      tester,
    ) async {
      final sticky = StickyModifierController();
      final sent = <String>[];
      await _pump(tester, KeyBar(sticky: sticky, onSend: sent.add));

      await tester.tap(find.text('Ctrl'));
      await tester.pump();

      expect(sticky.value, StickyModifier.ctrl);
      expect(sent, isEmpty);
    });

    testWidgets('тап по Alt переключает sticky, а не вызывает onSend', (
      tester,
    ) async {
      final sticky = StickyModifierController();
      final sent = <String>[];
      await _pump(tester, KeyBar(sticky: sticky, onSend: sent.add));

      await tester.tap(find.text('Alt'));
      await tester.pump();

      expect(sticky.value, StickyModifier.alt);
      expect(sent, isEmpty);
    });

    testWidgets('активный модификатор подсвечивает кнопку другим цветом', (
      tester,
    ) async {
      final sticky = StickyModifierController();
      await _pump(tester, KeyBar(sticky: sticky, onSend: (_) {}));

      Material materialOf(String label) => tester.widget<Material>(
        find
            .ancestor(of: find.text(label), matching: find.byType(Material))
            .first,
      );

      final beforeColor = materialOf('Ctrl').color;
      sticky.toggleCtrl();
      await tester.pump();
      final afterColor = materialOf('Ctrl').color;

      expect(afterColor, isNot(beforeColor));
    });
  });
}
