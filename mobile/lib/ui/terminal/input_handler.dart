import 'package:flutter/foundation.dart';

/// Залипающий модификатор (REQ-16, `docs/plans/mob/plan.md`) — single-shot: активируется тапом
/// по кнопке в [KeyBar], применяется к СЛЕДУЮЩЕМУ печатному символу, затем сбрасывается сам.
enum StickyModifier { none, ctrl, alt }

/// Перехватчик `terminal.onOutput` для одной вкладки терминала — единственный рабочий путь для
/// залипающего Ctrl/Alt с экранной клавиатуры. Подтверждено спайком S1: `CustomTextEdit` шлёт
/// текст через `terminal.textInput()` → `onOutput` НАПРЯМУЮ, минуя `TerminalInputHandler`/
/// `keyInput()` целиком — модификаторы просто некуда передать на этом пути. Физическая
/// клавиатура (iPad + внешняя) Ctrl/Alt передаёт по-другому — `keyInput()` реально получает флаги
/// модификаторов, поэтому дефолтный `TerminalInputHandler` xterm.dart уже работает верно и трогать
/// его не нужно; этот класс касается только пути через `onOutput`.
class StickyModifierController extends ValueNotifier<StickyModifier> {
  StickyModifierController() : super(StickyModifier.none);

  void toggleCtrl() {
    value = value == StickyModifier.ctrl
        ? StickyModifier.none
        : StickyModifier.ctrl;
  }

  void toggleAlt() {
    value = value == StickyModifier.alt
        ? StickyModifier.none
        : StickyModifier.alt;
  }

  void cancel() => value = StickyModifier.none;

  /// Трансформирует одну порцию `terminal.onOutput` — вызывать ПЕРЕД отправкой в SSH-канал.
  /// Модификатор применяется, только если [data] — ровно один печатный ASCII-символ (0x20..0x7e):
  /// более длинный ввод (composing text, автозамена, paste) не является «одной набранной буквой
  /// после тапа по Ctrl», трогать его было бы неверно и потенциально опасно.
  String intercept(String data) {
    final modifier = value;
    if (modifier == StickyModifier.none) return data;
    if (data.length != 1) return data;
    final code = data.codeUnitAt(0);
    if (code < 0x20 || code > 0x7e) return data;
    value = StickyModifier.none;
    switch (modifier) {
      case StickyModifier.ctrl:
        return String.fromCharCode(code & 0x1f);
      case StickyModifier.alt:
        // ESC-префикс — стандартная кодировка Alt/Meta для терминалов без явного бита
        // модификатора в потоке байт (то же соглашение, что macOS Terminal.app "Use Option as
        // Meta key" или xterm `metaSendsEscape`).
        return '\x1b$data';
      case StickyModifier.none:
        return data;
    }
  }
}
