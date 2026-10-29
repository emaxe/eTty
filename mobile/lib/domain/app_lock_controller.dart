import 'dart:async';

import 'package:mobile/data/biometric_gate.dart';

enum AppLockState {
  /// Контент приложения виден — либо блокировка выключена в настройках, либо только что успешно
  /// прошла [AppLockController.tryUnlock].
  unlocked,

  /// Контент скрыт за [LockScreen] (задача #30, `ui/settings/lock_screen.dart`) — ждёт
  /// [AppLockController.tryUnlock].
  locked,

  /// [AppLockController.tryUnlock] ждёт ответа ОС (диалог Face ID/отпечатка) — отдельное
  /// состояние, а не просто "locked", чтобы UI не показывал кнопку «Разблокировать» поверх уже
  /// открытого системного диалога.
  authenticating,
}

/// Опциональная биометрическая блокировка приложения (REQ-18) — чистый Dart, тестируемый без
/// Flutter/`local_auth` (см. докстринг `remote/` в `docs/plans/mob/plan.md` про тот же приём).
/// Настройка (`enabled`) и решение «когда запросить relock» — снаружи: `_RootShell` в `main.dart`
/// зовёт [relock] на `AppLifecycleState.paused` и синхронизирует [setEnabled] с
/// `AppSettingsStore`/`biometricLockEnabledProvider`; сам контроллер не знает ни про жизненный
/// цикл ОС, ни про хранилище настроек.
class AppLockController {
  AppLockController({required this.gate, bool enabled = false})
    : _enabled = enabled; // ignore: prefer_initializing_formals

  final BiometricGate gate;
  bool _enabled;

  AppLockState _state = AppLockState.unlocked;
  AppLockState get state => _state;

  final StreamController<AppLockState> _controller =
      StreamController<AppLockState>.broadcast();
  Stream<AppLockState> get onStateChanged => _controller.stream;

  /// Живое включение/выключение настройки без пересоздания контроллера — тумблер на
  /// `SettingsScreen` меняет её мгновенно, до следующего relock/старта приложения.
  void setEnabled(bool enabled) => _enabled = enabled;

  /// Просит показать [LockScreen] при следующей отрисовке — no-op, если блокировка выключена или
  /// уже заблокирован/аутентифицируется (идемпотентно, как `TabController.close()`).
  void relock() {
    if (!_enabled || _state != AppLockState.unlocked) return;
    _setState(AppLockState.locked);
  }

  /// Запрашивает подтверждение у [gate]. Если состояние уже [AppLockState.unlocked] (блокировка
  /// выключена либо уже разблокировано), возвращает `true` немедленно, не трогая `local_auth`.
  Future<bool> tryUnlock() async {
    if (_state == AppLockState.unlocked) return true;
    _setState(AppLockState.authenticating);
    final ok = await gate.authenticate();
    _setState(ok ? AppLockState.unlocked : AppLockState.locked);
    return ok;
  }

  void _setState(AppLockState next) {
    _state = next;
    if (!_controller.isClosed) _controller.add(next);
  }

  void dispose() => _controller.close();
}
