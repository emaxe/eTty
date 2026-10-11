import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/data/known_hosts_store.dart';

void main() {
  group('FileKnownHostsStore', () {
    late Directory tempDir;
    late File file;
    late FileKnownHostsStore store;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp('etty_known_hosts_test_');
      file = File('${tempDir.path}/host_keys.json');
      store = FileKnownHostsStore(file);
    });

    tearDown(() async {
      await tempDir.delete(recursive: true);
    });

    test('find() на несуществующем файле возвращает null, а не бросает', () async {
      expect(await store.find('example.com', 22, 'ssh-ed25519'), isNull);
    });

    test('upsert() затем find() возвращает ту же запись', () async {
      final now = DateTime.now();
      final entry = KnownHostEntry(
        host: 'example.com',
        port: 22,
        keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:abc123',
        addedAt: now,
        lastSeenAt: now,
      );
      await store.upsert(entry);

      final found = await store.find('example.com', 22, 'ssh-ed25519');
      expect(found, isNotNull);
      expect(found!.fingerprint, 'SHA256:abc123');
      expect(found.source, 'tofu');
    });

    test('upsert() с тем же (host, port, keyType) заменяет запись, а не дублирует', () async {
      final t1 = DateTime(2026, 1, 1);
      final t2 = DateTime(2026, 1, 2);
      await store.upsert(KnownHostEntry(
        host: 'h', port: 22, keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:old', addedAt: t1, lastSeenAt: t1,
      ));
      await store.upsert(KnownHostEntry(
        host: 'h', port: 22, keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:new', addedAt: t1, lastSeenAt: t2,
      ));

      final all = await store.all();
      expect(all, hasLength(1));
      expect(all.first.fingerprint, 'SHA256:new');
    });

    test('разные keyType для одного хоста сосуществуют как отдельные записи', () async {
      final now = DateTime.now();
      await store.upsert(KnownHostEntry(
        host: 'h', port: 22, keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:ed', addedAt: now, lastSeenAt: now,
      ));
      await store.upsert(KnownHostEntry(
        host: 'h', port: 22, keyType: 'rsa-sha2-256',
        fingerprint: 'SHA256:rsa', addedAt: now, lastSeenAt: now,
      ));

      expect(await store.all(), hasLength(2));
      expect((await store.find('h', 22, 'ssh-ed25519'))!.fingerprint, 'SHA256:ed');
      expect((await store.find('h', 22, 'rsa-sha2-256'))!.fingerprint, 'SHA256:rsa');
    });

    test('remove() удаляет только совпавшую запись', () async {
      final now = DateTime.now();
      await store.upsert(KnownHostEntry(
        host: 'a', port: 22, keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:a', addedAt: now, lastSeenAt: now,
      ));
      await store.upsert(KnownHostEntry(
        host: 'b', port: 22, keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:b', addedAt: now, lastSeenAt: now,
      ));

      await store.remove('a', 22, 'ssh-ed25519');

      expect(await store.find('a', 22, 'ssh-ed25519'), isNull);
      expect(await store.find('b', 22, 'ssh-ed25519'), isNotNull);
    });

    test('данные переживают пересоздание store на том же файле (реальная персистентность)',
        () async {
      final now = DateTime.now();
      await store.upsert(KnownHostEntry(
        host: 'h', port: 22, keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:persisted', addedAt: now, lastSeenAt: now,
      ));

      final reopened = FileKnownHostsStore(file);
      final found = await reopened.find('h', 22, 'ssh-ed25519');
      expect(found, isNotNull);
      expect(found!.fingerprint, 'SHA256:persisted');
    });

    test('порт различает записи с одинаковым host/keyType', () async {
      final now = DateTime.now();
      await store.upsert(KnownHostEntry(
        host: 'h', port: 22, keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:port22', addedAt: now, lastSeenAt: now,
      ));
      await store.upsert(KnownHostEntry(
        host: 'h', port: 2222, keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:port2222', addedAt: now, lastSeenAt: now,
      ));

      expect(await store.all(), hasLength(2));
      expect((await store.find('h', 22, 'ssh-ed25519'))!.fingerprint, 'SHA256:port22');
      expect((await store.find('h', 2222, 'ssh-ed25519'))!.fingerprint, 'SHA256:port2222');
    });
  });

  group('KnownHostEntry JSON round-trip', () {
    test('toJson/fromJson сохраняет все поля', () {
      final entry = KnownHostEntry(
        host: 'example.com',
        port: 2222,
        keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:abc',
        addedAt: DateTime.utc(2026, 1, 1, 12, 0),
        lastSeenAt: DateTime.utc(2026, 1, 2, 13, 30),
        source: 'import',
      );

      final restored = KnownHostEntry.fromJson(entry.toJson());

      expect(restored.host, entry.host);
      expect(restored.port, entry.port);
      expect(restored.keyType, entry.keyType);
      expect(restored.fingerprint, entry.fingerprint);
      expect(restored.addedAt, entry.addedAt);
      expect(restored.lastSeenAt, entry.lastSeenAt);
      expect(restored.source, entry.source);
    });

    test('fromJson без source по умолчанию даёт tofu', () {
      final restored = KnownHostEntry.fromJson({
        'host': 'h',
        'port': 22,
        'keyType': 'ssh-ed25519',
        'fingerprint': 'SHA256:x',
        'addedAt': DateTime.utc(2026, 1, 1).toIso8601String(),
        'lastSeenAt': DateTime.utc(2026, 1, 1).toIso8601String(),
      });
      expect(restored.source, 'tofu');
    });

    test('copyWith(lastSeenAt:) меняет только lastSeenAt', () {
      final addedAt = DateTime.utc(2026, 1, 1);
      final original = KnownHostEntry(
        host: 'h', port: 22, keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:x', addedAt: addedAt, lastSeenAt: addedAt,
      );
      final updated = original.copyWith(lastSeenAt: DateTime.utc(2026, 6, 1));

      expect(updated.addedAt, addedAt);
      expect(updated.lastSeenAt, DateTime.utc(2026, 6, 1));
      expect(updated.fingerprint, original.fingerprint);
    });
  });
}
