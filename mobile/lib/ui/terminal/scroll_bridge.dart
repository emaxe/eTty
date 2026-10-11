import 'package:flutter/widgets.dart';

import 'package:mobile/core/config/ssh_session_config.dart';

/// Порог накопления пикселей на одну «тик»-прокрутку — то же значение
/// (`TERMINAL_CONFIG.WHEEL_PX_PER_TICK = 50`), что на десктопе
/// (`src/renderer/core/config/terminal-config.js`).
const int wheelPxPerTick = 50;

/// Мост «дельта скролла → история tmux» (REQ-14) — чистая логика, порт `TerminalWheelHandler` с
/// десктопа (`src/renderer/features/terminal/terminal-wheel-handler.js`), без Flutter-зависимостей
/// (перехват самого жеста — отдельно, в виджете [ScrollBridge] ниже). В tmux-режиме сервер держит
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

/// Перехватывает вертикальный скролл (жест или колесо мыши/трекпада — оба дают один и тот же
/// `ScrollNotification` в Flutter) поверх [child] (обычно `xterm.TerminalView` с переданным этому
/// же виджету [scrollController]) и перенаправляет его в [ScrollDeltaAccumulator], когда [enabled]
/// (tmux-вкладка). Использует `NotificationListener` вместо конкурирующего `GestureDetector` —
/// внутренний `Scrollable` `TerminalView` сам выигрывает арену жеста как единственный
/// распознаватель, мы только НАБЛЮДАЕМ результат и тут же гасим его через [scrollController], чтобы
/// локальный (пустой в tmux-режиме — реальный scrollback живёт на сервере) вид не уезжал.
///
/// Вне tmux-режима ([enabled] == false) ничего не делает — нативный локальный скролл `TerminalView`
/// работает как обычно (REQ-14: «нативный скролл в обычном» SSH-режиме).
class ScrollBridge extends StatefulWidget {
  const ScrollBridge({
    super.key,
    required this.enabled,
    required this.write,
    required this.scrollController,
    required this.child,
  });

  final bool enabled;
  final void Function(String data) write;
  final ScrollController scrollController;
  final Widget child;

  @override
  State<ScrollBridge> createState() => _ScrollBridgeState();
}

class _ScrollBridgeState extends State<ScrollBridge> {
  late ScrollDeltaAccumulator _accumulator;
  bool _resetScheduled = false;

  @override
  void initState() {
    super.initState();
    _accumulator = ScrollDeltaAccumulator(write: widget.write);
  }

  @override
  void didUpdateWidget(covariant ScrollBridge oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!oldWidget.enabled && widget.enabled) {
      _accumulator.reset();
    }
  }

  bool _onNotification(ScrollNotification notification) {
    if (!widget.enabled) return false;
    if (notification is ScrollUpdateNotification &&
        notification.scrollDelta != null) {
      _accumulator.addDelta(notification.scrollDelta!);
      _scheduleReset();
    }
    return false;
  }

  /// Гасит визуальное смещение ПОСЛЕ текущего кадра — не внутри самого колбэка уведомления
  /// (`Scrollable` в этот момент ещё завершает собственный layout/scroll этого же жеста, трогать
  /// controller синхронно небезопасно).
  void _scheduleReset() {
    if (_resetScheduled) return;
    _resetScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _resetScheduled = false;
      if (widget.scrollController.hasClients) {
        widget.scrollController.jumpTo(0);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.enabled) return widget.child;
    return NotificationListener<ScrollNotification>(
      onNotification: _onNotification,
      child: widget.child,
    );
  }
}
