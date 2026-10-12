import 'package:mobile/data/connection_store.dart';

/// Настройки приложения, не привязанные к конкретному профилю подключения — сейчас только флаг
/// биометрической блокировки (REQ-18, задача #30). Отдельный контракт от [ConnectionStore], чтобы
/// не разрастать его CRUD-методы под единственный булев тумблер.
abstract class AppSettingsStore {
  Future<bool> getBiometricLockEnabled();
  Future<void> setBiometricLockEnabled(bool enabled);

  /// Показывать ли скрытые файлы (имя с точки) в дереве файлов; общее для всех подключений.
  Future<bool> getShowHiddenFiles();
  Future<void> setShowHiddenFiles(bool enabled);

  /// Пользовательские команды второго колеса терминала (JSON, см. `domain/quick_commands.dart`);
  /// `null` — не настраивались, берутся умолчания.
  Future<String?> getQuickCommandsJson();
  Future<void> setQuickCommandsJson(String json);
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
  static const String _showHiddenFilesKey = 'etty.settings.showHiddenFiles';
  static const String _quickCommandsKey = 'etty.settings.quickCommands';

  final SecureKeyValueStore _storage;

  @override
  Future<bool> getBiometricLockEnabled() async =>
      (await _storage.read(_biometricLockKey)) == 'true';

  @override
  Future<void> setBiometricLockEnabled(bool enabled) =>
      _storage.write(_biometricLockKey, enabled.toString());

  @override
  Future<bool> getShowHiddenFiles() async =>
      (await _storage.read(_showHiddenFilesKey)) == 'true';

  @override
  Future<void> setShowHiddenFiles(bool enabled) =>
      _storage.write(_showHiddenFilesKey, enabled.toString());

  @override
  Future<String?> getQuickCommandsJson() => _storage.read(_quickCommandsKey);

  @override
  Future<void> setQuickCommandsJson(String json) =>
      _storage.write(_quickCommandsKey, json);
}
