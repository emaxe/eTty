import 'dart:async';
import 'dart:convert';

import 'package:mobile/core/config/ssh_fs_config.dart';
import 'package:mobile/core/config/ssh_session_config.dart';
import 'package:mobile/remote/remote_parse.dart';
import 'package:mobile/remote/remote_scripts.dart';
import 'package:mobile/transport/exec_channel.dart';

/// Свёртывание короче этого порога не запускает detach — экономит цикл detach/reconnect/resync на
/// мимолётные переключения (системный диалог, быстрый свайп в другое приложение). Дольше — сокет
/// всё равно не переживёт фон на iOS (спайк S4 в `docs/plans/mob/plan.md`), детач становится
/// дешевле, чем молча ждать обрыва. Значение эмпирическое, требует калибровки на реальном
/// устройстве (риск «iOS может убивать соединение агрессивнее ожидаемого»); не часть золотого
/// `SshSessionConfig` — мобильная UI-константа жизненного цикла, как `hookFailFastMs` в
/// `tab_controller.dart`.
const int backgroundGraceMs = 5000;

/// Порт для одной вкладки терминала, которой управляет [LifecycleController] — реализуется
/// UI-слоем (`_TerminalTab` в `terminal_page.dart`, задача #22), чтобы этот domain-класс оставался
/// чистым Dart, тестируемым без Flutter/UI (см. докстринг `remote/` в `docs/plans/mob/plan.md`).
abstract class LifecycleTab {
  /// `true`, только если вкладка в tmux-режиме — REQ-11 (clear буфера + ресинк) применяется только
  /// к ней; обычная SSH-вкладка не персистентна, реаттач для неё — просто новое подключение.
  bool get isTmux;

  /// Имя tmux-сессии на сервере — `null` для обычной SSH-вкладки.
  String? get sessionName;

  /// Закрывает канал, НЕ убивая серверную tmux-сессию (`TabController.close()`).
  Future<void> detach();

  /// Переподключается — для tmux-вкладки реаттачит ту же серверную сессию
  /// (`TabController.connect()`, `new-session -A -D`).
  Future<void> reattach();

  /// Полный clear локального экрана/scrollback ПЕРЕД реаттачем — иначе реаттач к персистентной
  /// tmux-сессии может дать дублирование/сдвиг содержимого (риск в `docs/plans/mob/plan.md`);
  /// опора на историю tmux (`history-limit`), не на локальный буфер.
  void clearLocalBuffer();

  /// Применяет результат ресинка `RemoteScripts.tmuxSessionStateScript` — [path] уже выбран между
  /// `currentPath`/`pathFromOsc` (`null`, если оба пусты, ничего не менять), [busy] — `true`, если
  /// исполняется не login-shell, иначе `null` (ресинк никогда сам не СБРАСЫВАЕТ busy — тот же
  /// оптимистичный busy-фолбэк, что на десктопе, `src/renderer/index.js`).
  void applyResyncedState({String? path, bool? busy});
}

enum _LifecycleState {
  /// Приложение на переднем плане (или пауза ещё не превысила grace-период) — каналы вкладок
  /// открыты как обычно.
  attached,

  /// Приложение свёрнуто, grace-таймер ещё тикает — если резюм придёт раньше, ничего не произойдёт.
  pendingDetach,

  /// grace-таймер истёк, каналы вкладок закрыты (REQ-11) — следующий resume реаттачит их.
  detached,
}

/// Свёртывание/возврат приложения на уровне ОС (REQ-11): detach каналов всех вкладок при уходе в
/// фон (после grace-периода, не мгновенно — см. [backgroundGraceMs]) и реаттач при возврате, с
/// полным clear локального буфера и одноразовым ресинком cwd/busy через
/// `RemoteScripts.tmuxSessionStateScript` для каждой tmux-вкладки. Управляет несколькими вкладками
/// сразу — драйвится из `WidgetsBindingObserver.didChangeAppLifecycleState` в UI-слое
/// (`terminal_page.dart`), сам не знает про Flutter.
///
/// НЕ отвечает за жизненный цикл одного канала (см. `domain/tab_controller.dart`) — только
/// оркестрирует detach/reattach + ресинк поверх уже существующих [LifecycleTab].
class LifecycleController {
  LifecycleController({
    required this.exec,
    this.socketName = SshSessionConfig.defaultSocket,
    Duration graceDuration = const Duration(milliseconds: backgroundGraceMs),
  }) : _graceDuration = graceDuration;

  /// Канал для одноразовых ресинк-exec'ов (`ExecChannel` на общем `SshConnection` страницы
  /// терминала) — не связан ни с одной конкретной вкладкой.
  final RemoteExec exec;

  final String socketName;
  final Duration _graceDuration;

  final List<LifecycleTab> _tabs = [];
  _LifecycleState _state = _LifecycleState.attached;
  Timer? _graceTimer;

  void register(LifecycleTab tab) => _tabs.add(tab);

  void unregister(LifecycleTab tab) => _tabs.remove(tab);

  /// Вызывается при уходе приложения в фон (`AppLifecycleState.paused`). Идемпотентно — повторный
  /// вызов, пока grace-таймер уже тикает или каналы уже закрыты, ничего не делает.
  void onPaused() {
    if (_state != _LifecycleState.attached) return;
    _state = _LifecycleState.pendingDetach;
    _graceTimer = Timer(_graceDuration, _fireDetach);
  }

  /// Вызывается при возврате приложения на передний план (`AppLifecycleState.resumed`).
  void onResumed() {
    switch (_state) {
      case _LifecycleState.attached:
        return;
      case _LifecycleState.pendingDetach:
        _graceTimer?.cancel();
        _graceTimer = null;
        _state = _LifecycleState.attached;
      case _LifecycleState.detached:
        _state = _LifecycleState.attached;
        unawaited(_reattachAll());
    }
  }

  void _fireDetach() {
    _graceTimer = null;
    if (_state != _LifecycleState.pendingDetach) return;
    _state = _LifecycleState.detached;
    unawaited(_detachAll());
  }

  Future<void> _detachAll() {
    return Future.wait(_tabs.map((tab) => tab.detach()));
  }

  Future<void> _reattachAll() {
    return Future.wait(_tabs.map(_reattachOne));
  }

  Future<void> _reattachOne(LifecycleTab tab) async {
    if (tab.isTmux) tab.clearLocalBuffer();
    await tab.reattach();
    if (tab.isTmux) await _resync(tab);
  }

  Future<void> _resync(LifecycleTab tab) async {
    final sessionName = tab.sessionName;
    if (sessionName == null) return;
    try {
      final result = await exec.exec(
        RemoteScripts.tmuxSessionStateScript,
        [socketName, sessionName],
        timeout: const Duration(milliseconds: SshFsConfig.opTimeoutMs),
      );
      if (result.exitCode != 0) return;
      final state = parseTmuxSessionState(
        utf8.decode(result.stdout, allowMalformed: true),
      );
      if (state == null) return;

      final path = state.currentPath.isNotEmpty
          ? state.currentPath
          : state.pathFromOsc;
      final busy = _looksLikeShell(state.currentCommand) ? null : true;
      if (path.isEmpty && busy == null) return;
      tab.applyResyncedState(path: path.isEmpty ? null : path, busy: busy);
    } catch (_) {
      // Best-effort ресинк — вкладка уже переподключена; пропущенное обновление cwd/busy
      // подхватится следующим промптом через обычный OSC-путь (osc_tap.dart).
    }
  }

  /// Порт `looksLikeShell` из `src/renderer/index.js`: пустая команда или один из основных
  /// shell'ов (с необязательным `-` — login-shell), без пути исполняемого файла.
  static final RegExp _shellCommandRe = RegExp(
    r'^-?(zsh|bash|sh|fish|csh|tcsh|dash)$',
  );

  bool _looksLikeShell(String currentCommand) =>
      currentCommand.isEmpty || _shellCommandRe.hasMatch(currentCommand);

  /// Отменяет ожидающий grace-таймер — вызывать при закрытии страницы терминала.
  void dispose() {
    _graceTimer?.cancel();
    _graceTimer = null;
  }
}
