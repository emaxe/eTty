import 'package:mobile/core/config/quick_actions_config.dart';

/// Геометрия и умолчания плавающей кнопки (`ui/terminal/floating_quick_button.dart`) и её панели
/// (`ui/terminal/quick_actions_panel.dart`). Чистый Dart: без `package:flutter`, чтобы размеры и
/// набор по умолчанию можно было сверять юнит-тестами без виджетов.
abstract final class FloatingButtonConfig {
  /// Диаметр кнопки (48 dp — минимальная цель для пальца по гайдлайнам Material).
  static const double buttonSize = 48;

  /// Зазор между кнопкой и краем области терминала; он же предел перетаскивания.
  static const double marginPx = 8;

  static const double iconSize = 22;

  /// Позиция по умолчанию в долях области терминала: правый край, нижняя треть — под большим
  /// пальцем правой руки, не поверх курсора ввода.
  static const double defaultPositionX = 1.0;
  static const double defaultPositionY = 0.74;

  /// Панель: не выше этой доли области терминала, иначе сетка съест сам терминал.
  static const double panelMaxHeightFactor = 0.55;
  static const double panelRadius = 16;
  static const double panelPadding = 12;
  static const double cellSpacing = 8;
  static const double cellHeight = 52;

  /// Последовательности, которые нужны и каталогу кнопки, и её умолчаниям. `⇧⏎` — тот же байт,
  /// что у `_KeyButton` в `key_bar.dart`: kitty-протокол «Shift+Enter» (перевод строки в Claude
  /// Code без отправки промпта).
  static const QuickAction shiftEnter = QuickAction(
    id: 'shift-enter',
    label: '⇧⏎',
    data: '\x1b[13;2u',
  );
  static const QuickAction pasteAction = QuickAction(
    id: 'paste',
    label: '📋 Вставить',
    kind: QuickActionKind.paste,
  );
  static const QuickAction copyAction = QuickAction(
    id: 'copy',
    label: '⧉ Копировать',
    kind: QuickActionKind.copy,
  );

  /// Список по умолчанию (REQ-10). Лимита нет: панель прокручивается, подписи читаются.
  static const List<QuickAction> defaultActions = [
    shiftEnter,
    QuickAction(id: 'ctrl-c', label: '^C', data: '\x03'),
    QuickAction(id: 'esc', label: 'Esc', data: '\x1b'),
    QuickAction(id: 'tab', label: 'Tab', data: '\t'),
    QuickAction(id: 'ctrl-d', label: '^D', data: '\x04'),
    QuickAction(id: 'ctrl-l', label: '^L', data: '\x0c'),
    pasteAction,
    copyAction,
    QuickAction(id: 'attach', label: '📎 Файл', kind: QuickActionKind.attach),
  ];

  static const QuickAction defaultTapAction = shiftEnter;
  static const QuickAction defaultDoubleTapAction = pasteAction;

  /// Свой каталог кнопки: клавиши колеса + буфер. Каталог колеса (REQ-22) при этом не меняется —
  /// в редакторе «Быстрых действий» `Вставить`/`Копировать` по-прежнему не появляются.
  static const List<QuickAction> catalog = [
    shiftEnter,
    ...QuickActionsConfig.catalog,
    pasteAction,
    copyAction,
  ];
}
