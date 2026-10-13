import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:xterm/xterm.dart' as xterm;

import 'package:mobile/core/config/quick_actions_config.dart';
import 'package:mobile/core/config/terminal_gesture_config.dart';
import 'package:mobile/domain/quick_commands.dart';
import 'package:mobile/ui/terminal/quick_action_wheel.dart';
import 'package:mobile/ui/terminal/scroll_bridge.dart';

typedef GestureTimerFactory = Timer Function(Duration d, void Function() cb);

enum _Phase { idle, pending, scrolling, longPress, twoFinger, wheel, ignored }

/// Чистая логика разбора касаний терминала (без виджетов) — отделяет тап, скролл одним пальцем,
/// long-press и свайп двумя пальцами. Встроенные жесты `xterm.TerminalView` (Scrollable,
/// InfiniteScrollView, drag-выделение) конфликтуют друг с другом, поэтому слой поверх него
/// принимает все касания сам и сообщает о намерении через колбэки.
///
/// Свайп двумя пальцами — один на жест: после первого срабатывания остальное движение до отпускания
/// всех пальцев игнорируется ("один свайп = одна стрелка").
///
/// Удержание двух пальцев без движения открывает колесо быстрых действий: [onWheelStart], затем
/// [onWheelMove] с центром пальцев, и [onWheelEnd] при отпускании первого пальца (с последним
/// центром до отрыва). Третий палец или cancel — [onWheelCancel].
class TerminalGestureInterpreter {
  TerminalGestureInterpreter({
    this.onTap,
    this.onScroll,
    this.onLongPressStart,
    this.onLongPressMove,
    this.onLongPressEnd,
    this.onSwipe,
    this.onWheelStart,
    this.onWheelMove,
    this.onWheelEnd,
    this.onWheelCancel,
    this.onTwoFingerDoubleTap,
    GestureTimerFactory? timerFactory,
    Duration Function()? clock,
  }) : _timerFactory = timerFactory ?? Timer.new,
       _clock = clock ?? _stopwatchClock();

  final void Function(Offset position)? onTap;

  /// [deltaY] > 0 — палец движется вниз (смотрим более старый вывод).
  final void Function(double deltaY, Offset position)? onScroll;
  final void Function(Offset position)? onLongPressStart;
  final void Function(Offset position)? onLongPressMove;
  final void Function(Offset position)? onLongPressEnd;

  /// Направление движения пальцев.
  final void Function(AxisDirection direction)? onSwipe;

  final void Function(Offset centroid)? onWheelStart;
  final void Function(Offset centroid)? onWheelMove;
  final void Function(Offset centroid)? onWheelEnd;
  final void Function()? onWheelCancel;

  /// Два быстрых тапа двумя пальцами подряд (в одном месте) — центр второго тапа.
  final void Function(Offset centroid)? onTwoFingerDoubleTap;

  final GestureTimerFactory _timerFactory;
  final Duration Function() _clock;

  static Duration Function() _stopwatchClock() {
    final sw = Stopwatch()..start();
    return () => sw.elapsed;
  }

  final Map<int, Offset> _pointers = {};
  _Phase _phase = _Phase.idle;
  Offset _startPos = Offset.zero;
  Offset _lastPos = Offset.zero;
  Offset _swipeStartCentroid = Offset.zero;
  bool _swipeFired = false;
  Offset _wheelLast = Offset.zero;
  Duration _twoDownAt = Duration.zero;
  bool _twoFingerMoved = false;
  Duration? _lastTapAt;
  Offset _lastTapPos = Offset.zero;
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
        _twoDownAt = _clock();
        _twoFingerMoved = false;
        _longPressTimer = _timerFactory(
          const Duration(milliseconds: TerminalGestureConfig.twoFingerLongPressMs),
          _onTwoFingerTimer,
        );
      default:
        _cancelTimer();
        if (_phase == _Phase.wheel) onWheelCancel?.call();
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
        if (delta.distance > TerminalGestureConfig.tapSlopPx) {
          _cancelTimer();
          _twoFingerMoved = true;
        }
        if (delta.distance < TerminalGestureConfig.swipeThresholdPx) return;
        _swipeFired = true;
        if (delta.dx.abs() >= delta.dy.abs()) {
          onSwipe?.call(delta.dx < 0 ? AxisDirection.left : AxisDirection.right);
        } else {
          onSwipe?.call(delta.dy < 0 ? AxisDirection.up : AxisDirection.down);
        }
      case _Phase.wheel:
        _wheelLast = _centroid();
        onWheelMove?.call(_wheelLast);
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
    } else if (_phase == _Phase.twoFinger && _pointers.length == 2) {
      _maybeTwoFingerTap();
    } else if (_phase == _Phase.wheel) {
      // Центр после отрыва пальца прыгает — берём последний центр двух пальцев.
      onWheelEnd?.call(_wheelLast);
    }
    _cancelTimer();
    _release(id);
  }

  void pointerCancel(int id) {
    if (!_pointers.containsKey(id)) return;
    if (_phase == _Phase.longPress) onLongPressEnd?.call(_lastPos);
    if (_phase == _Phase.wheel) onWheelCancel?.call();
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

  /// Короткий двухпальцевый тап без движения; два таких подряд рядом друг с другом — двойной тап.
  void _maybeTwoFingerTap() {
    final now = _clock();
    if (_swipeFired ||
        _twoFingerMoved ||
        (now - _twoDownAt).inMilliseconds > TerminalGestureConfig.twoFingerTapMaxMs) {
      _lastTapAt = null;
      return;
    }
    final pos = _centroid();
    final prev = _lastTapAt;
    if (prev != null &&
        (now - prev).inMilliseconds <= TerminalGestureConfig.doubleTapWindowMs &&
        (pos - _lastTapPos).distance <= TerminalGestureConfig.doubleTapSlopPx) {
      _lastTapAt = null;
      onTwoFingerDoubleTap?.call(pos);
    } else {
      _lastTapAt = now;
      _lastTapPos = pos;
    }
  }

  void _onTwoFingerTimer() {
    _longPressTimer = null;
    if (_phase != _Phase.twoFinger || _swipeFired || _pointers.length != 2) return;
    _phase = _Phase.wheel;
    _wheelLast = _centroid();
    onWheelStart?.call(_wheelLast);
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
/// [ScrollDeltaAccumulator]; иначе локальный scrollback. Свайп двумя пальцами всегда шлёт стрелку,
/// удержание двух пальцев открывает колесо быстрых действий ([QuickActionWheel]).
class TerminalGestureLayer extends StatefulWidget {
  const TerminalGestureLayer({
    super.key,
    required this.terminal,
    required this.viewKey,
    required this.controller,
    required this.scrollController,
    required this.isTmux,
    required this.write,
    this.quickActions = QuickActionsConfig.defaultActions,
    this.commandGroups = const [],
    this.onAttach,
  });

  final xterm.Terminal terminal;
  final GlobalKey<xterm.TerminalViewState> viewKey;
  final xterm.TerminalController controller;
  final ScrollController scrollController;

  /// tmux-вкладка: локальный scrollback пуст, историю держит сервер.
  final bool isTmux;

  /// Прямая запись в SSH-канал (tmux-мост колеса).
  final void Function(String data) write;

  /// Действия колеса быстрых действий (долгий тап двумя пальцами), по часовой с 12 часов.
  final List<QuickAction> quickActions;

  /// Группы пользовательских команд второго колеса (двойной тап двумя пальцами).
  final List<QuickCommandGroup> commandGroups;

  /// Действие «📎 Файл» колеса: выбрать файл на телефоне и загрузить на сервер.
  final Future<void> Function()? onAttach;

  @override
  State<TerminalGestureLayer> createState() => _TerminalGestureLayerState();
}

class _TerminalGestureLayerState extends State<TerminalGestureLayer> {
  late final TerminalGestureInterpreter _interpreter;
  late final ScrollDeltaAccumulator _tmuxScroll;
  double _mouseWheelPx = 0;
  Offset _longPressOrigin = Offset.zero;

  /// Long-press идёт в mouse mode: вместо выделения xterm пальцы эмулируют мышь для TUI.
  bool _mouseLongPress = false;
  xterm.CellOffset? _lastDragCell;

  /// Последняя сработавшая стрелка свайпа и счётчик — для визуальной подсказки (вспышка в центре).
  AxisDirection? _flashDirection;
  int _flashSeq = 0;

  /// Центр открытого колеса в координатах слоя (уже сдвинутый внутрь границ) и подсвеченный сектор.
  Offset? _wheelCenter;
  int? _wheelHighlight;

  /// Колесо осталось открытым после отпускания в центре: ждёт тапа по сектору или закрытия.
  bool _wheelPinned = false;

  /// Открыто колесо пользовательских команд (двойной тап), а не быстрых действий.
  bool _commandsWheel = false;

  /// Открытая группа в колесе команд; `null` — показан уровень групп.
  int? _commandGroup;

  xterm.TerminalViewState? get _view => widget.viewKey.currentState;

  @override
  void initState() {
    super.initState();
    _tmuxScroll = ScrollDeltaAccumulator(write: (s) => widget.write(s));
    _interpreter = TerminalGestureInterpreter(
      onTap: _onTap,
      onScroll: _onScroll,
      onLongPressStart: _onLongPressStart,
      onLongPressMove: _onLongPressMove,
      onLongPressEnd: _onLongPressEnd,
      onSwipe: _onSwipe,
      onWheelStart: _onWheelStart,
      onWheelMove: _onWheelMove,
      onWheelEnd: _onWheelEnd,
      onWheelCancel: _closeWheel,
      onTwoFingerDoubleTap: _onTwoFingerDoubleTap,
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

  /// В mouse mode (Claude Code и т.п.) выделение рисует само приложение по двойному клику и
  /// протяжке, а локальное выделение xterm TUI перекрывает/сбрасывает. Поэтому long-press = двойной
  /// клик (слово), дальше движение пальца — протяжка с зажатой кнопкой, отпускание — mouse up.
  void _onLongPressStart(Offset p) {
    _longPressOrigin = p;
    if (_view != null && _mouseMode) {
      final cell = _viewportCell(p);
      final t = widget.terminal;
      const left = xterm.TerminalMouseButton.left;
      if (t.mouseInput(left, xterm.TerminalMouseButtonState.down, cell)) {
        t.mouseInput(left, xterm.TerminalMouseButtonState.up, cell);
        t.mouseInput(left, xterm.TerminalMouseButtonState.down, cell);
        _mouseLongPress = true;
        _lastDragCell = cell;
        HapticFeedback.selectionClick();
        return;
      }
    }
    _view?.renderTerminal.selectWord(_local(p));
  }

  void _onLongPressMove(Offset p) {
    if (!_mouseLongPress) {
      _view?.renderTerminal.selectWord(_local(_longPressOrigin), _local(p));
      return;
    }
    final t = widget.terminal;
    // Движение с зажатой кнопкой есть только в режимах 1002/1003 и SGR-кодировке.
    final dragReported = t.mouseMode == xterm.MouseMode.upDownScrollDrag ||
        t.mouseMode == xterm.MouseMode.upDownScrollMove;
    if (!dragReported || t.mouseReportMode != xterm.MouseReportMode.sgr) return;
    final cell = _viewportCell(p);
    if (cell == _lastDragCell) return;
    _lastDragCell = cell;
    // 32 = флаг движения, 0 = левая кнопка.
    widget.write('\x1b[<32;${cell.x + 1};${cell.y + 1}M');
  }

  void _onLongPressEnd(Offset p) {
    if (!_mouseLongPress) return;
    _mouseLongPress = false;
    _lastDragCell = null;
    if (_view == null) return;
    widget.terminal.mouseInput(
      xterm.TerminalMouseButton.left,
      xterm.TerminalMouseButtonState.up,
      _viewportCell(p),
    );
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
      // PgUp/PgDn вместо стрелок: стрелки TUI трактует как историю ввода, а не прокрутку вывода.
      final stepPx = view.renderTerminal.lineHeight * TerminalGestureConfig.altBufferPageLines;
      while (_mouseWheelPx.abs() >= stepPx) {
        final up = _mouseWheelPx > 0;
        t.keyInput(up ? xterm.TerminalKey.pageUp : xterm.TerminalKey.pageDown);
        _mouseWheelPx -= up ? stepPx : -stepPx;
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

  Offset _clampWheelCenter(Offset p) {
    const m = QuickActionsConfig.radiusPx + QuickActionsConfig.edgeMarginPx;
    final size = (context.findRenderObject() as RenderBox?)?.size;
    if (size == null) return p;
    double clamp(double v, double max) => max < 2 * m ? max / 2 : v.clamp(m, max - m);
    return Offset(clamp(p.dx, size.width), clamp(p.dy, size.height));
  }

  /// Подписи секторов открытого колеса (быстрые действия / группы / команды группы).
  List<String> get _wheelLabels {
    if (!_commandsWheel) {
      return [for (final a in widget.quickActions) a.label];
    }
    final group = _commandGroup;
    if (group == null) {
      return [for (final g in widget.commandGroups) g.label];
    }
    return [for (final c in widget.commandGroups[group].commands) c.label];
  }

  int? _sectorAt(Offset p, {double? radius}) {
    final d = p - _wheelCenter!;
    final count = _wheelLabels.length;
    if (count == 0) return null;
    return quickActionSectorAt(
      d.dx,
      d.dy,
      count: count,
      deadZone: QuickActionsConfig.deadZonePx,
      radius: radius,
    );
  }

  void _onWheelStart(Offset p) {
    if (widget.quickActions.isEmpty) {
      _snack('Нет быстрых действий — добавьте их в настройках');
      return;
    }
    if (widget.controller.selection != null) widget.controller.clearSelection();
    HapticFeedback.mediumImpact();
    setState(() {
      _wheelCenter = _clampWheelCenter(p);
      _wheelHighlight = null;
      _wheelPinned = false;
      _commandsWheel = false;
      _commandGroup = null;
    });
  }

  void _onWheelMove(Offset p) {
    if (_wheelCenter == null) return;
    final sector = _sectorAt(p);
    if (sector == _wheelHighlight) return;
    HapticFeedback.selectionClick();
    setState(() => _wheelHighlight = sector);
  }

  void _onWheelEnd(Offset p) {
    if (_wheelCenter == null) return;
    final sector = _sectorAt(p);
    if (sector == null) {
      // Отпустили в центре — оставляем колесо открытым для тапа по сектору.
      setState(() {
        _wheelHighlight = null;
        _wheelPinned = true;
      });
      return;
    }
    _runQuickAction(sector);
    _closeWheel();
  }

  void _onPinnedWheelTap(Offset p) {
    final sector = _sectorAt(p, radius: QuickActionsConfig.radiusPx);
    if (_commandsWheel) {
      _onCommandsWheelTap(p, sector);
      return;
    }
    _closeWheel();
    if (sector != null) _runQuickAction(sector);
  }

  void _onCommandsWheelTap(Offset p, int? sector) {
    if (sector == null) {
      final inCenter = (p - _wheelCenter!).distance < QuickActionsConfig.deadZonePx;
      if (inCenter && _commandGroup != null && widget.commandGroups.length > 1) {
        HapticFeedback.selectionClick();
        setState(() => _commandGroup = null);
      } else {
        _closeWheel();
      }
      return;
    }
    final group = _commandGroup;
    if (group == null) {
      _enterGroup(sector);
      return;
    }
    HapticFeedback.lightImpact();
    final text = widget.commandGroups[group].commands[sector].text;
    _closeWheel();
    widget.terminal.paste(text);
  }

  void _enterGroup(int index) {
    if (widget.commandGroups[index].commands.isEmpty) {
      _snack('Группа «${widget.commandGroups[index].label}» пуста — добавьте команды в настройках');
      return;
    }
    HapticFeedback.selectionClick();
    setState(() => _commandGroup = index);
  }

  void _onTwoFingerDoubleTap(Offset p) {
    final groups = widget.commandGroups.where((g) => g.commands.isNotEmpty).toList();
    if (groups.isEmpty) {
      _snack('Нет быстрых команд — добавьте их в настройках');
      return;
    }
    if (widget.controller.selection != null) widget.controller.clearSelection();
    HapticFeedback.mediumImpact();
    setState(() {
      _wheelCenter = _clampWheelCenter(p);
      _wheelHighlight = null;
      _wheelPinned = true;
      _commandsWheel = true;
      // Одна группа — сразу её команды, без лишнего шага.
      _commandGroup = widget.commandGroups.length == 1 ? 0 : null;
    });
  }

  void _snack(String text) =>
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(text)));

  void _runQuickAction(int index) {
    final action = widget.quickActions[index];
    HapticFeedback.lightImpact();
    switch (action.kind) {
      case QuickActionKind.send:
        widget.write(action.data);
      case QuickActionKind.attach:
        widget.onAttach?.call();
    }
  }

  void _closeWheel() {
    if (!mounted) return;
    setState(() {
      _wheelCenter = null;
      _wheelHighlight = null;
      _wheelPinned = false;
      _commandsWheel = false;
      _commandGroup = null;
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
      onPointerDown: (e) {
        if (!_wheelPinned) _interpreter.pointerDown(e.pointer, e.localPosition);
      },
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
          if (_wheelCenter != null)
            QuickActionWheel(
              center: _wheelCenter!,
              labels: _wheelLabels,
              centerLabel: _commandsWheel && _commandGroup != null && widget.commandGroups.length > 1
                  ? '←'
                  : '✕',
              highlighted: _wheelHighlight,
            ),
          if (_wheelPinned)
            Positioned.fill(
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTapUp: (d) => _onPinnedWheelTap(d.localPosition),
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
