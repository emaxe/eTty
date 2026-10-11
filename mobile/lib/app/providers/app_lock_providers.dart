import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:mobile/data/app_settings_store.dart';
import 'package:mobile/data/biometric_gate.dart';

/// Один экземпляр на приложение — тот же приём, что `connectionStoreProvider`
/// (`app/providers/connection_providers.dart`): не `.autoDispose`, живёт весь жизненный цикл.
final appSettingsStoreProvider = Provider<AppSettingsStore>(
  (ref) => SecureAppSettingsStore(),
);

final biometricGateProvider = Provider<BiometricGate>(
  (ref) => LocalAuthBiometricGate(),
);

/// Источник истины для тумблера «Биометрическая блокировка» (`SettingsScreen`,
/// `ui/settings/settings_screen.dart`) — `AsyncNotifier`, а не `FutureProvider`: значение меняется
/// методом [BiometricLockEnabledNotifier.setEnabled], а не только перечитывается. `_RootShell`
/// (`main.dart`) слушает это через `ref.listen` и синхронизирует с живым `AppLockController`
/// (`domain/app_lock_controller.dart`), который сам не знает про Riverpod/хранилище.
class BiometricLockEnabledNotifier extends AsyncNotifier<bool> {
  @override
  Future<bool> build() =>
      ref.watch(appSettingsStoreProvider).getBiometricLockEnabled();

  Future<void> setEnabled(bool enabled) async {
    await ref.read(appSettingsStoreProvider).setBiometricLockEnabled(enabled);
    state = AsyncData(enabled);
  }
}

final biometricLockEnabledProvider =
    AsyncNotifierProvider<BiometricLockEnabledNotifier, bool>(
      BiometricLockEnabledNotifier.new,
    );
