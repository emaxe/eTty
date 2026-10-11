import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:mobile/app/providers/connection_providers.dart';
import 'package:mobile/app/providers/file_tree_providers.dart';
import 'package:mobile/app/providers/host_keys_provider.dart';
import 'package:mobile/app/ssh_connector.dart';
import 'package:mobile/data/connection_store.dart';
import 'package:mobile/domain/ssh_fs_provider.dart';
import 'package:mobile/remote/remote_parse.dart';
import 'package:mobile/remote/remote_scripts.dart';
import 'package:mobile/transport/exec_channel.dart';
import 'package:mobile/transport/ssh_connection.dart';
import 'package:mobile/ui/editor/file_editor_screen.dart';
import 'package:mobile/ui/files/file_tree.dart';

/// Обёртка дерева удалённых файлов (задача #26): устанавливает [SshConnection] для [profile]
/// (та же логика, что `TerminalPage._connect()`), гоняет probe (`RemoteScripts.probeScript`) для
/// `statFlavor`/`find0`/`home`, строит [SshFsProvider] поверх [ExecChannel] и рендерит чистый
/// [FileTree]. Намеренно тонкая — не тестируется юнитами (см. бриф задачи #26), вся проверяемая
/// логика живёт в [FileTree]/`FileTreeController`. Тап по файлу открывает [FileEditorScreen]
/// поверх ТОГО ЖЕ [SshFsProvider] (задача #27) — отдельного подключения редактору не нужно.
///
/// Открывается из `TerminalPage` (кнопка «Файлы» в AppBar).
///
/// Результат маршрута — `String?`: `pop(path)` означает «запустить tmux-сессию в папке `path`»
/// (пункт меню папки; доступен только при `profile.persistence == 'tmux'`), обработка — в
/// `TerminalPage`. `null` — экран закрыт без выбора.
class RemoteFileTreeScreen extends ConsumerStatefulWidget {
  const RemoteFileTreeScreen({super.key, required this.profile});

  final ConnectionProfile profile;

  @override
  ConsumerState<RemoteFileTreeScreen> createState() =>
      _RemoteFileTreeScreenState();
}

class _RemoteFileTreeScreenState extends ConsumerState<RemoteFileTreeScreen> {
  SshConnection? _connection;
  SshFsProvider? _provider;
  String? _rootPath;
  Object? _error;
  bool _connecting = true;

  @override
  void initState() {
    super.initState();
    unawaited(_connect());
  }

  @override
  void dispose() {
    _provider?.dispose();
    _connection?.close();
    super.dispose();
  }

  Future<void> _connect() async {
    setState(() {
      _connecting = true;
      _error = null;
    });
    try {
      final secrets = await ref.read(
        connectionSecretsProvider(widget.profile.id).future,
      );
      final knownHosts = await ref.read(knownHostsStoreProvider.future);
      if (!mounted) return;
      final connection = await connectForProfile(
        context: context,
        profile: widget.profile,
        secrets: secrets,
        knownHosts: knownHosts,
      );
      if (!mounted) {
        connection.close();
        return;
      }

      final exec = ExecChannel(clientSource: connection);
      final probeResult = await exec.exec(RemoteScripts.probeScript, []);
      if (probeResult.exitCode != 0) {
        throw StateError(
          'probe завершился с ошибкой (exit ${probeResult.exitCode})',
        );
      }
      final probe = parseProbe(
        utf8.decode(probeResult.stdout, allowMalformed: true),
      );

      final provider = SshFsProvider(
        exec: exec,
        root: probe.home,
        statFlavorGnu: probe.statFlavor == 'gnu',
        find0: probe.find0,
      );

      if (!mounted) {
        connection.close();
        return;
      }
      setState(() {
        _connection = connection;
        _provider = provider;
        _rootPath = probe.home;
        _connecting = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _connecting = false;
      });
    }
  }

  String _describeError(Object error) {
    if (error is SshConnectException) return error.message;
    return error.toString();
  }

  @override
  Widget build(BuildContext context) {
    if (_connecting) {
      return Scaffold(
        appBar: AppBar(title: Text(widget.profile.label)),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    if (_error != null) {
      return Scaffold(
        appBar: AppBar(title: Text(widget.profile.label)),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Не удалось подключиться:\n${_describeError(_error!)}',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _connect,
                  child: const Text('Повторить'),
                ),
              ],
            ),
          ),
        ),
      );
    }
    final showHidden = ref.watch(showHiddenFilesProvider).value ?? false;
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.profile.label),
        actions: [
          // Иконка показывает ТЕКУЩЕЕ состояние: глаз — скрытые видны, перечёркнутый — скрыты.
          IconButton(
            key: const Key('toggle-hidden-files'),
            icon: Icon(
              showHidden
                  ? Icons.visibility_outlined
                  : Icons.visibility_off_outlined,
            ),
            tooltip: showHidden ? 'Скрыть скрытые' : 'Показать скрытые',
            onPressed: () => ref
                .read(showHiddenFilesProvider.notifier)
                .setEnabled(!showHidden),
          ),
        ],
      ),
      body: FileTree(
        provider: _provider!,
        rootPath: _rootPath!,
        showHidden: showHidden,
        onStartSession: widget.profile.persistence == 'tmux'
            ? (path) => Navigator.of(context).pop<String>(path)
            : null,
        onOpenFile: (path) => Navigator.of(context).push<void>(
          MaterialPageRoute(
            builder: (_) => FileEditorScreen(provider: _provider!, path: path),
          ),
        ),
      ),
    );
  }
}
