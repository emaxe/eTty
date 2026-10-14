import 'package:flutter/foundation.dart';
import 'package:local_auth/local_auth.dart';

/// Узкий контракт над биометрической аутентификацией ОС (REQ-18) — швом для тестов, та же идея,
/// что [mobile.data.connection_store.SecureKeyValueStore]: продакшен-код (`AppLockController`)
/// зависит от интерфейса, тесты подставляют фейк, не трогая `local_auth`/платформенный канал.
abstract class BiometricGate {
  /// `true`, только если на устройстве есть настроенная биометрия/код-пароль, которым можно
  /// подтвердить [authenticate] — экран настроек скрывает переключатель блокировки, если `false`
  /// (нечем защищать).
  Future<bool> get isAvailable;

  /// Запрашивает у ОС подтверждение (Face ID/отпечаток/PIN-фолбэк, `biometricOnly: false`) —
  /// `false` и при отказе пользователя, и при любой ошибке (недоступно, отменено системой).
  Future<bool> authenticate();
}

/// Реализация [BiometricGate] поверх `local_auth`.
class LocalAuthBiometricGate implements BiometricGate {
  LocalAuthBiometricGate([LocalAuthentication? auth])
    : _auth = auth ?? LocalAuthentication();

  final LocalAuthentication _auth;

  @override
  Future<bool> get isAvailable async {
    try {
      final supported = await _auth.isDeviceSupported();
      final canCheck = await _auth.canCheckBiometrics;
      return supported && canCheck;
    } catch (e) {
      debugPrint('BiometricGate.isAvailable: $e');
      return false;
    }
  }

  @override
  Future<bool> authenticate() async {
    try {
      return await _auth.authenticate(
        localizedReason: 'Разблокируйте eTty',
        biometricOnly: false,
        // Диалог ОС может быть прерван сворачиванием приложения (например, системной шторкой) —
        // без этого authenticate() падает с ошибкой вместо повторной попытки на возврате.
        persistAcrossBackgrounding: true,
      );
    } catch (e) {
      debugPrint('BiometricGate.authenticate: $e');
      return false;
    }
  }
}
