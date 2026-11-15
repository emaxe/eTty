import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'package:mobile/core/config/floating_button_config.dart';
import 'package:mobile/domain/floating_button.dart';

/// Перетаскиваемая кнопка быстрых действий поверх терминала (REQ-1…REQ-7).
///
/// Живёт внутри `Positioned.fill` области терминала, но занимает место только под собой: `Stack`
/// с единственным `Positioned`-ребёнком не перехватывает касания вне кнопки, поэтому остальная
/// площадь продолжает получать жесты терминала (REQ-17).
///
/// Позиция хранится нормализованными координатами (0..1) и пересчитывается в пиксели по текущему
/// размеру области — поэтому поворот экрана и открытая клавиатура не выносят кнопку за границы
/// (REQ-3). Пиксели наружу отдаются тоже нормализованными: виджет-родитель просто сохраняет их.
class FloatingQuickButton extends StatefulWidget {
  const FloatingQuickButton({
    super.key,
    required this.settings,
    required this.onTap,
    required this.onDoubleTap,
    required this.onLongPress,
    required this.onMoved,
  });

  final FloatingButtonSettings settings;

  /// Одиночный тап: сработает только после окна различения двойного тапа (иначе двойной тап
  /// сначала отправлял бы одиночное действие).
  final VoidCallback onTap;
  final VoidCallback onDoubleTap;
  final VoidCallback onLongPress;

  /// Кнопку отпустили после перетаскивания — новая нормализованная позиция.
  final void Function(double x, double y) onMoved;

  @override
  State<FloatingQuickButton> createState() => _FloatingQuickButtonState();
}

class _FloatingQuickButtonState extends State<FloatingQuickButton> {
  /// Пиксельная позиция во время перетаскивания; `null` — считаем из настроек.
  Offset? _drag;

  /// Нормализованная позиция, отданная в [FloatingQuickButton.onMoved] и ещё не подтверждённая
  /// настройками. Запись в хранилище асинхронная, поэтому без неё кнопка на кадр-два прыгала бы
  /// назад к старой позиции и только потом возвращалась на новую.
  (double, double)? _pending;

  static const double _size = FloatingButtonConfig.buttonSize;
  static const double _margin = FloatingButtonConfig.marginPx;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final area = Size(constraints.maxWidth, constraints.maxHeight);
        final position = _clamp(
          _drag ?? _fromPending(area) ?? _fromSettings(area),
          area,
        );
        return Stack(
          children: [
            Positioned(
              left: position.dx,
              top: position.dy,
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: widget.onTap,
                onDoubleTap: widget.onDoubleTap,
                onLongPress: widget.onLongPress,
                onPanStart: (_) => setState(() {
                  _drag = position;
                  _pending = null;
                }),
                onPanUpdate: (details) => setState(() {
                  _drag = _clamp((_drag ?? position) + details.delta, area);
                }),
                onPanEnd: (_) {
                  final moved = _drag;
                  if (moved == null) {
                    setState(() => _drag = null);
                    return;
                  }
                  final x = _normalizeX(moved.dx, area);
                  final y = _normalizeY(moved.dy, area);
                  setState(() {
                    _drag = null;
                    _pending = (x, y);
                  });
                  widget.onMoved(x, y);
                },
                child: _buttonFace(context),
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buttonFace(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      key: const Key('floating-quick-button'),
      color: scheme.primary,
      elevation: 6,
      shape: const CircleBorder(),
      child: SizedBox(
        width: _size,
        height: _size,
        child: Icon(
          Icons.bolt,
          size: FloatingButtonConfig.iconSize,
          color: scheme.onPrimary,
        ),
      ),
    );
  }

  /// Настройки изменились — источник истины они, локальную позицию отпускаем. Сравниваем с
  /// *предыдущими* настройками: если родитель ещё не записал новую позицию, они те же, и кнопка
  /// должна остаться там, куда её отпустили, а не прыгнуть назад.
  @override
  void didUpdateWidget(FloatingQuickButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.settings.positionX != oldWidget.settings.positionX ||
        widget.settings.positionY != oldWidget.settings.positionY) {
      _pending = null;
    }
  }

  Offset? _fromPending(Size area) {
    final pending = _pending;
    if (pending == null) return null;
    return Offset(
      _margin + pending.$1 * _span(area.width),
      _margin + pending.$2 * _span(area.height),
    );
  }

  Offset _fromSettings(Size area) => Offset(
    _margin + widget.settings.positionX * _span(area.width),
    _margin + widget.settings.positionY * _span(area.height),
  );

  Offset _clamp(Offset o, Size area) => Offset(
    o.dx.clamp(_margin, _margin + _span(area.width)),
    o.dy.clamp(_margin, _margin + _span(area.height)),
  );

  double _normalizeX(double left, Size area) => _normalize(left, area.width);

  double _normalizeY(double top, Size area) => _normalize(top, area.height);

  double _normalize(double value, double total) {
    final span = _span(total);
    if (span <= 0) return 0;
    return ((value - _margin) / span).clamp(0.0, 1.0);
  }

  double _span(double total) => math.max(0, total - _size - 2 * _margin);
}
