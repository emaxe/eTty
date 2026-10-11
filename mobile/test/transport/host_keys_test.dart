import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/data/known_hosts_store.dart';
import 'package:mobile/transport/host_keys.dart';

/// In-memory реализация [KnownHostsStore] для тестов — не трогает диск, поведение идентично
/// [FileKnownHostsStore] (у той — отдельные тесты персистентности в
/// `test/data/known_hosts_store_test.dart`).
class _InMemoryKnownHostsStore implements KnownHostsStore {
  final List<KnownHostEntry> _entries = [];

  bool _matches(KnownHostEntry e, String host, int port, String keyType) =>
      e.host == host && e.port == port && e.keyType == keyType;

  @override
  Future<KnownHostEntry?> find(String host, int port, String keyType) async {
    for (final e in _entries) {
      if (_matches(e, host, port, keyType)) return e;
    }
    return null;
  }

  @override
  Future<void> upsert(KnownHostEntry entry) async {
    _entries.removeWhere((e) => _matches(e, entry.host, entry.port, entry.keyType));
    _entries.add(entry);
  }

  @override
  Future<void> remove(String host, int port, String keyType) async {
    _entries.removeWhere((e) => _matches(e, host, port, keyType));
  }

  @override
  Future<List<KnownHostEntry>> all() async => List.unmodifiable(_entries);
}

Uint8List _fingerprintBytes(String fingerprint) => Uint8List.fromList(utf8.encode(fingerprint));

void main() {
  group('HostKeyVerifier', () {
    late _InMemoryKnownHostsStore store;

    setUp(() {
      store = _InMemoryKnownHostsStore();
    });

    test('новый ключ: без подтверждения пользователя — false, ничего не сохраняется', () async {
      final verifier = HostKeyVerifier(
        store: store,
        host: 'example.com',
        port: 22,
        onNewHostKey: (result) async {
          expect(result.verdict, HostKeyVerdict.newHost);
          expect(result.fingerprint, 'SHA256:abc');
          return false;
        },
      );

      final trusted = await verifier.call('ssh-ed25519', _fingerprintBytes('SHA256:abc'));

      expect(trusted, isFalse);
      expect(await store.find('example.com', 22, 'ssh-ed25519'), isNull);
    });

    test('новый ключ: пользователь подтверждает — true, запись сохраняется', () async {
      final verifier = HostKeyVerifier(
        store: store,
        host: 'example.com',
        port: 22,
        onNewHostKey: (result) async => true,
      );

      final trusted = await verifier.call('ssh-ed25519', _fingerprintBytes('SHA256:abc'));

      expect(trusted, isTrue);
      final saved = await store.find('example.com', 22, 'ssh-ed25519');
      expect(saved, isNotNull);
      expect(saved!.fingerprint, 'SHA256:abc');
      expect(saved.source, 'tofu');
    });

    test('совпавший ключ: true без вызова onNewHostKey, обновляется lastSeenAt', () async {
      final addedAt = DateTime.utc(2026, 1, 1);
      await store.upsert(KnownHostEntry(
        host: 'example.com', port: 22, keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:abc', addedAt: addedAt, lastSeenAt: addedAt,
      ));

      var promptCalled = false;
      final verifier = HostKeyVerifier(
        store: store,
        host: 'example.com',
        port: 22,
        onNewHostKey: (result) async {
          promptCalled = true;
          return true;
        },
      );

      final trusted = await verifier.call('ssh-ed25519', _fingerprintBytes('SHA256:abc'));

      expect(trusted, isTrue);
      expect(promptCalled, isFalse, reason: 'для совпавшего ключа диалог не должен вызываться');
      final saved = await store.find('example.com', 22, 'ssh-ed25519');
      expect(saved!.addedAt, addedAt, reason: 'addedAt не меняется при повторном подтверждении');
      expect(saved.lastSeenAt.isAfter(addedAt), isTrue);
    });

    test('изменившийся ключ: false БЕЗ вызова onNewHostKey — жёсткая блокировка', () async {
      final now = DateTime.now();
      await store.upsert(KnownHostEntry(
        host: 'example.com', port: 22, keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:old', addedAt: now, lastSeenAt: now,
      ));

      var promptCalled = false;
      final verifier = HostKeyVerifier(
        store: store,
        host: 'example.com',
        port: 22,
        onNewHostKey: (result) async {
          promptCalled = true;
          return true; // даже если бы спросили и подтвердили — не должно быть вызвано вовсе
        },
      );

      final trusted = await verifier.call('ssh-ed25519', _fingerprintBytes('SHA256:new'));

      expect(trusted, isFalse);
      expect(promptCalled, isFalse, reason: 'mismatch не спрашивается диалогом — жёсткий отказ');
      // Сохранённая запись не тронута — старый (легитимный) отпечаток остаётся для аудита.
      final saved = await store.find('example.com', 22, 'ssh-ed25519');
      expect(saved!.fingerprint, 'SHA256:old');
    });

    test('другой host/port с тем же verifier не путается с известной записью', () async {
      final now = DateTime.now();
      await store.upsert(KnownHostEntry(
        host: 'example.com', port: 22, keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:abc', addedAt: now, lastSeenAt: now,
      ));

      // Тот же host, другой порт — для верификатора это НОВЫЙ хост.
      final verifier = HostKeyVerifier(
        store: store,
        host: 'example.com',
        port: 2222,
        onNewHostKey: (result) async {
          expect(result.verdict, HostKeyVerdict.newHost);
          return true;
        },
      );

      final trusted = await verifier.call('ssh-ed25519', _fingerprintBytes('SHA256:abc'));
      expect(trusted, isTrue);
    });

    test('разные keyType для одного host:port — независимые проверки', () async {
      final now = DateTime.now();
      await store.upsert(KnownHostEntry(
        host: 'h', port: 22, keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:ed', addedAt: now, lastSeenAt: now,
      ));

      final verifier = HostKeyVerifier(
        store: store, host: 'h', port: 22,
        onNewHostKey: (result) async => true,
      );

      // rsa-ключ для того же хоста — новый, не конфликтует с уже известным ed25519.
      final trusted = await verifier.call('rsa-sha2-256', _fingerprintBytes('SHA256:rsa'));
      expect(trusted, isTrue);
      expect(await store.find('h', 22, 'ssh-ed25519'), isNotNull);
      expect(await store.find('h', 22, 'rsa-sha2-256'), isNotNull);
    });
  });
}
