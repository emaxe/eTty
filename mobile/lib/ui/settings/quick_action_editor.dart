import 'package:flutter/material.dart';

import 'package:mobile/core/config/quick_actions_config.dart';
import 'package:mobile/domain/quick_actions.dart';

/// Общий редактор списка быстрых действий: колесо (тап тремя пальцами) и панель плавающей кнопки.
/// Отличаются только каталогом и лимитом: у колеса 8 секторов (`QuickActionsConfig.maxActions`),
/// у панели лимита нет — она прокручивается.
///
/// Держать две копии редактора нельзя: у них одна модель (`QuickAction`), один парсер
/// последовательностей и одни правила снеков/сброса, любая правка разъезжается.
class QuickActionEditorList extends StatelessWidget {
  const QuickActionEditorList({
    super.key,
    required this.actions,
    required this.onChanged,
    required this.catalog,
  });

  final List<QuickAction> actions;

  /// Новый порядок/список — экран сам решает, куда его сохранить.
  final Future<void> Function(List<QuickAction> actions) onChanged;
  final List<QuickAction> catalog;

  @override
  Widget build(BuildContext context) {
    if (actions.isEmpty) {
      return const Center(child: Text('Нет действий. Добавьте первое.'));
    }
    return ReorderableListView.builder(
      padding: const EdgeInsets.only(bottom: 88),
      itemCount: actions.length,
      onReorderItem: (from, to) {
        final next = [...actions];
        next.insert(to, next.removeAt(from));
        onChanged(next);
      },
      itemBuilder: (context, i) {
        final action = actions[i];
        return Dismissible(
          key: ValueKey(action.id),
          direction: DismissDirection.endToStart,
          background: Container(
            color: Theme.of(context).colorScheme.errorContainer,
            alignment: Alignment.centerRight,
            padding: const EdgeInsets.only(right: 16),
            child: const Icon(Icons.delete_outline),
          ),
          onDismissed: (_) => onChanged([...actions]..removeAt(i)),
          child: ListTile(
            title: Text(action.label),
            subtitle: Text(quickActionSubtitle(action)),
            leading: const Icon(Icons.drag_handle),
            onTap: () async {
              final edited = await promptAction(context, initial: action);
              if (edited == null) return;
              final next = [...actions];
              next[i] = edited;
              await onChanged(next);
            },
          ),
        );
      },
    );
  }
}

/// Кнопка «Добавить» для `Scaffold.floatingActionButton`; `null` — лимит списка исчерпан.
Widget? quickActionAddButton(
  BuildContext context, {
  required List<QuickAction> actions,
  required Future<void> Function(List<QuickAction> actions) onChanged,
  required List<QuickAction> catalog,
  int? maxItems,
  String label = 'Действие',
}) {
  if (maxItems != null && actions.length >= maxItems) return null;
  return FloatingActionButton.extended(
    key: const Key('add-action'),
    icon: const Icon(Icons.add),
    label: Text(label),
    onPressed: () async {
      final added = await pickNewAction(
        context,
        existing: actions,
        catalog: catalog,
      );
      if (added == null) return;
      await onChanged([...actions, added]);
    },
  );
}

String quickActionSubtitle(QuickAction action) => switch (action.kind) {
  QuickActionKind.send => formatKeySequence(action.data),
  QuickActionKind.paste => 'Вставить из буфера обмена',
  QuickActionKind.copy => 'Копировать выделение',
  QuickActionKind.attach => 'Выбор и загрузка файла',
};

const _customChoice = '__custom__';

String _newId() => 'a-${DateTime.now().microsecondsSinceEpoch}';

/// Новое действие: из каталога (ещё не добавленные) или своя клавиша.
Future<QuickAction?> pickNewAction(
  BuildContext context, {
  required List<QuickAction> existing,
  required List<QuickAction> catalog,
}) async {
  final usedIds = {for (final a in existing) a.id};
  final available = [
    for (final a in catalog)
      if (!usedIds.contains(a.id)) a,
  ];
  final choice = await showModalBottomSheet<Object>(
    context: context,
    isScrollControlled: true,
    builder: (context) => SafeArea(
      child: ListView(
        key: const Key('action-picker-list'),
        shrinkWrap: true,
        children: [
          ListTile(
            key: const Key('add-custom-action'),
            leading: const Icon(Icons.keyboard_outlined),
            title: const Text('Своя клавиша…'),
            onTap: () => Navigator.pop(context, _customChoice),
          ),
          for (final a in available)
            ListTile(
              key: Key('catalog-${a.id}'),
              title: Text(a.label),
              subtitle: Text(quickActionSubtitle(a)),
              onTap: () => Navigator.pop(context, a),
            ),
        ],
      ),
    ),
  );
  if (choice is QuickAction) return choice;
  if (choice == _customChoice && context.mounted) return promptAction(context);
  return null;
}

/// Подпись + последовательность клавиши. У `paste`/`copy`/`attach` правится только подпись:
/// поведение задано кодом, подсунуть туда последовательность нельзя.
Future<QuickAction?> promptAction(
  BuildContext context, {
  QuickAction? initial,
}) {
  final editableSequence =
      initial == null || initial.kind == QuickActionKind.send;
  final label = TextEditingController(text: initial?.label ?? '');
  final seq = TextEditingController(
    text: initial == null || !editableSequence
        ? ''
        : formatKeySequence(initial.data),
  );
  String? error;
  return showDialog<QuickAction>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, setState) => AlertDialog(
        title: Text(initial == null ? 'Своя клавиша' : 'Действие'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              key: const Key('action-label'),
              controller: label,
              autofocus: true,
              decoration: const InputDecoration(labelText: 'Подпись в меню'),
            ),
            if (editableSequence) ...[
              const SizedBox(height: 8),
              TextField(
                key: const Key('action-seq'),
                controller: seq,
                decoration: InputDecoration(
                  labelText: 'Последовательность',
                  helperText: r'^C, \e, \e[A, \r, \x1b, \t',
                  errorText: error,
                ),
              ),
            ],
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () {
              final l = label.text.trim();
              if (l.isEmpty) return;
              if (initial != null && !editableSequence) {
                Navigator.pop(context, initial.copyWith(label: l));
                return;
              }
              final data = parseKeySequence(seq.text);
              if (data == null) {
                setState(() => error = 'Неверная последовательность');
                return;
              }
              Navigator.pop(
                context,
                initial?.copyWith(label: l, data: data) ??
                    QuickAction(id: _newId(), label: l, data: data),
              );
            },
            child: const Text('Сохранить'),
          ),
        ],
      ),
    ),
  );
}
