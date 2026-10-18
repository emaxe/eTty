import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:mobile/app/providers/quick_actions_providers.dart';
import 'package:mobile/core/config/quick_actions_config.dart';
import 'package:mobile/domain/quick_actions.dart';
import 'package:mobile/ui/settings/settings_dialogs.dart';

String _newId() => 'a-${DateTime.now().microsecondsSinceEpoch}';

/// Редактор колеса быстрых действий (тап тремя пальцами в терминале). Порядок списка —
/// порядок секторов по часовой стрелке с 12 часов. Каждое изменение сразу сохраняется.
class QuickActionsScreen extends ConsumerWidget {
  const QuickActionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final actions = ref.watch(quickActionsProvider).value;
    final notifier = ref.read(quickActionsProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Быстрые действия'),
        actions: [
          PopupMenuButton<String>(
            onSelected: (_) async {
              final ok = await confirmDialog(
                context,
                'Сбросить к стандартным?',
                'Набор действий будет заменён стандартным.',
              );
              if (ok) await notifier.resetToDefaults();
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'reset', child: Text('Сбросить к стандартным')),
            ],
          ),
        ],
      ),
      floatingActionButton: actions == null || actions.length >= QuickActionsConfig.maxActions
          ? null
          : FloatingActionButton.extended(
              key: const Key('add-action'),
              icon: const Icon(Icons.add),
              label: const Text('Действие'),
              onPressed: () async {
                final added = await _pickNew(context, actions);
                if (added == null) return;
                await notifier.save([...actions, added]);
              },
            ),
      body: actions == null
          ? const Center(child: CircularProgressIndicator())
          : actions.isEmpty
          ? const Center(child: Text('Нет действий. Добавьте первое.'))
          : ReorderableListView.builder(
              padding: const EdgeInsets.only(bottom: 88),
              itemCount: actions.length,
              onReorderItem: (from, to) {
                final next = [...actions];
                next.insert(to, next.removeAt(from));
                notifier.save(next);
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
                  onDismissed: (_) => notifier.save([...actions]..removeAt(i)),
                  child: ListTile(
                    title: Text(action.label),
                    subtitle: Text(
                      action.kind == QuickActionKind.attach
                          ? 'Выбор и загрузка файла'
                          : formatKeySequence(action.data),
                    ),
                    leading: const Icon(Icons.drag_handle),
                    onTap: () async {
                      final edited = await _promptAction(context, initial: action);
                      if (edited == null) return;
                      final next = [...actions];
                      next[i] = edited;
                      await notifier.save(next);
                    },
                  ),
                );
              },
            ),
    );
  }
}

const _customChoice = '__custom__';

/// Новое действие: из каталога (ещё не добавленные) или своя клавиша.
Future<QuickAction?> _pickNew(BuildContext context, List<QuickAction> existing) async {
  final usedIds = {for (final a in existing) a.id};
  final available = [
    for (final a in QuickActionsConfig.catalog)
      if (!usedIds.contains(a.id)) a,
  ];
  final choice = await showModalBottomSheet<Object>(
    context: context,
    isScrollControlled: true,
    builder: (context) => SafeArea(
      child: ListView(
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
              subtitle: a.kind == QuickActionKind.attach
                  ? const Text('Выбор и загрузка файла')
                  : Text(formatKeySequence(a.data)),
              onTap: () => Navigator.pop(context, a),
            ),
        ],
      ),
    ),
  );
  if (choice is QuickAction) return choice;
  if (choice == _customChoice && context.mounted) return _promptAction(context);
  return null;
}

/// Подпись + последовательность клавиши; для вложения файла правится только подпись.
Future<QuickAction?> _promptAction(BuildContext context, {QuickAction? initial}) {
  final isAttach = initial?.kind == QuickActionKind.attach;
  final label = TextEditingController(text: initial?.label ?? '');
  final seq = TextEditingController(text: initial == null ? '' : formatKeySequence(initial.data));
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
              decoration: const InputDecoration(labelText: 'Подпись в колесе'),
            ),
            if (!isAttach) ...[
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
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Отмена')),
          FilledButton(
            onPressed: () {
              final l = label.text.trim();
              if (l.isEmpty) return;
              if (isAttach) {
                Navigator.pop(context, initial!.copyWith(label: l));
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
