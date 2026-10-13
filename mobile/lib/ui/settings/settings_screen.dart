import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:mobile/app/providers/app_lock_providers.dart';
import 'package:mobile/data/biometric_gate.dart';
import 'package:mobile/ui/settings/quick_actions_screen.dart';
import 'package:mobile/ui/settings/quick_commands_screen.dart';

/// Экран настроек приложения (задача #30) — сейчас единственный пункт: тумблер биометрической
/// блокировки (REQ-18). Скрывает тумблер, если [BiometricGate.isAvailable] возвращает `false`
/// (на устройстве нет настроенной биометрии/кода-пароля — включать нечем).
class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  bool? _biometricAvailable;

  @override
  void initState() {
    super.initState();
    unawaited(_checkAvailability());
  }

  Future<void> _checkAvailability() async {
    final available = await ref.read(biometricGateProvider).isAvailable;
    if (!mounted) return;
    setState(() => _biometricAvailable = available);
  }

  @override
  Widget build(BuildContext context) {
    final enabledAsync = ref.watch(biometricLockEnabledProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Настройки')),
      body: ListView(
        children: [
          ListTile(
            key: const Key('open-quick-actions'),
            leading: const Icon(Icons.radar_outlined),
            title: const Text('Быстрые действия'),
            subtitle: const Text('Меню по долгому тапу двумя пальцами в терминале'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () =>
                Navigator.of(context)
                    .push(MaterialPageRoute<void>(builder: (_) => const QuickActionsScreen())),
          ),
          ListTile(
            key: const Key('open-quick-commands'),
            leading: const Icon(Icons.bolt_outlined),
            title: const Text('Быстрые команды'),
            subtitle: const Text('Меню по двойному тапу двумя пальцами в терминале'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => const QuickCommandsScreen()),
            ),
          ),
          if (_biometricAvailable == false)
            const ListTile(
              leading: Icon(Icons.info_outline),
              title: Text('Биометрия недоступна'),
              subtitle: Text(
                'На устройстве не настроены Face ID/отпечаток/код-пароль.',
              ),
            )
          else
            enabledAsync.when(
              loading: () => const ListTile(
                title: Text('Биометрическая блокировка'),
                trailing: SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
              error: (error, _) => ListTile(
                title: const Text('Биометрическая блокировка'),
                subtitle: Text('Ошибка: $error'),
              ),
              data: (enabled) => SwitchListTile(
                title: const Text('Биометрическая блокировка'),
                subtitle: const Text(
                  'Требовать Face ID/отпечаток при запуске и возврате в приложение',
                ),
                value: enabled,
                onChanged: (value) => ref
                    .read(biometricLockEnabledProvider.notifier)
                    .setEnabled(value),
              ),
            ),
        ],
      ),
    );
  }
}
