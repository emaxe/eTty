import 'dart:convert';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

import 'package:mobile/data/connection_store.dart';

/// Формат `*.ettyx` (REQ-22/23) — единственный источник истины: `src/main/ssh/ettyx-format.js`
/// на десктопе. Конверт: `{format:'ettyx', version:1, kdf:'pbkdf2-sha256', iterations, salt, iv,
/// ciphertext, authTag}` (бинарные поля — base64). Ключ — PBKDF2-HMAC-SHA256(passphrase, salt,
/// iterations, 32 байта) → AES-256-GCM(iv, authTag) над UTF-8 JSON `{exportedAt, connections}`.
/// Изменение параметров тут без синхронной правки десктопа ломает импорт — как золотые тесты
/// протокола (REQ-4), только без отдельного CI-гейта (нет golden-фикстур для крипто-формата,
/// сверено вручную реальным файлом с десктопа — см. `test/data/connection_export_test.dart`).
const String _ettyxFormat = 'ettyx';
const int _ettyxVersion = 1;
const int _aesKeyBits = 256;

class EttyxDecryptException implements Exception {
  const EttyxDecryptException(this.message);
  final String message;

  @override
  String toString() => 'EttyxDecryptException: $message';
}

/// Один импортированный профиль + его секреты — раздельно, т.к. [ConnectionStore.upsert] и
/// [ConnectionStore.saveSecrets] это разные вызовы (REQ-18: секреты никогда не проходят через тот
/// же путь, что публичные поля профиля).
class EttyxImportedConnection {
  const EttyxImportedConnection({required this.profile, required this.secrets});

  final ConnectionProfile profile;
  final ConnectionSecrets secrets;
}

class EttyxImportResult {
  const EttyxImportResult({required this.connections, required this.warnings});

  final List<EttyxImportedConnection> connections;

  /// По одному сообщению на проблемный профиль — `authType: 'agent'` (не поддерживается на
  /// мобилке, REQ-7) или `authType: 'privateKey'` без самого ключа в экспорте (десктоп не включил
  /// его — чекбокс «включить приватные ключи» был снят). Экран импорта показывает их пользователю
  /// ПОСЛЕ импорта — профили всё равно создаются, просто require ручной докрутки перед подключением.
  final List<String> warnings;
}

/// Расшифровывает и парсит `.ettyx`-файл, экспортированный десктопом (`ettyx-format.js`).
/// Не трогает [ConnectionStore] сама — вызывающая сторона (UI импорта, задача #32) решает,
/// upsert'ить ли каждый профиль (например, показав список на подтверждение).
Future<EttyxImportResult> decryptEttyxFile(
  String fileContents,
  String passphrase,
) async {
  final Map<String, dynamic> envelope;
  try {
    envelope = jsonDecode(fileContents) as Map<String, dynamic>;
  } catch (_) {
    throw const EttyxDecryptException('Файл повреждён или это не .ettyx');
  }

  if (envelope['format'] != _ettyxFormat) {
    throw const EttyxDecryptException('Это не файл экспорта eTty (.ettyx)');
  }
  final version = envelope['version'];
  if (version != _ettyxVersion) {
    throw EttyxDecryptException('Неподдерживаемая версия формата .ettyx: $version');
  }

  final Uint8List plaintextBytes;
  try {
    final iterations = envelope['iterations'] as int;
    final salt = base64Decode(envelope['salt'] as String);
    final iv = base64Decode(envelope['iv'] as String);
    final ciphertext = base64Decode(envelope['ciphertext'] as String);
    final authTag = base64Decode(envelope['authTag'] as String);

    final pbkdf2 = Pbkdf2(
      macAlgorithm: Hmac.sha256(),
      iterations: iterations,
      bits: _aesKeyBits,
    );
    final secretKey = await pbkdf2.deriveKeyFromPassword(
      password: passphrase,
      nonce: salt,
    );
    final secretBox = SecretBox(ciphertext, nonce: iv, mac: Mac(authTag));
    final clearText = await AesGcm.with256bits().decrypt(
      secretBox,
      secretKey: secretKey,
    );
    plaintextBytes = Uint8List.fromList(clearText);
  } on EttyxDecryptException {
    rethrow;
  } catch (_) {
    // AES-GCM tag mismatch (неверный пароль) и битые base64-поля неразличимы криптографически —
    // то же решение, что `ettyx-format.js`: одно общее сообщение.
    throw const EttyxDecryptException('Неверный пароль или файл повреждён');
  }

  final Map<String, dynamic> payload;
  try {
    payload = jsonDecode(utf8.decode(plaintextBytes)) as Map<String, dynamic>;
  } catch (_) {
    throw const EttyxDecryptException(
      'Файл повреждён (не удалось разобрать содержимое после расшифровки)',
    );
  }

  final rawConnections = (payload['connections'] as List<dynamic>? ?? [])
      .cast<Map<String, dynamic>>();

  final connections = <EttyxImportedConnection>[];
  final warnings = <String>[];

  for (final record in rawConnections) {
    final label = record['label'] as String? ?? record['host'] as String? ?? '?';
    final portableAuthType = record['authType'] as String?;
    final secretsJson = record['secrets'] as Map<String, dynamic>? ?? const {};

    late final SshAuthType authType;
    switch (portableAuthType) {
      case 'privateKey':
        authType = SshAuthType.privateKey;
        if (secretsJson['privateKeyPem'] == null) {
          warnings.add(
            'Профиль «$label»: приватный ключ не был включён в экспорт — добавьте его вручную.',
          );
        }
      case 'agent':
        // REQ-7: на мобилке нет SSH-агента — профиль всё равно импортируется, но авторизация
        // требует ручного выбора другого способа перед первым подключением.
        authType = SshAuthType.password;
        warnings.add(
          'Профиль «$label» использовал SSH-agent — это не поддерживается на мобилке, '
          'укажите пароль или приватный ключ вручную.',
        );
      default:
        authType = SshAuthType.password;
    }

    final profileJson = Map<String, dynamic>.from(record)
      ..['authType'] = authType.name;
    final profile = ConnectionProfile.fromJson(profileJson);

    final secrets = ConnectionSecrets(
      password: secretsJson['password'] as String?,
      passphrase: secretsJson['passphrase'] as String?,
      privateKeyPem: secretsJson['privateKeyPem'] as String?,
    );

    connections.add(EttyxImportedConnection(profile: profile, secrets: secrets));
  }

  return EttyxImportResult(connections: connections, warnings: warnings);
}
