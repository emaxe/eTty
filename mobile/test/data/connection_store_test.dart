import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
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

ConnectionProfile _profile({
  String id = 'a',
  String label = 'Server A',
  String host = 'a.example.com',
  String username = 'root',
}) => ConnectionProfile(id: id, label: label, host: host, username: username);

void main() {
  group('FileConnectionStore — профили', () {
    late Directory tempDir;
    late File file;
    late _InMemorySecureStore secrets;
    late FileConnectionStore store;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp(
        'etty_connection_store_test_',
      );
      file = File('${tempDir.path}/connections.json');
      secrets = _InMemorySecureStore();
      store = FileConnectionStore(file, secrets);
    });

    tearDown(() async {
      await tempDir.delete(recursive: true);
    });

    test('all() на несуществующем файле — пустой список, не бросает', () async {
      expect(await store.all(), isEmpty);
    });

    test('upsert() затем find() возвращает тот же профиль', () async {
      await store.upsert(_profile());
      final found = await store.find('a');
      expect(found, isNotNull);
      expect(found!.host, 'a.example.com');
      expect(found.username, 'root');
      expect(
        found.persistence,
        'tmux',
        reason: 'REQ-10: tmux — дефолт на мобилке',
      );
      expect(found.authType, SshAuthType.password);
    });

    test('upsert() с тем же id заменяет профиль, а не дублирует', () async {
      await store.upsert(_profile(label: 'old'));
      await store.upsert(_profile(label: 'new'));

      final all = await store.all();
      expect(all, hasLength(1));
      expect(all.single.label, 'new');
    });

    test('remove() удаляет только совпавший профиль и его секреты', () async {
      await store.upsert(_profile(id: 'a'));
      await store.upsert(_profile(id: 'b'));
      await store.saveSecrets('a', const ConnectionSecrets(password: 'p'));

      await store.remove('a');

      expect(await store.find('a'), isNull);
      expect(await store.find('b'), isNotNull);
      expect((await store.loadSecrets('a')).isEmpty, isTrue);
    });

    test('reorder() переставляет по переданному порядку, забытые id остаются в конце', () async {
      await store.upsert(_profile(id: 'a'));
      await store.upsert(_profile(id: 'b'));
      await store.upsert(_profile(id: 'c'));

      await store.reorder(['c', 'a']);

      final ids = (await store.all()).map((p) => p.id).toList();
      expect(ids, ['c', 'a', 'b']);
    });

    test('данные переживают пересоздание store на том же файле', () async {
      await store.upsert(_profile());
      final reopened = FileConnectionStore(file, secrets);
      expect(await reopened.find('a'), isNotNull);
    });

    test('секрет не попадает в JSON-файл профилей', () async {
      await store.upsert(_profile());
      await store.saveSecrets(
        'a',
        const ConnectionSecrets(password: 'super-secret'),
      );

      final rawFile = await file.readAsString();
      expect(rawFile.contains('super-secret'), isFalse);
    });
  });

  group('FileConnectionStore — секреты', () {
    late Directory tempDir;
    late File file;
    late _InMemorySecureStore secrets;
    late FileConnectionStore store;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp(
        'etty_connection_store_secrets_test_',
      );
      file = File('${tempDir.path}/connections.json');
      secrets = _InMemorySecureStore();
      store = FileConnectionStore(file, secrets);
    });

    tearDown(() async {
      await tempDir.delete(recursive: true);
    });

    test('loadSecrets() без сохранённых секретов возвращает ConnectionSecrets.empty', () async {
      final loaded = await store.loadSecrets('unknown');
      expect(loaded.isEmpty, isTrue);
    });

    test(
      'saveSecrets() затем loadSecrets() возвращает те же значения',
      () async {
        await store.saveSecrets(
          'a',
          const ConnectionSecrets(
            password: 'pw',
            privateKeyPem: 'PEM',
            passphrase: 'pass',
          ),
        );
        final loaded = await store.loadSecrets('a');
        expect(loaded.password, 'pw');
        expect(loaded.privateKeyPem, 'PEM');
        expect(loaded.passphrase, 'pass');
      },
    );

    test(
      'saveSecrets(empty) удаляет запись целиком (не хранит пустой JSON)',
      () async {
        await store.saveSecrets('a', const ConnectionSecrets(password: 'pw'));
        await store.saveSecrets('a', ConnectionSecrets.empty);

        expect((await store.loadSecrets('a')).isEmpty, isTrue);
      },
    );

    test('секреты разных профилей не пересекаются', () async {
      await store.saveSecrets('a', const ConnectionSecrets(password: 'a-pw'));
      await store.saveSecrets('b', const ConnectionSecrets(password: 'b-pw'));

      expect((await store.loadSecrets('a')).password, 'a-pw');
      expect((await store.loadSecrets('b')).password, 'b-pw');
    });
  });

  group('ConnectionProfile JSON round-trip', () {
    test('toJson/fromJson сохраняет все поля', () {
      const profile = ConnectionProfile(
        id: 'x',
        label: 'My server',
        host: 'host.example.com',
        port: 2222,
        username: 'me',
        authType: SshAuthType.privateKey,
        persistence: 'off',
        tmuxSocket: '',
        hooksEnabled: false,
      );

      final restored = ConnectionProfile.fromJson(profile.toJson());

      expect(restored.id, profile.id);
      expect(restored.label, profile.label);
      expect(restored.host, profile.host);
      expect(restored.port, profile.port);
      expect(restored.username, profile.username);
      expect(restored.authType, profile.authType);
      expect(restored.persistence, profile.persistence);
      expect(restored.tmuxSocket, profile.tmuxSocket);
      expect(restored.hooksEnabled, profile.hooksEnabled);
    });

    test('fromJson без persistence/authType даёт дефолты (tmux/password)', () {
      final restored = ConnectionProfile.fromJson({
        'id': 'x',
        'label': 'l',
        'host': 'h',
        'username': 'u',
      });
      expect(restored.persistence, 'tmux');
      expect(restored.authType, SshAuthType.password);
      expect(restored.port, 22);
      expect(restored.hooksEnabled, isTrue);
    });

    test('copyWith() меняет только переданные поля', () {
      const profile = ConnectionProfile(
        id: 'x',
        label: 'l',
        host: 'h',
        username: 'u',
      );
      final updated = profile.copyWith(label: 'new label', port: 2222);

      expect(updated.id, profile.id);
      expect(updated.label, 'new label');
      expect(updated.port, 2222);
      expect(updated.host, profile.host);
    });
  });

  group('ConnectionSecrets JSON round-trip', () {
    test('toJson опускает отсутствующие поля, fromJson восстанавливает только заданные', () {
      const secrets = ConnectionSecrets(password: 'pw');
      final json = secrets.toJson();
      expect(json.containsKey('privateKeyPem'), isFalse);
      expect(json.containsKey('passphrase'), isFalse);

      final restored = ConnectionSecrets.fromJson(jsonDecode(jsonEncode(json)));
      expect(restored.password, 'pw');
      expect(restored.privateKeyPem, isNull);
      expect(restored.isEmpty, isFalse);
    });

    test('ConnectionSecrets.empty.isEmpty — true', () {
      expect(ConnectionSecrets.empty.isEmpty, isTrue);
    });
  });
}
