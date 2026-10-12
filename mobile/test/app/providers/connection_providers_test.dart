import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/providers/connection_providers.dart';
import 'package:mobile/data/connection_store.dart';

/// In-memory реализация [SecureKeyValueStore] для тестов — не трогает Keychain/Keystore.
class _InMemorySecureStore implements SecureKeyValueStore {
  final Map<String, String> _values = {};

  @override
  Future<String?> read(String key) async => _values[key];

  @override
  Future<void> write(String key, String value) async => _values[key] = value;

  @override
  Future<void> delete(String key) async => _values.remove(key);
}

ConnectionProfile _profile({String id = 'a', String label = 'Server A'}) =>
    ConnectionProfile(
      id: id,
      label: label,
      host: 'a.example.com',
      username: 'root',
    );

void main() {
  late Directory tempDir;
  late FileConnectionStore store;
  late ProviderContainer container;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp(
      'etty_connection_providers_test_',
    );
    store = FileConnectionStore(
      File('${tempDir.path}/connections.json'),
      _InMemorySecureStore(),
    );
    container = ProviderContainer.test(
      overrides: [connectionStoreProvider.overrideWith((ref) async => store)],
    );
  });

  tearDown(() async {
    container.dispose();
    await tempDir.delete(recursive: true);
  });

  group('connectionsProvider', () {
    test('изначально возвращает то, что уже есть в сторе', () async {
      await store.upsert(_profile());
      // Свежий контейнер — build() ещё не читал стор до этого upsert.
      final freshContainer = ProviderContainer.test(
        overrides: [connectionStoreProvider.overrideWith((ref) async => store)],
      );
      addTearDown(freshContainer.dispose);

      final profiles = await freshContainer.read(connectionsProvider.future);
      expect(profiles.map((p) => p.id), ['a']);
    });

    test(
      'upsert() добавляет профиль и обновляет состояние провайдера',
      () async {
        await container.read(
          connectionsProvider.future,
        ); // дождаться начального build()

        await container.read(connectionsProvider.notifier).upsert(_profile());

        final profiles = container.read(connectionsProvider).value;
        expect(profiles?.map((p) => p.id), ['a']);
      },
    );

    test(
      'remove() убирает профиль из состояния и инвалидирует его секреты',
      () async {
        await container.read(connectionsProvider.future);
        final notifier = container.read(connectionsProvider.notifier);
        await notifier.upsert(_profile());
        await notifier.saveSecrets(
          'a',
          const ConnectionSecrets(password: 'pw'),
        );
        await container.read(
          connectionSecretsProvider('a').future,
        ); // прогреть кэш

        await notifier.remove('a');

        expect(container.read(connectionsProvider).value, isEmpty);
        final secretsAfter = await container.read(
          connectionSecretsProvider('a').future,
        );
        expect(
          secretsAfter.isEmpty,
          isTrue,
          reason: 'секреты удалённого профиля должны исчезнуть',
        );
      },
    );

    test('reorder() переставляет профили в состоянии', () async {
      await container.read(connectionsProvider.future);
      final notifier = container.read(connectionsProvider.notifier);
      await notifier.upsert(_profile(id: 'a'));
      await notifier.upsert(_profile(id: 'b'));

      await notifier.reorder(['b', 'a']);

      expect(container.read(connectionsProvider).value?.map((p) => p.id), [
        'b',
        'a',
      ]);
    });
  });

  group('connectionSecretsProvider', () {
    test(
      'без сохранённых секретов возвращает ConnectionSecrets.empty',
      () async {
        final secrets = await container.read(
          connectionSecretsProvider('unknown').future,
        );
        expect(secrets.isEmpty, isTrue);
      },
    );

    test(
      'saveSecrets() инвалидирует кэш — следующее чтение видит новые значения',
      () async {
        await container.read(connectionsProvider.future);
        final notifier = container.read(connectionsProvider.notifier);

        final before = await container.read(
          connectionSecretsProvider('a').future,
        );
        expect(before.isEmpty, isTrue);

        await notifier.saveSecrets(
          'a',
          const ConnectionSecrets(password: 'pw'),
        );

        final after = await container.read(
          connectionSecretsProvider('a').future,
        );
        expect(after.password, 'pw');
      },
    );
  });
}
