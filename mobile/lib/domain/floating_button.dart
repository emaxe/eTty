import 'dart:convert';

import 'package:mobile/core/config/floating_button_config.dart';
import 'package:mobile/core/config/quick_actions_config.dart';
import 'package:mobile/domain/quick_actions.dart';

/// Состояние плавающей кнопки целиком (REQ-15) — один JSON в `AppSettingsStore`, а не пять
/// отдельных ключей: иначе легко получить «включено, но без списка» после частичной записи.
class FloatingButtonSettings {
  const FloatingButtonSettings({
    this.enabled = true,
    this.positionX = FloatingButtonConfig.defaultPositionX,
    this.positionY = FloatingButtonConfig.defaultPositionY,
    this.tapAction = FloatingButtonConfig.defaultTapAction,
    this.doubleTapAction = FloatingButtonConfig.defaultDoubleTapAction,
    this.actions = FloatingButtonConfig.defaultActions,
  });

  /// Кнопка показывается в терминале (REQ-1). По умолчанию включена.
  final bool enabled;

  /// Левый верхний угол в долях области терминала (0..1), а не в пикселях: позиция переживает
  /// поворот, смену разрешения и открытую клавиатуру (REQ-3). Пиксели считает виджет.
  final double positionX;
  final double positionY;

  /// Что делает одиночный и двойной тап (REQ-4, REQ-5, REQ-14).
  final QuickAction tapAction;
  final QuickAction doubleTapAction;

  /// Список панели по долгому нажатию (REQ-8…REQ-11).
  final List<QuickAction> actions;

  FloatingButtonSettings copyWith({
    bool? enabled,
    double? positionX,
    double? positionY,
    QuickAction? tapAction,
    QuickAction? doubleTapAction,
    List<QuickAction>? actions,
  }) => FloatingButtonSettings(
    enabled: enabled ?? this.enabled,
    positionX: positionX ?? this.positionX,
    positionY: positionY ?? this.positionY,
    tapAction: tapAction ?? this.tapAction,
    doubleTapAction: doubleTapAction ?? this.doubleTapAction,
    actions: actions ?? this.actions,
  );

  Map<String, Object?> toJson() => {
    'enabled': enabled,
    'x': positionX,
    'y': positionY,
    'tap': tapAction.toJson(),
    'doubleTap': doubleTapAction.toJson(),
    'actions': [for (final a in actions) a.toJson()],
  };
}

String encodeFloatingButton(FloatingButtonSettings settings) => jsonEncode(settings.toJson());

/// `null` — JSON битый, структура неверна или неизвестный вид действия: вызывающая сторона берёт
/// умолчания. Координаты вне 0..1 зажимаются (правка руками/старая версия), а не роняют настройки.
FloatingButtonSettings? decodeFloatingButton(String? json) {
  if (json == null || json.isEmpty) return null;
  try {
    final raw = jsonDecode(json);
    if (raw is! Map) return null;
    final enabled = raw['enabled'];
    final x = raw['x'];
    final y = raw['y'];
    final actions = decodeQuickActionList(raw['actions']);
    final tap = decodeQuickAction(raw['tap']);
    final doubleTap = decodeQuickAction(raw['doubleTap']);
    if (enabled is! bool || x is! num || y is! num || tap == null || doubleTap == null) {
      return null;
    }
    if (actions == null) return null;
    return FloatingButtonSettings(
      enabled: enabled,
      positionX: _unit(x),
      positionY: _unit(y),
      tapAction: tap,
      doubleTapAction: doubleTap,
      actions: actions,
    );
  } on FormatException {
    return null;
  }
}

double _unit(num value) {
  final v = value.toDouble();
  if (v.isNaN) return 0;
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}
