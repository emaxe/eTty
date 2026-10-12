/// Пороги жестов терминала (`terminal_gestures.dart`). Только мобильный UI — на десктопе
/// аналогов нет, поэтому golden-сверка с JS-конфигом не нужна.
abstract final class TerminalGestureConfig {
  /// Смещение одного пальца (px), после которого касание перестаёт быть тапом/long-press и
  /// становится скроллом.
  static const double tapSlopPx = 18;

  /// Удержание одного пальца без движения до начала выделения текста.
  static const int longPressMs = 500;

  /// Смещение центра двух пальцев (px), после которого свайп засчитывается и шлёт одну стрелку.
  static const double swipeThresholdPx = 40;
}
