import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/config/ssh_session_config.dart';
import 'package:mobile/ui/terminal/scroll_bridge.dart';

void main() {
  group('ScrollDeltaAccumulator', () {
    test('ниже порога ничего не шлёт', () {
      final sent = <String>[];
      final acc = ScrollDeltaAccumulator(write: sent.add);

      acc.addDelta(wheelPxPerTick - 1);

      expect(sent, isEmpty);
    });

    test('положительная дельта на пороге шлёт WHEEL_SCROLL_DOWN_SEQ', () {
      final sent = <String>[];
      final acc = ScrollDeltaAccumulator(write: sent.add);

      acc.addDelta(wheelPxPerTick.toDouble());

      expect(sent, [SshSessionConfig.wheelScrollDownSeq]);
    });

    test('отрицательная дельта на пороге шлёт WHEEL_SCROLL_UP_SEQ', () {
      final sent = <String>[];
      final acc = ScrollDeltaAccumulator(write: sent.add);

      acc.addDelta(-wheelPxPerTick.toDouble());

      expect(sent, [SshSessionConfig.wheelScrollUpSeq]);
    });

    test(
      'накопление по маленьким шагам срабатывает так же, как один большой',
      () {
        final sent = <String>[];
        final acc = ScrollDeltaAccumulator(write: sent.add);

        for (var i = 0; i < wheelPxPerTick; i++) {
          acc.addDelta(1);
        }

        expect(sent, [SshSessionConfig.wheelScrollDownSeq]);
      },
    );

    test('несколько тиков за одну дельту дают несколько событий', () {
      final sent = <String>[];
      final acc = ScrollDeltaAccumulator(write: sent.add);

      acc.addDelta(wheelPxPerTick * 3.0);

      expect(sent, [
        SshSessionConfig.wheelScrollDownSeq,
        SshSessionConfig.wheelScrollDownSeq,
        SshSessionConfig.wheelScrollDownSeq,
      ]);
    });

    test('остаток после тика сохраняется между вызовами (не теряется, не задваивается)', () {
      final sent = <String>[];
      final acc = ScrollDeltaAccumulator(write: sent.add);

      acc.addDelta(wheelPxPerTick - 5);
      expect(sent, isEmpty);
      acc.addDelta(5);
      expect(sent, [SshSessionConfig.wheelScrollDownSeq]);
    });

    test('reset() обнуляет накопленный остаток', () {
      final sent = <String>[];
      final acc = ScrollDeltaAccumulator(write: sent.add);

      acc.addDelta(wheelPxPerTick - 1);
      acc.reset();
      acc.addDelta(1);

      expect(
        sent,
        isEmpty,
        reason: 'после reset() старый остаток не должен доучитываться',
      );
    });

    test('смена направления между вызовами не даёт ложных срабатываний', () {
      final sent = <String>[];
      final acc = ScrollDeltaAccumulator(write: sent.add);

      acc.addDelta((wheelPxPerTick - 1).toDouble());
      acc.addDelta(-(wheelPxPerTick - 1).toDouble());

      expect(sent, isEmpty);
    });
  });

  group('ScrollBridge', () {
    Widget wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

    testWidgets(
      'enabled=false — жест не перехватывается, локальный скролл работает как обычно',
      (tester) async {
        final sent = <String>[];
        final controller = ScrollController();
        await tester.pumpWidget(
          wrap(
            ScrollBridge(
              enabled: false,
              write: sent.add,
              scrollController: controller,
              child: ListView.builder(
                controller: controller,
                itemCount: 100,
                itemBuilder: (context, i) =>
                    SizedBox(height: 40, child: Text('item $i')),
              ),
            ),
          ),
        );

        await tester.drag(find.byType(ListView), const Offset(0, -300));
        await tester.pumpAndSettle();

        expect(sent, isEmpty);
        expect(
          controller.offset,
          greaterThan(0),
          reason: 'локальный скролл должен был сдвинуться',
        );
      },
    );

    testWidgets(
      'enabled=true — жест переводится в WHEEL_SCROLL_*_SEQ, позиция гасится',
      (tester) async {
        final sent = <String>[];
        final controller = ScrollController();
        final childKey = GlobalKey();
        await tester.pumpWidget(
          wrap(
            ScrollBridge(
              enabled: true,
              write: sent.add,
              scrollController: controller,
              child: ListView.builder(
                key: childKey,
                controller: controller,
                itemCount: 100,
                itemBuilder: (context, i) =>
                    SizedBox(height: 40, child: Text('item $i')),
              ),
            ),
          ),
        );

        // Диспетчерим ScrollUpdateNotification напрямую (не через tester.drag()): у симулятора
        // жеста в тестах есть собственные — не связанные с логикой ScrollBridge — артефакты при
        // сбросе позиции ПОСЕРЕДИНЕ составного жеста (несколько промежуточных move-событий),
        // из-за которых часть уведомлений выходит с "исправляющим" отрицательным scrollDelta.
        // Это проверяет именно то, что делает [ScrollBridge._onNotification]: положительная
        // scrollDelta -> WHEEL_SCROLL_DOWN_SEQ, погашение позиции постфрейм-коллбэком.
        final context = childKey.currentContext!;
        ScrollUpdateNotification(
          metrics: FixedScrollMetrics(
            minScrollExtent: 0,
            maxScrollExtent: 1000,
            pixels: wheelPxPerTick * 2.5,
            viewportDimension: 600,
            axisDirection: AxisDirection.down,
            devicePixelRatio: tester.view.devicePixelRatio,
          ),
          context: context,
          scrollDelta: wheelPxPerTick * 2.5,
        ).dispatch(context);
        await tester.pump();

        expect(sent, [
          SshSessionConfig.wheelScrollDownSeq,
          SshSessionConfig.wheelScrollDownSeq,
        ]);
        expect(
          controller.offset,
          0,
          reason: 'позиция должна была быть погашена постфрейм-коллбэком',
        );
      },
    );
  });
}
