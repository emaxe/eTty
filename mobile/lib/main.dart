import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:mobile/app/providers/app_lock_providers.dart';
import 'package:mobile/app/theme/etty_colors.dart';
import 'package:mobile/app/theme/etty_theme.dart';
import 'package:mobile/data/connection_store.dart';
import 'package:mobile/domain/app_lock_controller.dart';
import 'package:mobile/ui/connections/connections_screen.dart';
import 'package:mobile/ui/settings/lock_screen.dart';
import 'package:mobile/ui/terminal/terminal_page.dart';

void main() {
  runApp(const ProviderScope(child: EttyApp()));
}

class EttyApp extends StatelessWidget {
  const EttyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'eTty',
      debugShowCheckedModeBanner: false,
      theme: EttyTheme.themeData(EttyPalette.light),
      darkTheme: EttyTheme.themeData(EttyPalette.dark),
      themeMode: ThemeMode.system,
      home: const _RootShell(),
    );
  }
}

/// Простейший роутер приложения без пакета навигации (в `pubspec.yaml` его нет — только
/// `dartssh2`/`xterm`/`flutter_riverpod`/... из `docs/plans/mob/plan.md`): один открытый профиль
/// за раз, `null` — список подключений (задача #21), иначе — экран терминала (задача #22).
/// `ConnectionsScreen`/`TerminalScreen` самодостаточны (сами читают провайдеры), общаются с этим
/// шеллом только через колбэки — можно развивать их независимо, не трогая друг друга.
///
/// Дополнительно — биометрическая блокировка (задача #30, REQ-18): владеет единственным
/// [AppLockController] на приложение, синхронизирует его `enabled` с
/// [biometricLockEnabledProvider] (тумблер на `SettingsScreen`) и зовёт [AppLockController.relock]
/// на `AppLifecycleState.paused`. Экран терминала слушает `paused`/`resumed` отдельно, через свой
/// `WidgetsBindingObserver` (`TerminalPage`, задача #28) — это про detach/reattach SSH-канала, не
/// про UI-блокировку, два независимых наблюдателя за одним и тем же жизненным циклом ОС.
class _RootShell extends ConsumerStatefulWidget {
  const _RootShell();

  @override
  ConsumerState<_RootShell> createState() => _RootShellState();
}

class _RootShellState extends ConsumerState<_RootShell>
    with WidgetsBindingObserver {
  ConnectionProfile? _openProfile;
  AppLockController? _lock;
  StreamSubscription<AppLockState>? _lockSub;

  /// `true` после того, как настройка была прочитана хотя бы раз — на самом первом разрешении
  /// [biometricLockEnabledProvider], если блокировка включена, приложение обязано запросить auth
  /// СРАЗУ (холодный старт — не только реакция на background/foreground). Дальше, пока приложение
  /// уже открыто, включение тумблера на `SettingsScreen` не выдёргивает пользователя в
  /// [LockScreen] немедленно — эффект применяется со следующего `relock()`.
  bool _initialLockChecked = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final controller = AppLockController(gate: ref.read(biometricGateProvider));
    _lockSub = controller.onStateChanged.listen((_) => setState(() {}));
    _lock = controller;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _lockSub?.cancel();
    _lock?.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) _lock?.relock();
  }

  void _onBiometricLockEnabledResolved(bool enabled) {
    final lock = _lock;
    if (lock == null) return;
    lock.setEnabled(enabled);
    if (_initialLockChecked) return;
    _initialLockChecked = true;
    if (enabled) {
      WidgetsBinding.instance.addPostFrameCallback((_) => lock.relock());
    }
  }

  @override
  Widget build(BuildContext context) {
    final lock = _lock!;
    // Держим включённость настройки синхронной с провайдером (переключение на SettingsScreen
    // действует немедленно, без перезапуска приложения) — сам контроллер не читает провайдер.
    ref.listen<AsyncValue<bool>>(
      biometricLockEnabledProvider,
      (previous, next) => next.whenData(_onBiometricLockEnabledResolved),
    );
    ref.watch(biometricLockEnabledProvider).whenData(_onBiometricLockEnabledResolved);

    if (lock.state != AppLockState.unlocked) {
      return LockScreen(controller: lock);
    }

    final profile = _openProfile;
    if (profile == null) {
      return ConnectionsScreen(onOpen: (p) => setState(() => _openProfile = p));
    }
    return TerminalPage(
      profile: profile,
      onBack: () => setState(() => _openProfile = null),
    );
  }
}
