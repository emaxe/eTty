import 'dart:async';

import 'package:flutter/material.dart';

import 'package:mobile/domain/tmux_sessions.dart';
import 'package:mobile/remote/remote_parse.dart';

/// Уже готовый [TmuxSessionsService] + функция закрытия ресурсов, которыми владеет его фабрика
/// (обычно отдельное `SshConnection` — панель сессий сервера НЕ переиспользует подключение
/// открытой вкладки терминала, см. докстринг [TmuxSessionsSheet]). Отделено от
/// [TmuxSessionsServiceFactory], чтобы тесты могли подставить сервис на фейковом `RemoteExec`,
/// минуя реальную сеть — тогда [close] просто ничего не делает.
class TmuxSessionsHandle {
  const TmuxSessionsHandle({required this.service, required this.close});

  final TmuxSessionsService service;

  /// Вызывается ПОСЛЕ [TmuxSessionsService.dispose] при закрытии панели.
  final Future<void> Function() close;
}

typedef TmuxSessionsServiceFactory = Future<TmuxSessionsHandle> Function();

/// Панель сессий сервера (REQ-15, задача #25): список tmux-сессий сокета профиля — включая
/// созданные не через eTty, kill/rename, автополлинг через [TmuxSessionsService]. Не завязана на
/// `ConnectionProfile`/Riverpod напрямую — только на уже готовую фабрику сервиса
/// ([createService]), которую собирает вызывающая сторона (`ConnectionsScreen`: там есть и
/// `BuildContext` для TOFU/keyboard-interactive диалогов `connectForProfile`, и `WidgetRef` для
/// провайдеров секретов/known-hosts). Это же делает панель тестируемой — виджет-тесты подставляют
/// фабрику с фейковым `RemoteExec` вместо похода в сеть.
///
/// Панель открывается и БЕЗ открытой вкладки терминала (прямо из списка подключений), поэтому
/// держит СВОЁ подключение, а не переиспользует то, что использует `TerminalPage`; закрывает его
/// при закрытии панели (см. [dispose]).
class TmuxSessionsSheet extends StatefulWidget {
  const TmuxSessionsSheet({
    super.key,
    required this.title,
    required this.createService,
  });

  /// Заголовок панели (обычно `profile.label`).
  final String title;
  final TmuxSessionsServiceFactory createService;

  @override
  State<TmuxSessionsSheet> createState() => _TmuxSessionsSheetState();
}

class _TmuxSessionsSheetState extends State<TmuxSessionsSheet> {
  TmuxSessionsHandle? _handle;
  StreamSubscription<List<TmuxSessionInfo>>? _sub;

  bool _loading = true;
  Object? _initError;
  Object? _pollError;
  List<TmuxSessionInfo> _sessions = const [];

  @override
  void initState() {
    super.initState();
    unawaited(_init());
  }

  Future<void> _init() async {
    setState(() {
      _loading = true;
      _initError = null;
    });
    TmuxSessionsHandle? handle;
    try {
      handle = await widget.createService();
      final sessions = await handle.service.list();
      if (!mounted) {
        handle.service.dispose();
        await handle.close();
        return;
      }
      setState(() {
        _handle = handle;
        _sessions = sessions;
        _loading = false;
      });
      handle.service.startPolling();
      _sub = handle.service.onSessionsChanged.listen(
        (sessions) {
          if (!mounted) return;
          setState(() {
            _sessions = sessions;
            _pollError = null;
          });
        },
        onError: (Object error) {
          if (!mounted) return;
          setState(() => _pollError = error);
        },
      );
    } catch (error) {
      if (handle != null) {
        handle.service.dispose();
        await handle.close();
      }
      if (!mounted) return;
      setState(() {
        _initError = error;
        _loading = false;
      });
    }
  }

  @override
  void dispose() {
    _sub?.cancel();
    _handle?.service.dispose();
    unawaited(_handle?.close());
    super.dispose();
  }

  String _describeError(Object error) {
    if (error is TmuxSessionsException) {
      switch (error.code) {
        case TmuxSessionsErrorCode.noTmux:
          return 'tmux не установлен на сервере';
        case TmuxSessionsErrorCode.notFound:
          return 'Сессия уже не существует';
        case TmuxSessionsErrorCode.nameTaken:
          return 'Имя уже занято';
        case TmuxSessionsErrorCode.invalidName:
        case TmuxSessionsErrorCode.timeout:
        case TmuxSessionsErrorCode.io:
          return error.message;
      }
    }
    return error.toString();
  }

  void _showSnackBar(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _kill(TmuxSessionInfo session) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Завершить сессию?'),
        content: Text('Сессия «${session.name}» будет завершена.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Отмена'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Завершить'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final handle = _handle;
    if (handle == null) return;
    try {
      await handle.service.kill(session.name);
      if (mounted) {
        setState(() {
          _sessions = _sessions.where((s) => s.name != session.name).toList();
        });
      }
      handle.service.refreshSoon();
    } catch (error) {
      if (mounted) _showSnackBar(_describeError(error));
    }
  }

  Future<void> _rename(TmuxSessionInfo session) async {
    final newName = await showDialog<String>(
      context: context,
      builder: (context) => _RenameSessionDialog(initialName: session.name),
    );
    if (newName == null || newName == session.name) return;
    final handle = _handle;
    if (handle == null) return;
    try {
      await handle.service.rename(session.name, newName);
      handle.service.refreshSoon();
    } catch (error) {
      if (mounted) _showSnackBar(_describeError(error));
    }
  }

  static String _formatTime(int millis) {
    final dt = DateTime.fromMillisecondsSinceEpoch(millis);
    String two(int n) => n.toString().padLeft(2, '0');
    return '${dt.year}-${two(dt.month)}-${two(dt.day)} ${two(dt.hour)}:${two(dt.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.75,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'Сессии сервера — ${widget.title}',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close),
                    tooltip: 'Закрыть',
                    onPressed: () => Navigator.of(context).maybePop(),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(child: _body(context)),
          ],
        ),
      ),
    );
  }

  Widget _body(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_initError != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_describeError(_initError!), textAlign: TextAlign.center),
              const SizedBox(height: 16),
              FilledButton(onPressed: _init, child: const Text('Повторить')),
            ],
          ),
        ),
      );
    }
    if (_sessions.isEmpty) {
      return const Center(child: Text('Нет активных сессий'));
    }
    return Column(
      children: [
        if (_pollError != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Text(
              _describeError(_pollError!),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        Expanded(
          child: ListView(
            children: [
              for (final session in _sessions)
                _SessionTile(
                  key: ValueKey(session.name),
                  session: session,
                  formatTime: _formatTime,
                  onKill: () => _kill(session),
                  onRename: () => _rename(session),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Диалог переименования — СВОЙ `StatefulWidget` (не инлайн-`TextEditingController` в вызывающем
/// методе), чтобы фреймворк освободил контроллер в [dispose] уже ПОСЛЕ того, как closing-анимация
/// `AlertDialog` реально доиграет: `Navigator.pop()` резолвит `Future` из `showDialog` раньше, чем
/// завершится transition, и синхронный `controller.dispose()` сразу за `await showDialog(...)`
/// рушится на "used after being disposed" — тот же приём, что уже применён в
/// `KeyboardInteractiveDialog` (`app/ssh_connector.dart`).
class _RenameSessionDialog extends StatefulWidget {
  const _RenameSessionDialog({required this.initialName});

  final String initialName;

  @override
  State<_RenameSessionDialog> createState() => _RenameSessionDialogState();
}

class _RenameSessionDialogState extends State<_RenameSessionDialog> {
  late final TextEditingController _controller = TextEditingController(
    text: widget.initialName,
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Переименовать сессию'),
      content: TextField(
        controller: _controller,
        autofocus: true,
        decoration: const InputDecoration(labelText: 'Новое имя'),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Отмена'),
        ),
        FilledButton(
          onPressed: () {
            final value = _controller.text.trim();
            if (value.isEmpty) return;
            Navigator.of(context).pop(value);
          },
          child: const Text('Переименовать'),
        ),
      ],
    );
  }
}

class _SessionTile extends StatelessWidget {
  const _SessionTile({
    super.key,
    required this.session,
    required this.formatTime,
    required this.onKill,
    required this.onRename,
  });

  final TmuxSessionInfo session;
  final String Function(int millis) formatTime;
  final VoidCallback onKill;
  final VoidCallback onRename;

  @override
  Widget build(BuildContext context) {
    final activityAt = session.activityAt;
    final currentCommand = session.currentCommand;
    final subtitleParts = [
      '${session.windows} окон',
      'создана ${formatTime(session.createdAt)}',
      if (activityAt != null) 'активность ${formatTime(activityAt)}',
      ?currentCommand,
    ];
    return ListTile(
      title: Text(session.name),
      subtitle: Text(subtitleParts.join(' · ')),
      leading: session.attached > 0
          ? Chip(
              key: Key('tmux-attached-${session.name}'),
              label: Text('активна · ${session.attached}'),
              visualDensity: VisualDensity.compact,
            )
          : const Icon(Icons.terminal_outlined),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            key: Key('tmux-rename-${session.name}'),
            icon: const Icon(Icons.edit_outlined),
            tooltip: 'Переименовать',
            onPressed: onRename,
          ),
          IconButton(
            key: Key('tmux-kill-${session.name}'),
            icon: const Icon(Icons.close),
            tooltip: 'Завершить',
            onPressed: onKill,
          ),
        ],
      ),
    );
  }
}
