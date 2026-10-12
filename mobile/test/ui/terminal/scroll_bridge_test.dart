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
}
