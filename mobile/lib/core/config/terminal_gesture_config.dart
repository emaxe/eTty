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

  /// Удержание двух пальцев без движения до открытия колеса быстрых действий.
  static const int twoFingerLongPressMs = 500;

  /// Двухпальцевый тап: оба пальца отпущены быстрее этого времени (мс) от второго касания.
  static const int twoFingerTapMaxMs = 250;

  /// Окно между двумя двухпальцевыми тапами (мс), чтобы получился двойной тап.
  static const int doubleTapWindowMs = 350;

  /// Максимальное расстояние (px) между центрами двух тапов двойного тапа.
  static const double doubleTapSlopPx = 60;

  /// Сколько строк прокрутки пальцем (на alternate screen без mouse mode) даёт один PgUp/PgDn.
  static const int altBufferPageLines = 8;
}
