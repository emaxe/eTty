import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/data/app_settings_store.dart';
import 'package:mobile/data/connection_store.dart';

/// In-memory реализация [SecureKeyValueStore] для тестов — не трогает Keychain/Keystore (тот же
/// фейк, что в `test/data/connection_store_test.dart`).
class _InMemorySecureStore implements SecureKeyValueStore {
  final Map<String, String> values = {};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}

void main() {
  group('SecureAppSettingsStore — биометрическая блокировка', () {
    test('по умолчанию выключена (нет записи)', () async {
      final store = SecureAppSettingsStore(_InMemorySecureStore());

      expect(await store.getBiometricLockEnabled(), isFalse);
    });

    test('setBiometricLockEnabled(true) -> getBiometricLockEnabled() true', () async {
      final backing = _InMemorySecureStore();
      final store = SecureAppSettingsStore(backing);

      await store.setBiometricLockEnabled(true);

      expect(await store.getBiometricLockEnabled(), isTrue);
    });

    test('setBiometricLockEnabled(false) после true снова выключает', () async {
      final store = SecureAppSettingsStore(_InMemorySecureStore());

      await store.setBiometricLockEnabled(true);
      await store.setBiometricLockEnabled(false);

      expect(await store.getBiometricLockEnabled(), isFalse);
    });

    test('не трогает чужие ключи того же backing store', () async {
      final backing = _InMemorySecureStore()..values['etty.connection.a'] = 'x';
      final store = SecureAppSettingsStore(backing);

      await store.setBiometricLockEnabled(true);

      expect(backing.values['etty.connection.a'], 'x');
    });
  });
}
