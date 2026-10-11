import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/ui/terminal/input_handler.dart';

void main() {
  group('StickyModifierController — toggle', () {
    test('toggleCtrl активирует, повторный toggleCtrl снимает', () {
      final sticky = StickyModifierController();
      sticky.toggleCtrl();
      expect(sticky.value, StickyModifier.ctrl);
      sticky.toggleCtrl();
      expect(sticky.value, StickyModifier.none);
    });

    test('toggleAlt активирует, повторный toggleAlt снимает', () {
      final sticky = StickyModifierController();
      sticky.toggleAlt();
      expect(sticky.value, StickyModifier.alt);
      sticky.toggleAlt();
      expect(sticky.value, StickyModifier.none);
    });

    test(
      'toggleAlt во время активного ctrl переключает на alt (не аддитивно)',
      () {
        final sticky = StickyModifierController();
        sticky.toggleCtrl();
        sticky.toggleAlt();
        expect(sticky.value, StickyModifier.alt);
      },
    );

    test('cancel() сбрасывает активный модификатор', () {
      final sticky = StickyModifierController();
      sticky.toggleCtrl();
      sticky.cancel();
      expect(sticky.value, StickyModifier.none);
    });
  });

  group('StickyModifierController — intercept()', () {
    test('без активного модификатора данные проходят как есть', () {
      final sticky = StickyModifierController();
      expect(sticky.intercept('a'), 'a');
      expect(sticky.intercept('hello'), 'hello');
    });

    test('ctrl + печатная буква -> char & 0x1f, модификатор сбрасывается (single-shot)', () {
      final sticky = StickyModifierController();
      sticky.toggleCtrl();
      final result = sticky.intercept('c');
      expect(result, String.fromCharCode('c'.codeUnitAt(0) & 0x1f));
      expect(result.codeUnitAt(0), 0x03, reason: 'Ctrl+C == 0x03');
      expect(
        sticky.value,
        StickyModifier.none,
        reason: 'single-shot — сброс после одной буквы',
      );
    });

    test('alt + печатная буква -> ESC-префикс, модификатор сбрасывается', () {
      final sticky = StickyModifierController();
      sticky.toggleAlt();
      expect(sticky.intercept('f'), '\x1bf');
      expect(sticky.value, StickyModifier.none);
    });

    test('повторный тап без последующего ввода можно отменить toggle-ом ещё раз', () {
      final sticky = StickyModifierController();
      sticky.toggleCtrl();
      sticky
          .toggleCtrl(); // передумал — Ctrl снят, следующая буква идёт как есть
      expect(sticky.intercept('c'), 'c');
    });

    test(
      'composing text длиннее одного символа не трогается (paste/автозамена)',
      () {
        final sticky = StickyModifierController();
        sticky.toggleCtrl();
        expect(sticky.intercept('ab'), 'ab');
        expect(
          sticky.value,
          StickyModifier.ctrl,
          reason: 'не единичный символ — модификатор остаётся активным',
        );
      },
    );

    test(
      'непечатные символы (например уже готовый control-код) не трогаются',
      () {
        final sticky = StickyModifierController();
        sticky.toggleCtrl();
        expect(sticky.intercept('\n'), '\n');
        expect(sticky.value, StickyModifier.ctrl);
      },
    );

    test(
      'Ctrl+[a-z] даёт коды 0x01..0x1a (стандартная терминальная семантика)',
      () {
        final sticky = StickyModifierController();
        for (var i = 0; i < 26; i++) {
          final letter = String.fromCharCode('a'.codeUnitAt(0) + i);
          sticky.toggleCtrl();
          final result = sticky.intercept(letter);
          expect(result.codeUnitAt(0), i + 1, reason: 'Ctrl+$letter');
        }
      },
    );
  });
}
