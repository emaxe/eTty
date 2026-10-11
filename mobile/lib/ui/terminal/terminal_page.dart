import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:xterm/xterm.dart' as xterm;

import 'package:mobile/app/providers/connection_providers.dart';
import 'package:mobile/app/providers/host_keys_provider.dart';
import 'package:mobile/app/ssh_connector.dart';
import 'package:mobile/app/theme/etty_colors.dart';
import 'package:mobile/app/theme/etty_theme.dart';
import 'package:mobile/data/connection_store.dart';
import 'package:mobile/domain/lifecycle_controller.dart';
import 'package:mobile/domain/tab_controller.dart' as domain;
import 'package:mobile/platform/foreground_service.dart';
import 'package:mobile/transport/exec_channel.dart';
import 'package:mobile/transport/ssh_connection.dart';
import 'package:mobile/ui/files/remote_file_tree_screen.dart';
import 'package:mobile/ui/terminal/input_handler.dart';
import 'package:mobile/ui/terminal/key_bar.dart';
import 'package:mobile/ui/terminal/scroll_bridge.dart';
import 'package:mobile/ui/terminal/tab_strip.dart';

/// Полный clear экрана/scrollback локального `xterm.Terminal` — CSI `\x1b[H\x1b[2J\x1b[3J`
/// (home + clear screen + clear scrollback). Чисто локальная операция отображения, ничего не
/// отправляет на сервер — в отличие от [domain.TabController.write]. Используется перед реаттачем
/// tmux-вкладки (см. [LifecycleController]), чтобы избежать дублирования/сдвига содержимого:
/// опора на историю tmux (`history-limit`), не на локальный буфер xterm.
const String _clearBufferSeq = '\x1b[H\x1b[2J\x1b[3J';

/// Одна вкладка терминала — `TabController` (домен, жизненный цикл SSH-канала) + `xterm.Terminal`
/// (модель отображения) + подписки, связывающие их в обе стороны. Живёт, пока вкладка открыта;
/// [dispose] закрывает канал вкладки, но НЕ трогает общее [SshConnection] (у него могут быть
/// другие вкладки).
///
/// Реализует [LifecycleTab] — адаптер для [LifecycleController] (задача #28): переводит
/// detach/reattach/ресинк, о которых знает только domain-слой, в конкретные действия над
/// `TabController` и `xterm.Terminal`.
class _TerminalTab implements LifecycleTab {
  _TerminalTab({required this.controller})
    : terminal = xterm.Terminal(maxLines: 5000) {
    // sticky.intercept() — единственный путь применить залипающий Ctrl/Alt (REQ-16) к вводу с
    // софт-клавиатуры, см. докстринг StickyModifierController.
    terminal.onOutput = (data) => controller.write(
      Uint8List.fromList(utf8.encode(sticky.intercept(data))),
    );
    terminal.onResize = (cols, rows, pixelWidth, pixelHeight) =>
        controller.resize(cols, rows);
    _outputSub = controller.output
        .cast<List<int>>()
        .transform(const Utf8Decoder(allowMalformed: true))
        .listen(terminal.write);
    _statusSub = controller.status.listen(
      (e) => statusNotifier.value = e.status,
    );
  }

  final domain.TabController controller;
  final xterm.Terminal terminal;
  final StickyModifierController sticky = StickyModifierController();
  final ScrollController scrollController = ScrollController();
  final ValueNotifier<domain.TabConnectionStatus> statusNotifier =
      ValueNotifier(domain.TabConnectionStatus.connecting);

  StreamSubscription<String>? _outputSub;
  StreamSubscription<domain.TabStatusEvent>? _statusSub;

  String get title => controller.sessionName ?? 'ssh';

  /// REQ-14: мост скролла в `WHEEL_SCROLL_*_SEQ` активен только в tmux-режиме — в обычном SSH
  /// scrollback живёт локально в `xterm.Terminal`, нативный скролл `TerminalView` работает как есть.
  @override
  bool get isTmux => controller.persistence == 'tmux';

  /// Прямая инъекция байт в канал (кнопки [KeyBar] — Esc/стрелки/Ctrl+C и т.п.) — минует
  /// `terminal.onOutput`/[sticky], это не «напечатанный пользователем текст».
  void sendRaw(String data) =>
      controller.write(Uint8List.fromList(utf8.encode(data)));

  @override
  String? get sessionName => controller.sessionName;

  @override
  Future<void> detach() => controller.close();

  @override
  Future<void> reattach() => controller.connect();

  @override
  void clearLocalBuffer() => terminal.write(_clearBufferSeq);

  @override
  void applyResyncedState({String? path, bool? busy}) {
    if (path != null) controller.onCwdChange?.call(path);
    if (busy == true) controller.onBusyChange?.call(true);
  }

  void dispose() {
    _outputSub?.cancel();
    _statusSub?.cancel();
    controller.dispose();
    statusNotifier.dispose();
    sticky.dispose();
    scrollController.dispose();
  }
}

/// Экран терминала (задача #22): устанавливает [SshConnection] для [profile], держит несколько
/// вкладок (REQ-9, каждая — свой `ShellSession` через `TabController`, задача #19), рендерит их
/// через `xterm.TerminalView`. Resize под клавиатуру — не отдельный код: `TerminalView.autoResize`
/// (дефолт) сам вызывает `terminal.onResize` при изменении доступного размера, а `Scaffold` по
/// умолчанию ужимает body под системную клавиатуру (REQ-17).
class TerminalPage extends ConsumerStatefulWidget {
  const TerminalPage({super.key, required this.profile, required this.onBack});

  final ConnectionProfile profile;
  final VoidCallback onBack;

  @override
  ConsumerState<TerminalPage> createState() => _TerminalPageState();
}

class _TerminalPageState extends ConsumerState<TerminalPage>
    with WidgetsBindingObserver {
  SshConnection? _connection;
  Object? _connectError;
  bool _connecting = true;
  final List<_TerminalTab> _tabs = [];
  int _activeIndex = 0;

  /// Создаётся вместе с [_connection] (задача #28) — оркестрирует detach/reattach всех вкладок
  /// страницы при уходе приложения в фон/возврате (REQ-11), драйвится из
  /// [didChangeAppLifecycleState].
  LifecycleController? _lifecycleController;

  /// Android foreground service (REQ-19, задача #29) — держит процесс живым, пока эта страница
  /// (и её [_connection]) существует; на iOS/остальных платформах no-op (см. докстринг
  /// [ForegroundService]). Стартует сразу при установлении соединения, а не только на
  /// `paused` — без задержки, без гонки с переходом ОС в фон.
  final ForegroundService _foregroundService = ForegroundService();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_connect());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _lifecycleController?.dispose();
    unawaited(_foregroundService.stop());
    for (final tab in _tabs) {
      tab.dispose();
    }
    _connection?.close();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.paused:
        _lifecycleController?.onPaused();
      case AppLifecycleState.resumed:
        _lifecycleController?.onResumed();
      case AppLifecycleState.inactive:
      case AppLifecycleState.hidden:
      case AppLifecycleState.detached:
        break;
    }
  }

  Future<void> _connect() async {
    setState(() {
      _connecting = true;
      _connectError = null;
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
      setState(() {
        _connection = connection;
        _connecting = false;
      });
      _lifecycleController = LifecycleController(
        exec: ExecChannel(clientSource: connection),
        socketName: widget.profile.tmuxSocket,
      );
      unawaited(_foregroundService.start());
      _addTab();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _connectError = error;
        _connecting = false;
      });
    }
  }

  void _addTab() {
    final connection = _connection;
    if (connection == null) return;
    final takenSessionNames = _tabs
        .map((t) => t.controller.sessionName)
        .whereType<String>();
    final controller = domain.TabController(
      clientSource: connection,
      connectionId: widget.profile.id,
      cols: 80,
      rows: 24,
      persistence: widget.profile.persistence,
      hooksEnabled: widget.profile.hooksEnabled,
      socketName: widget.profile.tmuxSocket,
      takenSessionNames: takenSessionNames,
    );
    final tab = _TerminalTab(controller: controller);
    _lifecycleController?.register(tab);
    setState(() {
      _tabs.add(tab);
      _activeIndex = _tabs.length - 1;
    });
    unawaited(controller.connect());
  }

  void _closeTab(int index) {
    final tab = _tabs[index];
    _lifecycleController?.unregister(tab);
    tab.dispose();
    setState(() {
      _tabs.removeAt(index);
      if (_activeIndex >= _tabs.length) {
        _activeIndex = _tabs.length - 1;
      }
      if (_activeIndex < 0) {
        _activeIndex = 0;
      }
    });
  }

  void _handleBack() {
    widget.onBack();
  }

  String _describeError(Object error) {
    if (error is SshConnectException) return error.message;
    return error.toString();
  }

  @override
  Widget build(BuildContext context) {
    if (_connecting) {
      return Scaffold(
        appBar: AppBar(
          title: Text(widget.profile.label),
          leading: BackButton(onPressed: _handleBack),
        ),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    if (_connectError != null) {
      return Scaffold(
        appBar: AppBar(
          title: Text(widget.profile.label),
          leading: BackButton(onPressed: _handleBack),
        ),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Не удалось подключиться:\n${_describeError(_connectError!)}',
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

    final brightness = Theme.of(context).brightness;
    final palette = brightness == Brightness.dark
        ? EttyPalette.dark
        : EttyPalette.light;
    final terminalTheme = EttyTheme.terminalTheme(palette);

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.profile.label),
        leading: BackButton(onPressed: _handleBack),
        actions: [
          IconButton(
            icon: const Icon(Icons.folder_outlined),
            tooltip: 'Файлы',
            onPressed: () => Navigator.of(context).push<void>(
              MaterialPageRoute(
                builder: (_) => RemoteFileTreeScreen(profile: widget.profile),
              ),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          TabStrip(
            items: [
              for (final tab in _tabs)
                TabStripItem(
                  title: tab.title,
                  status: tab.statusNotifier.value,
                ),
            ],
            activeIndex: _activeIndex,
            onSelect: (i) => setState(() => _activeIndex = i),
            onClose: _closeTab,
            onAdd: _addTab,
          ),
          Expanded(
            child: _tabs.isEmpty
                ? Center(
                    child: FilledButton(
                      onPressed: _addTab,
                      child: const Text('Новая вкладка'),
                    ),
                  )
                : IndexedStack(
                    index: _activeIndex,
                    children: [
                      for (final tab in _tabs)
                        _TerminalTabView(
                          tab: tab,
                          theme: terminalTheme,
                          brightness: brightness,
                        ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

/// Тело одной вкладки: `xterm.TerminalView` + оверлей статуса поверх него, когда канал не в
/// состоянии `connected` (подключается/детач/перехвачена/ошибка — REQ-12).
class _TerminalTabView extends StatelessWidget {
  const _TerminalTabView({
    required this.tab,
    required this.theme,
    required this.brightness,
  });

  final _TerminalTab tab;
  final xterm.TerminalTheme theme;
  final Brightness brightness;

  @override
  Widget build(BuildContext context) {
    // Панель модификаторов (REQ-16) видна, только пока открыта софт-клавиатура — так же, как
    // сама клавиатура, она не нужна, пока пользователь не набирает текст.
    final keyboardVisible = MediaQuery.viewInsetsOf(context).bottom > 0;
    return Column(
      children: [
        Expanded(child: _terminalStack(context)),
        if (keyboardVisible) KeyBar(sticky: tab.sticky, onSend: tab.sendRaw),
      ],
    );
  }

  Widget _terminalStack(BuildContext context) {
    return Stack(
      children: [
        Positioned.fill(
          child: ScrollBridge(
            enabled: tab.isTmux,
            write: tab.sendRaw,
            scrollController: tab.scrollController,
            child: xterm.TerminalView(
              tab.terminal,
              theme: theme,
              autofocus: true,
              keyboardAppearance: brightness,
              scrollController: tab.scrollController,
            ),
          ),
        ),
        ValueListenableBuilder<domain.TabConnectionStatus>(
          valueListenable: tab.statusNotifier,
          builder: (context, status, _) {
            if (status == domain.TabConnectionStatus.connected) {
              return const SizedBox.shrink();
            }
            return _StatusOverlay(
              status: status,
              onReconnect: tab.controller.connect,
            );
          },
        ),
      ],
    );
  }
}

class _StatusOverlay extends StatelessWidget {
  const _StatusOverlay({required this.status, required this.onReconnect});

  final domain.TabConnectionStatus status;
  final VoidCallback onReconnect;

  @override
  Widget build(BuildContext context) {
    switch (status) {
      case domain.TabConnectionStatus.connecting:
        return const ColoredBox(
          color: Colors.black45,
          child: Center(child: CircularProgressIndicator()),
        );
      case domain.TabConnectionStatus.detached:
        return const SizedBox.shrink();
      case domain.TabConnectionStatus.intercepted:
        return _banner(context, 'Сессию перехватил другой клиент', 'Вернуть');
      case domain.TabConnectionStatus.error:
        return _banner(context, 'Соединение разорвано', 'Переподключиться');
      case domain.TabConnectionStatus.connected:
        return const SizedBox.shrink();
    }
  }

  Widget _banner(BuildContext context, String message, String actionLabel) {
    return ColoredBox(
      color: Colors.black54,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(message, style: const TextStyle(color: Colors.white)),
            const SizedBox(height: 12),
            FilledButton(onPressed: onReconnect, child: Text(actionLabel)),
          ],
        ),
      ),
    );
  }
}
