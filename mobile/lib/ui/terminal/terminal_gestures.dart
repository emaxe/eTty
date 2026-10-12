import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:xterm/xterm.dart' as xterm;

import 'package:mobile/core/config/terminal_gesture_config.dart';
import 'package:mobile/ui/terminal/scroll_bridge.dart';

typedef GestureTimerFactory = Timer Function(Duration d, void Function() cb);

enum _Phase { idle, pending, scrolling, longPress, twoFinger, ignored }

/// Чистая логика разбора касаний терминала (без виджетов) — отделяет тап, скролл одним пальцем,
/// long-press и свайп двумя пальцами. Встроенные жесты `xterm.TerminalView` (Scrollable,
/// InfiniteScrollView, drag-выделение) конфликтуют друг с другом, поэтому слой поверх него
/// принимает все касания сам и сообщает о намерении через колбэки.
///
/// Свайп двумя пальцами — один на жест: после первого срабатывания остальное движение до отпускания
/// всех пальцев игнорируется ("один свайп = одна стрелка").
class TerminalGestureInterpreter {
  TerminalGestureInterpreter({
    this.onTap,
    this.onScroll,
    this.onLongPressStart,
    this.onLongPressMove,
    this.onLongPressEnd,
    this.onSwipe,
    GestureTimerFactory? timerFactory,
  }) : _timerFactory = timerFactory ?? Timer.new;

  final void Function(Offset position)? onTap;

  /// [deltaY] > 0 — палец движется вниз (смотрим более старый вывод).
  final void Function(double deltaY, Offset position)? onScroll;
  final void Function(Offset position)? onLongPressStart;
  final void Function(Offset position)? onLongPressMove;
  final void Function(Offset position)? onLongPressEnd;

  /// Направление движения пальцев.
  final void Function(AxisDirection direction)? onSwipe;

  final GestureTimerFactory _timerFactory;

  final Map<int, Offset> _pointers = {};
  _Phase _phase = _Phase.idle;
  Offset _startPos = Offset.zero;
  Offset _lastPos = Offset.zero;
  Offset _swipeStartCentroid = Offset.zero;
  bool _swipeFired = false;
  Timer? _longPressTimer;

  void pointerDown(int id, Offset position) {
    _pointers[id] = position;
    switch (_pointers.length) {
      case 1:
        _phase = _Phase.pending;
        _startPos = position;
        _lastPos = position;
        _longPressTimer?.cancel();
        _longPressTimer = _timerFactory(
          const Duration(milliseconds: TerminalGestureConfig.longPressMs),
          _onLongPressTimer,
        );
      case 2:
        _cancelTimer();
        if (_phase == _Phase.longPress) onLongPressEnd?.call(_lastPos);
        _phase = _Phase.twoFinger;
        _swipeFired = false;
        _swipeStartCentroid = _centroid();
      default:
        _cancelTimer();
        _phase = _Phase.ignored;
    }
  }

  void pointerMove(int id, Offset position) {
    if (!_pointers.containsKey(id)) return;
    _pointers[id] = position;
    switch (_phase) {
      case _Phase.pending:
        if ((position - _startPos).distance >
            TerminalGestureConfig.tapSlopPx) {
          _cancelTimer();
          _phase = _Phase.scrolling;
          onScroll?.call(position.dy - _startPos.dy, position);
          _lastPos = position;
        }
      case _Phase.scrolling:
        onScroll?.call(position.dy - _lastPos.dy, position);
        _lastPos = position;
      case _Phase.longPress:
        _lastPos = position;
        onLongPressMove?.call(position);
      case _Phase.twoFinger:
        if (_swipeFired) return;
        final delta = _centroid() - _swipeStartCentroid;
        if (delta.distance < TerminalGestureConfig.swipeThresholdPx) return;
        _swipeFired = true;
        if (delta.dx.abs() >= delta.dy.abs()) {
          onSwipe?.call(delta.dx < 0 ? AxisDirection.left : AxisDirection.right);
        } else {
          onSwipe?.call(delta.dy < 0 ? AxisDirection.up : AxisDirection.down);
        }
      case _Phase.idle:
      case _Phase.ignored:
        break;
    }
  }

  void pointerUp(int id, Offset position) {
    if (!_pointers.containsKey(id)) return;
    _pointers[id] = position;
    if (_phase == _Phase.pending && _pointers.length == 1) {
      _cancelTimer();
      onTap?.call(position);
    } else if (_phase == _Phase.longPress) {
      onLongPressEnd?.call(position);
    }
    _release(id);
  }

  void pointerCancel(int id) {
    if (!_pointers.containsKey(id)) return;
    if (_phase == _Phase.longPress) onLongPressEnd?.call(_lastPos);
    _cancelTimer();
    _release(id);
  }

  void dispose() => _cancelTimer();

  void _release(int id) {
    _pointers.remove(id);
    if (_pointers.isEmpty) {
      _phase = _Phase.idle;
    } else {
      // Остался палец после жеста из нескольких (или после скролла) — центроид скачет, поэтому до
      // полного отпускания ничего не делаем.
      _phase = _Phase.ignored;
    }
  }

  void _onLongPressTimer() {
    _longPressTimer = null;
    if (_phase != _Phase.pending) return;
    _phase = _Phase.longPress;
    onLongPressStart?.call(_startPos);
  }

  void _cancelTimer() {
    _longPressTimer?.cancel();
    _longPressTimer = null;
  }

  Offset _centroid() {
    var sum = Offset.zero;
    for (final p in _pointers.values) {
      sum += p;
    }
    return sum / _pointers.length.toDouble();
  }
}

/// Слой поверх `xterm.TerminalView`, перехватывающий все касания и маршрутизирующий их:
/// мышь TUI-приложения (если оно включило mouse mode) → колесо/клик; tmux → мост
/// [ScrollDeltaAccumulator]; иначе локальный scrollback. Свайп двумя пальцами всегда шлёт стрелку.
class TerminalGestureLayer extends StatefulWidget {
  const TerminalGestureLayer({
    super.key,
    required this.terminal,
    required this.viewKey,
    required this.controller,
    required this.scrollController,
    required this.isTmux,
    required this.write,
  });

  final xterm.Terminal terminal;
  final GlobalKey<xterm.TerminalViewState> viewKey;
  final xterm.TerminalController controller;
  final ScrollController scrollController;

  /// tmux-вкладка: локальный scrollback пуст, историю держит сервер.
  final bool isTmux;

  /// Прямая запись в SSH-канал (tmux-мост колеса).
  final void Function(String data) write;

  @override
  State<TerminalGestureLayer> createState() => _TerminalGestureLayerState();
}

class _TerminalGestureLayerState extends State<TerminalGestureLayer> {
  late final TerminalGestureInterpreter _interpreter;
  late final ScrollDeltaAccumulator _tmuxScroll;
  double _mouseWheelPx = 0;
  Offset _longPressOrigin = Offset.zero;

  /// Последняя сработавшая стрелка свайпа и счётчик — для визуальной подсказки (вспышка в центре).
  AxisDirection? _flashDirection;
  int _flashSeq = 0;

  xterm.TerminalViewState? get _view => widget.viewKey.currentState;

  @override
  void initState() {
    super.initState();
    _tmuxScroll = ScrollDeltaAccumulator(write: (s) => widget.write(s));
    _interpreter = TerminalGestureInterpreter(
      onTap: _onTap,
      onScroll: _onScroll,
      onLongPressStart: (p) {
        _longPressOrigin = p;
        _view?.renderTerminal.selectWord(_local(p));
      },
      onLongPressMove: (p) =>
          _view?.renderTerminal.selectWord(_local(_longPressOrigin), _local(p)),
      onSwipe: _onSwipe,
    );
  }

  @override
  void dispose() {
    _interpreter.dispose();
    super.dispose();
  }

  /// Координаты слоя совпадают с координатами `TerminalView` (оба `Positioned.fill`), но
  /// `RenderTerminal` лежит внутри padding/viewport — переводим через глобальные.
  Offset _local(Offset layerPosition) {
    final view = _view;
    final box = context.findRenderObject() as RenderBox?;
    if (view == null || box == null) return layerPosition;
    return view.renderTerminal.globalToLocal(box.localToGlobal(layerPosition));
  }

  xterm.CellOffset _viewportCell(Offset layerPosition) {
    final cell = _view!.renderTerminal.getCellOffset(_local(layerPosition));
    final t = widget.terminal;
    // `getCellOffset` возвращает строку буфера (с scrollback), протоколу мыши нужна строка экрана.
    final scrollback = t.buffer.lines.length - t.viewHeight;
    final row = (cell.y - scrollback).clamp(0, t.viewHeight - 1);
    return xterm.CellOffset(cell.x, row);
  }

  bool get _mouseMode => widget.terminal.mouseMode != xterm.MouseMode.none;

  void _onTap(Offset position) {
    if (widget.controller.selection != null) {
      widget.controller.clearSelection();
      return;
    }
    if (_view != null && _mouseMode) {
      final cell = _viewportCell(position);
      final t = widget.terminal;
      if (t.mouseInput(
        xterm.TerminalMouseButton.left,
        xterm.TerminalMouseButtonState.down,
        cell,
      )) {
        t.mouseInput(
          xterm.TerminalMouseButton.left,
          xterm.TerminalMouseButtonState.up,
          cell,
        );
        return;
      }
    }
    _view?.requestKeyboard();
  }

  /// [deltaY] > 0 — контент тянут вниз (к старому выводу).
  void _onScroll(double deltaY, Offset position) {
    final view = _view;
    if (view == null) return;
    final t = widget.terminal;
    if (_mouseMode) {
      _mouseWheelPx += deltaY;
      final lineHeight = view.renderTerminal.lineHeight;
      final cell = _viewportCell(position);
      while (_mouseWheelPx.abs() >= lineHeight) {
        final up = _mouseWheelPx > 0;
        t.mouseInput(
          up
              ? xterm.TerminalMouseButton.wheelUp
              : xterm.TerminalMouseButton.wheelDown,
          xterm.TerminalMouseButtonState.down,
          cell,
        );
        _mouseWheelPx -= up ? lineHeight : -lineHeight;
      }
    } else if (widget.isTmux) {
      // Аккумулятор: положительное = вниз (новый вывод), палец вниз = история вверх.
      _tmuxScroll.addDelta(-deltaY);
    } else if (t.isUsingAltBuffer) {
      _mouseWheelPx += deltaY;
      final lineHeight = view.renderTerminal.lineHeight;
      while (_mouseWheelPx.abs() >= lineHeight) {
        final up = _mouseWheelPx > 0;
        t.keyInput(up ? xterm.TerminalKey.arrowUp : xterm.TerminalKey.arrowDown);
        _mouseWheelPx -= up ? lineHeight : -lineHeight;
      }
    } else if (widget.scrollController.hasClients) {
      final pos = widget.scrollController.position;
      widget.scrollController.jumpTo(
        (pos.pixels - deltaY).clamp(pos.minScrollExtent, pos.maxScrollExtent),
      );
    }
  }

  void _onSwipe(AxisDirection direction) {
    setState(() {
      _flashDirection = direction;
      _flashSeq++;
    });
    widget.terminal.keyInput(switch (direction) {
      AxisDirection.up => xterm.TerminalKey.arrowUp,
      AxisDirection.down => xterm.TerminalKey.arrowDown,
      AxisDirection.left => xterm.TerminalKey.arrowLeft,
      AxisDirection.right => xterm.TerminalKey.arrowRight,
    });
  }

  void _onSignal(PointerSignalEvent event) {
    if (event is! PointerScrollEvent) return;
    // Колесо: dy > 0 — вниз (новый вывод), у пальца знак обратный.
    _onScroll(-event.scrollDelta.dy, event.localPosition);
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      behavior: HitTestBehavior.opaque,
      onPointerDown: (e) => _interpreter.pointerDown(e.pointer, e.localPosition),
      onPointerMove: (e) => _interpreter.pointerMove(e.pointer, e.localPosition),
      onPointerUp: (e) => _interpreter.pointerUp(e.pointer, e.localPosition),
      onPointerCancel: (e) => _interpreter.pointerCancel(e.pointer),
      onPointerSignal: _onSignal,
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (_flashDirection != null)
            IgnorePointer(
              child: _SwipeArrowFlash(
                key: ValueKey(_flashSeq),
                direction: _flashDirection!,
              ),
            ),
        ],
      ),
    );
  }
}

/// Вспышка стрелки в центре терминала: подтверждает, какая стрелка ушла по свайпу двумя пальцами.
class _SwipeArrowFlash extends StatelessWidget {
  const _SwipeArrowFlash({super.key, required this.direction});

  final AxisDirection direction;

  static const double _size = 72;
  static const double _travel = 24;

  @override
  Widget build(BuildContext context) {
    final icon = switch (direction) {
      AxisDirection.up => Icons.arrow_upward,
      AxisDirection.down => Icons.arrow_downward,
      AxisDirection.left => Icons.arrow_back,
      AxisDirection.right => Icons.arrow_forward,
    };
    final shift = switch (direction) {
      AxisDirection.up => const Offset(0, -1),
      AxisDirection.down => const Offset(0, 1),
      AxisDirection.left => const Offset(-1, 0),
      AxisDirection.right => const Offset(1, 0),
    };
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 450),
      builder: (context, t, _) => Center(
        child: Transform.translate(
          offset: shift * (_travel * t),
          child: Opacity(
            opacity: (1 - t).clamp(0.0, 1.0) * 0.85,
            child: Container(
              width: _size,
              height: _size,
              decoration: const BoxDecoration(
                color: Colors.black54,
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: Colors.white, size: 40),
            ),
          ),
        ),
      ),
    );
  }
}
