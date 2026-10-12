import 'package:mobile/core/config/ssh_session_config.dart';

/// Порог накопления пикселей на одну «тик»-прокрутку — то же значение
/// (`TERMINAL_CONFIG.WHEEL_PX_PER_TICK = 50`), что на десктопе
/// (`src/renderer/core/config/terminal-config.js`).
const int wheelPxPerTick = 50;

/// Мост «дельта скролла → история tmux» (REQ-14) — чистая логика, порт `TerminalWheelHandler` с
/// десктопа (`src/renderer/features/terminal/terminal-wheel-handler.js`), без Flutter-зависимостей
/// (перехват самого жеста — отдельно, в `TerminalGestureLayer`). В tmux-режиме сервер держит
/// `mouse off` (`remote_shell_hooks.dart`: выделение мышью отдано нативному терминалу), поэтому
/// обычный скролл tmux не видит — накапливает вертикальную дельту и по достижении
/// [wheelPxPerTick] шлёт `WHEEL_SCROLL_*_SEQ`: синтетическую CSI-u комбинацию, которую `-n`-биндинги
/// в generated tmux.conf распознают и уводят в copy-mode/скроллят историю на нужное число строк.
class ScrollDeltaAccumulator {
  ScrollDeltaAccumulator({required this.write});

  final void Function(String data) write;

  double _accumPx = 0;

  /// [deltaY] — положительное значение = скролл вниз (к новому выводу, `WHEEL_SCROLL_DOWN_SEQ`),
  /// отрицательное = вверх, в историю (`WHEEL_SCROLL_UP_SEQ`) — то же соглашение, что
  /// `PointerScrollEvent.scrollDelta.dy`/`ScrollUpdateNotification.scrollDelta` в Flutter (и
  /// `WheelEvent.deltaY` в DOM, откуда его унаследовал десктоп).
  void addDelta(double deltaY) {
    _accumPx += deltaY;
    while (_accumPx >= wheelPxPerTick) {
      write(SshSessionConfig.wheelScrollDownSeq);
      _accumPx -= wheelPxPerTick;
    }
    while (_accumPx <= -wheelPxPerTick) {
      write(SshSessionConfig.wheelScrollUpSeq);
      _accumPx += wheelPxPerTick;
    }
  }

  /// Сбрасывает накопленную дробную дельту — вызывать при включении моста (переход в tmux-режим
  /// новой вкладки), чтобы не унаследовать недосчитанный остаток от предыдущего состояния.
  void reset() => _accumPx = 0;
}
