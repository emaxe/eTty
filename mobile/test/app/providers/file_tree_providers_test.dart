import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/providers/app_lock_providers.dart';
import 'package:mobile/app/providers/file_tree_providers.dart';
import 'package:mobile/data/app_settings_store.dart';

class _FakeSettingsStore implements AppSettingsStore {
  _FakeSettingsStore({this.showHidden = false});

  bool showHidden;
  bool biometric = false;

  @override
  Future<bool> getBiometricLockEnabled() async => biometric;

  @override
  Future<void> setBiometricLockEnabled(bool enabled) async => biometric = enabled;

  @override
  Future<bool> getShowHiddenFiles() async => showHidden;

  @override
  Future<void> setShowHiddenFiles(bool enabled) async => showHidden = enabled;

  @override
  Future<String?> getQuickCommandsJson() async => null;

  @override
  Future<void> setQuickCommandsJson(String json) async {}
}

void main() {
  ProviderContainer makeContainer(_FakeSettingsStore store) {
    final container = ProviderContainer(
      overrides: [appSettingsStoreProvider.overrideWithValue(store)],
    );
    addTearDown(container.dispose);
    return container;
  }

  test('build читает сохранённое значение', () async {
    final container = makeContainer(_FakeSettingsStore(showHidden: true));

    expect(await container.read(showHiddenFilesProvider.future), isTrue);
  });

  test('по умолчанию false', () async {
    final container = makeContainer(_FakeSettingsStore());

    expect(await container.read(showHiddenFilesProvider.future), isFalse);
  });

  test('setEnabled пишет в хранилище и обновляет state', () async {
    final store = _FakeSettingsStore();
    final container = makeContainer(store);
    await container.read(showHiddenFilesProvider.future);

    await container.read(showHiddenFilesProvider.notifier).setEnabled(true);

    expect(store.showHidden, isTrue);
    expect(container.read(showHiddenFilesProvider).value, isTrue);
  });
}
