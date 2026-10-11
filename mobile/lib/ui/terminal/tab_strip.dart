import 'package:flutter/material.dart';

import 'package:mobile/domain/tab_controller.dart' as domain;

/// Одна вкладка для отображения в [TabStrip] — проекция состояния `_TerminalTab` (см.
/// `terminal_page.dart`), сам виджет ничего не знает про `TabController`/`Terminal`.
class TabStripItem {
  const TabStripItem({required this.title, required this.status});

  final String title;
  final domain.TabConnectionStatus status;
}

/// Горизонтальная полоса вкладок терминала (задача #22, REQ-9) — выбор активной, закрытие,
/// добавление новой. Индикатор статуса — цветная точка: серая (подключается), без точки
/// (подключена — обычное состояние), жёлтая (детач/отключена), красная (перехвачена/ошибка).
class TabStrip extends StatelessWidget {
  const TabStrip({
    super.key,
    required this.items,
    required this.activeIndex,
    required this.onSelect,
    required this.onClose,
    required this.onAdd,
  });

  final List<TabStripItem> items;
  final int activeIndex;
  final ValueChanged<int> onSelect;
  final ValueChanged<int> onClose;
  final VoidCallback onAdd;

  Color? _statusColor(domain.TabConnectionStatus status) {
    switch (status) {
      case domain.TabConnectionStatus.connecting:
        return Colors.grey;
      case domain.TabConnectionStatus.detached:
        return Colors.amber;
      case domain.TabConnectionStatus.intercepted:
      case domain.TabConnectionStatus.error:
        return Colors.red;
      case domain.TabConnectionStatus.connected:
        return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 44,
      child: Row(
        children: [
          Expanded(
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              itemCount: items.length,
              itemBuilder: (context, index) {
                final item = items[index];
                final selected = index == activeIndex;
                final dotColor = _statusColor(item.status);
                return InkWell(
                  onTap: () => onSelect(index),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    decoration: BoxDecoration(
                      border: Border(
                        bottom: BorderSide(
                          color: selected
                              ? Theme.of(context).colorScheme.primary
                              : Colors.transparent,
                          width: 2,
                        ),
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (dotColor != null) ...[
                          Icon(Icons.circle, size: 8, color: dotColor),
                          const SizedBox(width: 6),
                        ],
                        Text(item.title),
                        const SizedBox(width: 4),
                        InkWell(
                          onTap: () => onClose(index),
                          child: const Padding(
                            padding: EdgeInsets.all(4),
                            child: Icon(Icons.close, size: 14),
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          IconButton(
            icon: const Icon(Icons.add),
            tooltip: 'Новая вкладка',
            onPressed: onAdd,
          ),
        ],
      ),
    );
  }
}
