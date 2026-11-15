import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:mobile/app/providers/floating_button_providers.dart';
import 'package:mobile/core/config/floating_button_config.dart';
import 'package:mobile/core/config/quick_actions_config.dart';
import 'package:mobile/ui/settings/quick_action_editor.dart';
import 'package:mobile/ui/settings/settings_dialogs.dart';

/// Настройки плавающей кнопки терминала (REQ-13): тумблер, назначения тапов и список панели по
/// долгому нажатию. Каждое изменение сразу сохраняется — экран не накапливает «черновик»,
/// который можно потерять, уйдя назад.
///
/// Список панели редактируется общим [QuickActionEditorList], но с каталогом кнопки: в нём есть
/// `Вставить`/`Копировать`, которых нет у колеса (REQ-22).
class FloatingButtonScreen extends ConsumerWidget {
  const FloatingButtonScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = ref.watch(floatingButtonProvider).value;
    final notifier = ref.read(floatingButtonProvider.notifier);
    const catalog = FloatingButtonConfig.catalog;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Плавающая кнопка'),
        actions: [
          PopupMenuButton<String>(
            onSelected: (_) async {
              final ok = await confirmDialog(
                context,
                'Сбросить к стандартным?',
                'Включение, позиция, тапы и список кнопок будут заменены стандартными.',
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
      floatingActionButton: settings == null
          ? null
          : quickActionAddButton(
              context,
              actions: settings.actions,
              onChanged: (actions) =>
                  notifier.save(settings.copyWith(actions: actions)),
              catalog: catalog,
            ),
      body: settings == null
          ? const Center(child: CircularProgressIndicator())
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SwitchListTile(
                  key: const Key('floating-enabled'),
                  title: const Text('Показывать кнопку'),
                  subtitle: const Text(
                    'Кнопка поверх терминала в активном подключении',
                  ),
                  value: settings.enabled,
                  onChanged: (enabled) =>
                      notifier.save(settings.copyWith(enabled: enabled)),
                ),
                _TapActionTile(
                  key: const Key('floating-tap'),
                  title: 'Одиночный тап',
                  action: settings.tapAction,
                  catalog: catalog,
                  onPicked: (action) =>
                      notifier.save(settings.copyWith(tapAction: action)),
                ),
                _TapActionTile(
                  key: const Key('floating-double-tap'),
                  title: 'Двойной тап',
                  action: settings.doubleTapAction,
                  catalog: catalog,
                  onPicked: (action) =>
                      notifier.save(settings.copyWith(doubleTapAction: action)),
                ),
                const Divider(height: 1),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                  child: Text(
                    'Кнопки панели (долгое нажатие)',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                Expanded(
                  child: QuickActionEditorList(
                    actions: settings.actions,
                    onChanged: (actions) =>
                        notifier.save(settings.copyWith(actions: actions)),
                    catalog: catalog,
                  ),
                ),
              ],
            ),
    );
  }
}

/// Строка выбора действия для тапа. Каталог полный, без фильтра «уже в списке»: одно и то же
/// действие имеет право быть и кнопкой панели, и реакцией на тап (REQ-14).
class _TapActionTile extends StatelessWidget {
  const _TapActionTile({
    super.key,
    required this.title,
    required this.action,
    required this.catalog,
    required this.onPicked,
  });

  final String title;
  final QuickAction action;
  final List<QuickAction> catalog;
  final void Function(QuickAction action) onPicked;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      title: Text(title),
      subtitle: Text('${action.label} · ${quickActionSubtitle(action)}'),
      trailing: const Icon(Icons.chevron_right),
      onTap: () async {
        final picked = await pickNewAction(
          context,
          existing: const [],
          catalog: catalog,
        );
        if (picked == null) return;
        onPicked(picked);
      },
    );
  }
}
