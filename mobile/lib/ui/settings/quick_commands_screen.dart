import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:mobile/app/providers/quick_commands_providers.dart';
import 'package:mobile/core/config/quick_actions_config.dart';
import 'package:mobile/domain/quick_commands.dart';
import 'package:mobile/ui/settings/settings_dialogs.dart';

String _newId(String prefix) => '$prefix-${DateTime.now().microsecondsSinceEpoch}';

/// Редактор групп пользовательских команд (второе колесо терминала: двойной тап двумя пальцами).
/// Каждое изменение сразу сохраняется через [QuickCommandsNotifier.save].
class QuickCommandsScreen extends ConsumerWidget {
  const QuickCommandsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final groups = ref.watch(quickCommandsProvider).value;
    final notifier = ref.read(quickCommandsProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Быстрые команды'),
        actions: [
          PopupMenuButton<String>(
            onSelected: (_) async {
              final ok = await confirmDialog(
                context,
                'Сбросить к стандартным?',
                'Все свои группы и команды будут заменены примерами.',
              );
              if (ok) await notifier.resetToDefaults();
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'reset', child: Text('Сбросить к стандартным')),
            ],
          ),
        ],
      ),
      floatingActionButton: groups == null || groups.length >= QuickActionsConfig.maxGroups
          ? null
          : FloatingActionButton.extended(
              key: const Key('add-group'),
              icon: const Icon(Icons.add),
              label: const Text('Группа'),
              onPressed: () async {
                final label = await promptTextDialog(context, 'Новая группа', 'Название');
                if (label == null) return;
                await notifier.save([
                  ...groups,
                  QuickCommandGroup(id: _newId('g'), label: label, commands: const []),
                ]);
              },
            ),
      body: groups == null
          ? const Center(child: CircularProgressIndicator())
          : groups.isEmpty
          ? const Center(child: Text('Нет групп. Добавьте первую.'))
          : ReorderableListView.builder(
              padding: const EdgeInsets.only(bottom: 88),
              itemCount: groups.length,
              onReorderItem: (from, to) {
                final next = [...groups];
                next.insert(to, next.removeAt(from));
                notifier.save(next);
              },
              itemBuilder: (context, i) {
                final group = groups[i];
                return ListTile(
                  key: ValueKey(group.id),
                  title: Text(group.label),
                  subtitle: Text('Команд: ${group.commands.length}'),
                  leading: const Icon(Icons.drag_handle),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        icon: const Icon(Icons.edit_outlined),
                        tooltip: 'Переименовать',
                        onPressed: () async {
                          final label = await promptTextDialog(
                            context,
                            'Переименовать группу',
                            'Название',
                            initial: group.label,
                          );
                          if (label == null) return;
                          final next = [...groups];
                          next[i] = group.copyWith(label: label);
                          await notifier.save(next);
                        },
                      ),
                      IconButton(
                        icon: const Icon(Icons.delete_outline),
                        tooltip: 'Удалить',
                        onPressed: () async {
                          final ok = await confirmDialog(
                            context,
                            'Удалить группу «${group.label}»?',
                            'Вместе с её командами.',
                          );
                          if (!ok) return;
                          await notifier.save([...groups]..removeAt(i));
                        },
                      ),
                    ],
                  ),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => QuickCommandGroupScreen(groupId: group.id),
                    ),
                  ),
                );
              },
            ),
    );
  }
}

/// Команды одной группы: подпись (в секторе колеса) + текст (вставляется без Enter).
class QuickCommandGroupScreen extends ConsumerWidget {
  const QuickCommandGroupScreen({super.key, required this.groupId});

  final String groupId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final groups = ref.watch(quickCommandsProvider).value ?? const [];
    final index = groups.indexWhere((g) => g.id == groupId);
    if (index < 0) {
      return Scaffold(appBar: AppBar(), body: const Center(child: Text('Группа удалена')));
    }
    final group = groups[index];
    final notifier = ref.read(quickCommandsProvider.notifier);

    Future<void> saveCommands(List<QuickCommand> commands) {
      final next = [...groups];
      next[index] = group.copyWith(commands: commands);
      return notifier.save(next);
    }

    return Scaffold(
      appBar: AppBar(title: Text(group.label)),
      floatingActionButton: group.commands.length >= QuickActionsConfig.maxCommandsPerGroup
          ? null
          : FloatingActionButton.extended(
              key: const Key('add-command'),
              icon: const Icon(Icons.add),
              label: const Text('Команда'),
              onPressed: () async {
                final result = await _promptCommand(context);
                if (result == null) return;
                await saveCommands([
                  ...group.commands,
                  QuickCommand(id: _newId('c'), label: result.$1, text: result.$2),
                ]);
              },
            ),
      body: group.commands.isEmpty
          ? const Center(child: Text('Нет команд. Добавьте первую.'))
          : ReorderableListView.builder(
              padding: const EdgeInsets.only(bottom: 88),
              itemCount: group.commands.length,
              onReorderItem: (from, to) {
                final next = [...group.commands];
                next.insert(to, next.removeAt(from));
                saveCommands(next);
              },
              itemBuilder: (context, i) {
                final command = group.commands[i];
                return Dismissible(
                  key: ValueKey(command.id),
                  direction: DismissDirection.endToStart,
                  background: Container(
                    color: Theme.of(context).colorScheme.errorContainer,
                    alignment: Alignment.centerRight,
                    padding: const EdgeInsets.only(right: 16),
                    child: const Icon(Icons.delete_outline),
                  ),
                  onDismissed: (_) => saveCommands([...group.commands]..removeAt(i)),
                  child: ListTile(
                    title: Text(command.label),
                    subtitle: Text(command.text, maxLines: 2, overflow: TextOverflow.ellipsis),
                    leading: const Icon(Icons.drag_handle),
                    onTap: () async {
                      final result = await _promptCommand(context, initial: command);
                      if (result == null) return;
                      final next = [...group.commands];
                      next[i] = command.copyWith(label: result.$1, text: result.$2);
                      await saveCommands(next);
                    },
                  ),
                );
              },
            ),
    );
  }
}

/// (подпись, текст) или `null` при отмене/пустых полях.
Future<(String, String)?> _promptCommand(BuildContext context, {QuickCommand? initial}) {
  final label = TextEditingController(text: initial?.label ?? '');
  final text = TextEditingController(text: initial?.text ?? '');
  return showDialog<(String, String)>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(initial == null ? 'Новая команда' : 'Команда'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            key: const Key('command-label'),
            controller: label,
            autofocus: true,
            decoration: const InputDecoration(labelText: 'Подпись в меню'),
          ),
          const SizedBox(height: 8),
          TextField(
            key: const Key('command-text'),
            controller: text,
            minLines: 2,
            maxLines: 5,
            decoration: const InputDecoration(
              labelText: 'Текст',
              helperText: 'Вставляется без Enter',
            ),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Отмена')),
        FilledButton(
          onPressed: () {
            final l = label.text.trim();
            final t = text.text.trim();
            Navigator.pop(context, l.isEmpty || t.isEmpty ? null : (l, t));
          },
          child: const Text('Сохранить'),
        ),
      ],
    ),
  );
}
