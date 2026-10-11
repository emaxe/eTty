import 'package:mobile/data/connection_store.dart';

/// Настройки приложения, не привязанные к конкретному профилю подключения — сейчас только флаг
/// биометрической блокировки (REQ-18, задача #30). Отдельный контракт от [ConnectionStore], чтобы
/// не разрастать его CRUD-методы под единственный булев тумблер.
abstract class AppSettingsStore {
  Future<bool> getBiometricLockEnabled();
  Future<void> setBiometricLockEnabled(bool enabled);
}

/// [AppSettingsStore] поверх [SecureKeyValueStore] — тот же backing store, что секреты профилей
/// (Keychain/Keystore), с отдельным префиксом ключа, чтобы не столкнуться с
/// `FileConnectionStore._secretKeyPrefix`. Значение не секретно само по себе, но хранить
/// булев тумблер отдельным пакетом (`shared_preferences`) ради одного флага — лишняя зависимость
/// (список пакетов проекта фиксирован в `docs/plans/mob/plan.md`).
class SecureAppSettingsStore implements AppSettingsStore {
  SecureAppSettingsStore([SecureKeyValueStore? storage])
    : _storage = storage ?? const FlutterSecureKeyValueStore();

  static const String _biometricLockKey = 'etty.settings.biometricLockEnabled';

  final SecureKeyValueStore _storage;

  @override
  Future<bool> getBiometricLockEnabled() async =>
      (await _storage.read(_biometricLockKey)) == 'true';

  @override
  Future<void> setBiometricLockEnabled(bool enabled) =>
      _storage.write(_biometricLockKey, enabled.toString());
}
