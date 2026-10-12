import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'package:mobile/core/config/quick_actions_config.dart';

/// Радиальное меню быстрых действий: кольцо из секторов вокруг [center] (координаты слоя),
/// в центре — мёртвая зона с [centerLabel] (✕ закрыть, ← назад). Сам жесты не обрабатывает — выбор
/// сектора считает слой через [quickActionSectorAt].
class QuickActionWheel extends StatelessWidget {
  const QuickActionWheel({
    super.key,
    required this.center,
    required this.labels,
    this.centerLabel = '✕',
    this.highlighted,
  });

  final Offset center;
  final List<String> labels;
  final String centerLabel;
  final int? highlighted;

  @override
  Widget build(BuildContext context) {
    const r = QuickActionsConfig.radiusPx;
    final scheme = Theme.of(context).colorScheme;
    return Positioned(
      left: center.dx - r,
      top: center.dy - r,
      width: r * 2,
      height: r * 2,
      child: TweenAnimationBuilder<double>(
        tween: Tween(begin: 0.6, end: 1),
        duration: const Duration(milliseconds: 120),
        curve: Curves.easeOut,
        builder: (context, t, child) => Opacity(
          opacity: t.clamp(0.0, 1.0),
          child: Transform.scale(scale: t, child: child),
        ),
        child: CustomPaint(
          painter: _WheelPainter(
            labels: labels,
            centerLabel: centerLabel,
            highlighted: highlighted,
            highlightColor: scheme.primary,
            fontFamily: Theme.of(context).textTheme.bodyMedium?.fontFamily,
          ),
        ),
      ),
    );
  }
}

class _WheelPainter extends CustomPainter {
  _WheelPainter({
    required this.labels,
    required this.centerLabel,
    required this.highlighted,
    required this.highlightColor,
    required this.fontFamily,
  });

  final List<String> labels;
  final String centerLabel;
  final int? highlighted;
  final Color highlightColor;
  final String? fontFamily;

  @override
  void paint(Canvas canvas, Size size) {
    const outer = QuickActionsConfig.radiusPx;
    const inner = QuickActionsConfig.deadZonePx;
    final c = size.center(Offset.zero);
    final n = labels.length;
    final step = 2 * math.pi / n;
    const gap = 0.02;

    final base = Paint()..color = Colors.black.withValues(alpha: 0.72);
    final hi = Paint()..color = highlightColor;
    for (var i = 0; i < n; i++) {
      // Сектор i центрирован на 12 часах + i * step (по часовой).
      final start = -math.pi / 2 + i * step - step / 2 + gap;
      final sweep = step - gap * 2;
      final path = Path()
        ..arcTo(Rect.fromCircle(center: c, radius: outer), start, sweep, true)
        ..arcTo(Rect.fromCircle(center: c, radius: inner), start + sweep, -sweep, false)
        ..close();
      canvas.drawPath(path, i == highlighted ? hi : base);

      final mid = -math.pi / 2 + i * step;
      final labelPos = c + Offset(math.cos(mid), math.sin(mid)) * ((outer + inner) / 2);
      _paintText(canvas, labels[i], labelPos, 14, maxWidth: 62);
    }

    canvas.drawCircle(c, inner - 2, base);
    _paintText(canvas, centerLabel, c, 16);
  }

  void _paintText(
    Canvas canvas,
    String text,
    Offset center,
    double fontSize, {
    double maxWidth = double.infinity,
  }) {
    final tp = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          color: Colors.white,
          fontSize: fontSize,
          fontFamily: fontFamily,
          fontWeight: FontWeight.w500,
        ),
      ),
      textDirection: TextDirection.ltr,
      textAlign: TextAlign.center,
      maxLines: 2,
      ellipsis: '…',
    )..layout(maxWidth: maxWidth);
    tp.paint(canvas, center - Offset(tp.width / 2, tp.height / 2));
  }

  @override
  bool shouldRepaint(_WheelPainter old) =>
      old.highlighted != highlighted ||
      old.highlightColor != highlightColor ||
      old.centerLabel != centerLabel ||
      !listEquals(old.labels, labels);
}
