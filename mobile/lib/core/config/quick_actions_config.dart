import 'dart:math' as math;

enum QuickActionKind {
  /// Записать [QuickAction.data] в SSH-канал.
  send,

  /// Выбрать файл на телефоне, загрузить на сервер и вставить путь.
  attach,
}

/// Быстрое действие колеса: что отправить в SSH-канал по выбору сектора.
class QuickAction {
  const QuickAction({
    required this.id,
    required this.label,
    this.data = '',
    this.kind = QuickActionKind.send,
  });

  final String id;
  final String label;
  final QuickActionKind kind;

  /// Сырые байты/текст для записи в канал. Слэш-команды — без `\r`: Enter жмёт пользователь.
  final String data;
}

/// Колесо быстрых действий терминала (`quick_action_wheel.dart`). Только мобильный UI.
abstract final class QuickActionsConfig {
  /// По часовой стрелке, начиная с 12 часов.
  static const List<QuickAction> actions = [
    QuickAction(id: 'ctrl-c', label: '^C', data: '\x03'),
    QuickAction(id: 'esc', label: 'Esc', data: '\x1b'),
    QuickAction(id: 'shift-tab', label: '⇧Tab', data: '\x1b[Z'),
    QuickAction(id: 'ctrl-o', label: '^O', data: '\x0f'),
    QuickAction(id: 'ctrl-d', label: '^D', data: '\x04'),
    QuickAction(id: 'ctrl-l', label: '^L', data: '\x0c'),
    QuickAction(id: 'attach', label: '📎 Файл', kind: QuickActionKind.attach),
  ];

  /// Внешний радиус колеса.
  static const double radiusPx = 120;

  /// Радиус центральной мёртвой зоны: отпускание в ней закрепляет колесо, тап — закрывает.
  static const double deadZonePx = 34;

  /// Лимиты пользовательских команд второго колеса (`quick_commands.dart`): больше секторов —
  /// подписи не помещаются.
  static const int maxGroups = 8;
  static const int maxCommandsPerGroup = 8;

  /// Минимальный зазор между колесом и краем терминала.
  static const double edgeMarginPx = 8;
}

/// Индекс сектора для смещения ([dx], [dy]) от центра колеса или `null` в мёртвой зоне
/// (и за [radius], если он задан). Сектор 0 центрирован на 12 часах, дальше по часовой стрелке.
int? quickActionSectorAt(
  double dx,
  double dy, {
  required int count,
  required double deadZone,
  double? radius,
}) {
  final dist = math.sqrt(dx * dx + dy * dy);
  if (dist < deadZone) return null;
  if (radius != null && dist > radius) return null;
  final step = 2 * math.pi / count;
  // Угол от 12 часов по часовой стрелке (ось y экрана направлена вниз).
  var angle = math.atan2(dx, -dy);
  if (angle < 0) angle += 2 * math.pi;
  return ((angle + step / 2) / step).floor() % count;
}
