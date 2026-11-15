import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:mobile/app/providers/quick_actions_providers.dart';
import 'package:mobile/core/config/quick_actions_config.dart';
import 'package:mobile/ui/settings/quick_action_editor.dart';
import 'package:mobile/ui/settings/settings_dialogs.dart';

/// Редактор колеса быстрых действий (тап тремя пальцами в терминале). Порядок списка —
/// порядок секторов по часовой стрелке с 12 часов. Каждое изменение сразу сохраняется.
///
/// Каталог колеса намеренно не содержит `Вставить`/`Копировать` (REQ-22): буфер живёт в панели
/// плавающей кнопки, у колеса свой набор клавиш.
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
              PopupMenuItem(
                value: 'reset',
                child: Text('Сбросить к стандартным'),
              ),
            ],
          ),
        ],
      ),
      floatingActionButton: actions == null
          ? null
          : quickActionAddButton(
              context,
              actions: actions,
              onChanged: notifier.save,
              catalog: QuickActionsConfig.catalog,
              maxItems: QuickActionsConfig.maxActions,
            ),
      body: actions == null
          ? const Center(child: CircularProgressIndicator())
          : QuickActionEditorList(
              actions: actions,
              onChanged: notifier.save,
              catalog: QuickActionsConfig.catalog,
            ),
    );
  }
}
