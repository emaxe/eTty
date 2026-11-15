import 'package:flutter/material.dart';

import 'package:mobile/core/config/floating_button_config.dart';
import 'package:mobile/core/config/quick_actions_config.dart';

/// Нижняя панель быстрых действий плавающей кнопки (REQ-6, REQ-11).
///
/// Список панели — сетка с подписями, а не радиальное колесо: элементов больше восьми, подписи
/// должны читаться («📋 Вставить», «⧉ Копировать»). Слой, а не `showModalBottomSheet`: модальный
/// route перехватил бы фокус и спрятал софт-клавиатуру.
///
/// Барьер накрывает всю область терминала и ловит тап: «тап мимо = закрыть». Пока панель открыта,
/// жесты терминала недоступны — это осознанно (REQ-19): первое касание закрывает панель, а не
/// открывает колесо поверх неё.
class QuickActionsPanel extends StatelessWidget {
  const QuickActionsPanel({
    super.key,
    required this.actions,
    required this.onAction,
    required this.onClose,
  });

  final List<QuickAction> actions;

  /// Тап по элементу: выполнить действие и закрыть панель. Оба шага здесь, а не у родителя —
  /// иначе «выполнить без закрытия» и «закрыть без выполнения» разъезжались бы между экранами.
  final void Function(QuickAction action) onAction;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return LayoutBuilder(
      builder: (context, constraints) => Stack(
        children: [
          Positioned.fill(
            child: GestureDetector(
              key: const Key('quick-actions-panel-barrier'),
              behavior: HitTestBehavior.opaque,
              onTap: onClose,
            ),
          ),
          Align(
            alignment: Alignment.bottomCenter,
            child: ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight:
                    constraints.maxHeight *
                    FloatingButtonConfig.panelMaxHeightFactor,
              ),
              child: Padding(
                padding: const EdgeInsets.all(FloatingButtonConfig.marginPx),
                child: Material(
                  key: const Key('quick-actions-panel'),
                  color: scheme.surfaceContainerHigh,
                  elevation: 8,
                  borderRadius: BorderRadius.circular(
                    FloatingButtonConfig.panelRadius,
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: Padding(
                    padding: const EdgeInsets.all(
                      FloatingButtonConfig.panelPadding,
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                'Быстрые действия',
                                style: Theme.of(context).textTheme.titleSmall,
                              ),
                            ),
                            IconButton(
                              key: const Key('quick-actions-panel-close'),
                              icon: const Icon(Icons.close),
                              tooltip: 'Закрыть',
                              onPressed: onClose,
                            ),
                          ],
                        ),
                        Flexible(
                          child: SingleChildScrollView(
                            child: LayoutBuilder(
                              builder: (context, constraints) {
                                const spacing =
                                    FloatingButtonConfig.cellSpacing;
                                final columns = constraints.maxWidth >= 480
                                    ? 4
                                    : 3;
                                final cellWidth =
                                    (constraints.maxWidth -
                                        spacing * (columns - 1)) /
                                    columns;
                                return Wrap(
                                  spacing: spacing,
                                  runSpacing: spacing,
                                  children: [
                                    for (final action in actions)
                                      SizedBox(
                                        width: cellWidth,
                                        child: _PanelButton(
                                          key: Key('panel-action-${action.id}'),
                                          action: action,
                                          onPressed: () {
                                            onAction(action);
                                            onClose();
                                          },
                                        ),
                                      ),
                                  ],
                                );
                              },
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Кнопка сетки — геометрия и цвета как у `_KeyButton` в `key_bar.dart`: панель должна выглядеть
/// частью того же терминального UI, а не отдельным экраном.
class _PanelButton extends StatelessWidget {
  const _PanelButton({
    super.key,
    required this.action,
    required this.onPressed,
  });

  final QuickAction action;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(6),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onPressed,
        child: SizedBox(
          height: FloatingButtonConfig.cellHeight,
          child: Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Text(
                action.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 13),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
