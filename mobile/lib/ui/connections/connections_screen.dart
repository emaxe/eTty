import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:mobile/app/providers/connection_providers.dart';
import 'package:mobile/app/providers/host_keys_provider.dart';
import 'package:mobile/app/ssh_connector.dart';
import 'package:mobile/data/connection_store.dart';
import 'package:mobile/domain/tmux_sessions.dart';
import 'package:mobile/transport/exec_channel.dart';
import 'package:mobile/transport/ssh_connection.dart';
import 'package:mobile/ui/connections/connection_form_screen.dart';
import 'package:mobile/ui/connections/ettyx_import.dart';
import 'package:mobile/ui/connections/tmux_sessions_sheet.dart';
import 'package:mobile/ui/settings/settings_screen.dart';

/// Собирает [TmuxSessionsHandle] для панели сессий сервера (задача #25): своё, отдельное от
/// вкладок терминала, [SshConnection] + [ExecChannel] поверх него — см. докстринг
/// [TmuxSessionsSheet] про то, почему подключение отдельное.
Future<TmuxSessionsHandle> _createTmuxSessionsHandle(
  BuildContext context,
  WidgetRef ref,
  ConnectionProfile profile,
) async {
  final secrets = await ref.read(connectionSecretsProvider(profile.id).future);
  final knownHosts = await ref.read(knownHostsStoreProvider.future);
  // Панель могла закрыться, пока ждали секреты/known-hosts — `context` здесь принадлежит
  // builder'у showModalBottomSheet, не State, поэтому проверяем mounted вручную (тот же приём,
  // что `if (!mounted) return;` в `TerminalPage._connect()`).
  if (!context.mounted) {
    throw const SshConnectException(
      SshConnectFailureKind.other,
      'Панель закрыта до установления подключения',
    );
  }
  final connection = await connectForProfile(
    context: context,
    profile: profile,
    secrets: secrets,
    knownHosts: knownHosts,
  );
  return TmuxSessionsHandle(
    service: TmuxSessionsService(
      exec: ExecChannel(clientSource: connection),
      socket: profile.tmuxSocket,
    ),
    close: () async => connection.close(),
  );
}

Future<void> _openTmuxSessions(
  BuildContext context,
  WidgetRef ref,
  ConnectionProfile profile,
) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (sheetContext) => TmuxSessionsSheet(
      title: profile.label,
      createService: () =>
          _createTmuxSessionsHandle(sheetContext, ref, profile),
    ),
  );
}

/// Экран подключений (задача #21) — список профилей из [connectionsProvider], CRUD через
/// [ConnectionFormScreen]. Секреты сюда не попадают вообще: экран работает только с
/// [ConnectionProfile] (не-секретные поля), секреты живут отдельно за [ConnectionSecrets]/
/// `saveSecrets` (REQ-18).
class ConnectionsScreen extends ConsumerWidget {
  const ConnectionsScreen({super.key, required this.onOpen});

  final void Function(ConnectionProfile profile) onOpen;

  Future<void> _openForm(BuildContext context, {ConnectionProfile? initial}) {
    return Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => ConnectionFormScreen(initial: initial)),
    );
  }

  Future<bool> _confirmDelete(BuildContext context, String label) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Удалить подключение?'),
        content: Text(
          'Профиль «$label» будет удалён вместе с сохранёнными секретами.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Отмена'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Удалить'),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final connectionsAsync = ref.watch(connectionsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Подключения'),
        actions: [
          IconButton(
            icon: const Icon(Icons.file_upload_outlined),
            tooltip: 'Импорт подключений (.ettyx)',
            onPressed: () => importEttyxFile(context, ref),
          ),
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            tooltip: 'Настройки',
            onPressed: () => Navigator.of(context).push<void>(
              MaterialPageRoute(builder: (_) => const SettingsScreen()),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.add),
            tooltip: 'Добавить подключение',
            onPressed: () => _openForm(context),
          ),
        ],
      ),
      body: connectionsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) =>
            Center(child: Text('Не удалось загрузить подключения: $error')),
        data: (profiles) {
          if (profiles.isEmpty) {
            return _EmptyState(onAdd: () => _openForm(context));
          }
          return ListView.builder(
            itemCount: profiles.length,
            itemBuilder: (context, index) {
              final profile = profiles[index];
              return Dismissible(
                key: ValueKey(profile.id),
                direction: DismissDirection.endToStart,
                background: Container(
                  color: Theme.of(context).colorScheme.errorContainer,
                  alignment: Alignment.centerRight,
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Icon(
                    Icons.delete_outline,
                    color: Theme.of(context).colorScheme.onErrorContainer,
                  ),
                ),
                confirmDismiss: (_) => _confirmDelete(context, profile.label),
                onDismissed: (_) =>
                    ref.read(connectionsProvider.notifier).remove(profile.id),
                child: _ConnectionTile(
                  profile: profile,
                  onTap: () => onOpen(profile),
                  onEdit: () => _openForm(context, initial: profile),
                  onSessions: () => _openTmuxSessions(context, ref, profile),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onAdd});

  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.dns_outlined,
              size: 48,
              color: Theme.of(context).colorScheme.outline,
            ),
            const SizedBox(height: 16),
            Text(
              'Пока нет ни одного подключения',
              style: Theme.of(context).textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: onAdd,
              icon: const Icon(Icons.add),
              label: const Text('Добавить'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Один профиль в списке — тап открывает соединение ([ConnectionsScreen.onOpen]), кнопка
/// карандаша — форму редактирования. Бейдж показывает режим персистентности (REQ-10): `tmux`
/// (дефолт на мобилке) или обычный `ssh`.
class _ConnectionTile extends StatelessWidget {
  const _ConnectionTile({
    required this.profile,
    required this.onTap,
    required this.onEdit,
    required this.onSessions,
  });

  final ConnectionProfile profile;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onSessions;

  @override
  Widget build(BuildContext context) {
    final isTmux = profile.persistence == 'tmux';
    final address = profile.port == 22
        ? '${profile.username}@${profile.host}'
        : '${profile.username}@${profile.host}:${profile.port}';

    return ListTile(
      onTap: onTap,
      leading: CircleAvatar(
        child: Icon(isTmux ? Icons.all_inclusive : Icons.bolt),
      ),
      title: Text(profile.label),
      subtitle: Text(address),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Chip(
            label: Text(isTmux ? 'tmux' : 'ssh'),
            visualDensity: VisualDensity.compact,
          ),
          IconButton(
            icon: const Icon(Icons.list_alt_outlined),
            tooltip: 'Сессии сервера',
            onPressed: onSessions,
          ),
          IconButton(
            icon: const Icon(Icons.edit_outlined),
            tooltip: 'Редактировать',
            onPressed: onEdit,
          ),
        ],
      ),
    );
  }
}
