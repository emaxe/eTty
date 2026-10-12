import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/data/known_hosts_store.dart';
import 'package:mobile/transport/ssh_connection.dart';

class _InMemoryKnownHostsStore implements KnownHostsStore {
  final List<KnownHostEntry> _entries = [];

  @override
  Future<KnownHostEntry?> find(String host, int port, String keyType) async {
    for (final e in _entries) {
      if (e.host == host && e.port == port && e.keyType == keyType) return e;
    }
    return null;
  }

  @override
  Future<void> upsert(KnownHostEntry entry) async => _entries.add(entry);

  @override
  Future<void> remove(String host, int port, String keyType) async {}

  @override
  Future<List<KnownHostEntry>> all() async => List.unmodifiable(_entries);
}

SshConnection _buildConnection({
  required String host,
  required int port,
  SshCredentials credentials = const SshCredentials(password: 'irrelevant'),
}) {
  return SshConnection(
    host: host,
    port: port,
    username: 'user',
    credentials: credentials,
    knownHostsStore: _InMemoryKnownHostsStore(),
    onNewHostKey: (result) async => true,
  );
}

void main() {
  group('SshConnection — состояние до connect()', () {
    test('изначальное состояние idle', () {
      final connection = _buildConnection(host: '127.0.0.1', port: 1);
      expect(connection.state, SshConnectionState.idle);
    });

    test('client бросает StateError до успешного connect()', () {
      final connection = _buildConnection(host: '127.0.0.1', port: 1);
      expect(() => connection.client, throwsStateError);
    });

    test('done бросает StateError до успешного connect()', () {
      final connection = _buildConnection(host: '127.0.0.1', port: 1);
      expect(() => connection.done, throwsStateError);
    });

    test('close() до connect() идемпотентен и не бросает', () {
      final connection = _buildConnection(host: '127.0.0.1', port: 1);
      expect(connection.close, returnsNormally);
      expect(connection.state, SshConnectionState.closed);
      // Повторный close() — тоже безопасен.
      expect(connection.close, returnsNormally);
    });
  });

  // Loopback/несуществующие адреса — детерминированно и без внешней сети, годится для CI.
  // Против ЖИВОГО сервера SshConnection проверен вручную (задача #11, docs/plans/mob/plan.md) —
  // сетевые сценарии здесь не дублируют это ручное end-to-end подключение, а проверяют
  // классификацию ошибок и переходы состояния.
  group('SshConnection.connect() — сетевые отказы (loopback, без внешней сети)', () {
    test('connection refused → SshConnectFailureKind.unreachable, состояние failed', () async {
      final connection = _buildConnection(host: '127.0.0.1', port: 1);

      await expectLater(
        connection.connect(),
        throwsA(
          isA<SshConnectException>().having(
            (e) => e.kind,
            'kind',
            SshConnectFailureKind.unreachable,
          ),
        ),
      );
      expect(connection.state, SshConnectionState.failed);
    });

    test('DNS lookup failure → SshConnectFailureKind.unreachable', () async {
      final connection = _buildConnection(host: 'no-such-host.invalid', port: 22);

      await expectLater(
        connection.connect(),
        throwsA(
          isA<SshConnectException>().having(
            (e) => e.kind,
            'kind',
            SshConnectFailureKind.unreachable,
          ),
        ),
      );
    });

    test('повторный connect() после failed бросает StateError', () async {
      final connection = _buildConnection(host: '127.0.0.1', port: 1);
      await expectLater(connection.connect(), throwsA(isA<SshConnectException>()));

      expect(connection.connect, throwsStateError);
    });

    test('SshConnectException.toString() содержит kind и сообщение', () async {
      final connection = _buildConnection(host: '127.0.0.1', port: 1);
      try {
        await connection.connect();
        fail('ожидался SshConnectException');
      } on SshConnectException catch (e) {
        expect(e.toString(), contains('unreachable'));
      }
    });
  });

  group('SshCredentials', () {
    test('можно сконструировать только с паролем', () {
      const creds = SshCredentials(password: 'p@ss');
      expect(creds.password, 'p@ss');
      expect(creds.privateKeyPem, isNull);
      expect(creds.keyboardInteractivePrompt, isNull);
    });

    test('можно сконструировать с ключом и passphrase', () {
      const creds = SshCredentials(
        privateKeyPem: '-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----',
        privateKeyPassphrase: 'secret',
      );
      expect(creds.privateKeyPem, isNotNull);
      expect(creds.privateKeyPassphrase, 'secret');
      expect(creds.password, isNull);
    });
  });
}
