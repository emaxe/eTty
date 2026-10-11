import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/data/connection_export.dart';
import 'package:mobile/data/connection_store.dart';

/// `test/fixtures/ettyx/sample.ettyx.json` — сгенерирован РЕАЛЬНЫМ десктопным кодом
/// (`src/main/ssh/ettyx-format.js`, `encryptEttyx`/`buildEttyxPlaintext`), не написан вручную —
/// это тест на межъязыковую совместимость крипто-формата (REQ-22/23), не просто раунд-трип внутри
/// Dart. Пароль: `correct horse battery staple`. Пересоздать при изменении формата:
///
/// ```
/// node --input-type=module -e "
/// import { buildEttyxPlaintext, encryptEttyx } from './src/main/ssh/ettyx-format.js'
/// const connections = [...]
/// console.log(encryptEttyx(buildEttyxPlaintext(connections, { exportedAt: '...' }), 'correct horse battery staple'))
/// "
/// ```
const String _passphrase = 'correct horse battery staple';

Future<String> _readFixture() =>
    File('test/fixtures/ettyx/sample.ettyx.json').readAsString();

void main() {
  group('decryptEttyxFile — интероп с десктопным ettyx-format.js', () {
    test('расшифровывает реальный файл с десктопа верным паролем', () async {
      final fileContents = await _readFixture();

      final result = await decryptEttyxFile(fileContents, _passphrase);

      expect(result.connections, hasLength(3));
    });

    test('password-профиль восстанавливается полностью', () async {
      final fileContents = await _readFixture();
      final result = await decryptEttyxFile(fileContents, _passphrase);

      final imported = result.connections.firstWhere(
        (c) => c.profile.id == 'fixture-conn-1',
      );

      expect(imported.profile.label, 'Fixture Server');
      expect(imported.profile.host, 'fixture.example.com');
      expect(imported.profile.port, 22);
      expect(imported.profile.username, 'etty');
      expect(imported.profile.authType, SshAuthType.password);
      expect(imported.profile.persistence, 'tmux');
      expect(imported.profile.tmuxSocket, 'etty');
      expect(imported.profile.hooksEnabled, isTrue);
      expect(imported.secrets.password, 'sekret-pass');
      expect(imported.secrets.privateKeyPem, isNull);
    });

    test('privateKey-профиль с включённым ключом восстанавливается без предупреждения', () async {
      final fileContents = await _readFixture();
      final result = await decryptEttyxFile(fileContents, _passphrase);

      final imported = result.connections.firstWhere(
        (c) => c.profile.id == 'fixture-conn-2',
      );

      expect(imported.profile.authType, SshAuthType.privateKey);
      expect(imported.profile.persistence, 'off');
      expect(imported.profile.hooksEnabled, isFalse);
      expect(imported.secrets.passphrase, 'keyphrase');
      expect(
        imported.secrets.privateKeyPem,
        '-----BEGIN OPENSSH PRIVATE KEY-----\nZml4dHVyZQ==\n-----END OPENSSH PRIVATE KEY-----\n',
      );
      expect(
        result.warnings.any((w) => w.contains('Key Server')),
        isFalse,
      );
    });

    test('agent-профиль импортируется как password с предупреждением (REQ-7)', () async {
      final fileContents = await _readFixture();
      final result = await decryptEttyxFile(fileContents, _passphrase);

      final imported = result.connections.firstWhere(
        (c) => c.profile.id == 'fixture-conn-3',
      );

      expect(imported.profile.authType, SshAuthType.password);
      expect(imported.secrets.password, isNull);
      expect(
        result.warnings,
        contains(contains('Agent Server')),
      );
      expect(
        result.warnings.singleWhere((w) => w.contains('Agent Server')),
        contains('SSH-agent'),
      );
    });

    test('ровно одно предупреждение на весь фикстурный файл (только agent-профиль)', () async {
      final fileContents = await _readFixture();
      final result = await decryptEttyxFile(fileContents, _passphrase);

      expect(result.warnings, hasLength(1));
    });

    test('неверный пароль -> EttyxDecryptException', () async {
      final fileContents = await _readFixture();

      await expectLater(
        decryptEttyxFile(fileContents, 'wrong password'),
        throwsA(isA<EttyxDecryptException>()),
      );
    });

    test('битый JSON -> EttyxDecryptException', () async {
      await expectLater(
        decryptEttyxFile('не json вообще', _passphrase),
        throwsA(isA<EttyxDecryptException>()),
      );
    });

    test('неизвестный format -> EttyxDecryptException', () async {
      await expectLater(
        decryptEttyxFile(jsonEncode({'format': 'something-else'}), _passphrase),
        throwsA(isA<EttyxDecryptException>()),
      );
    });

    test('неизвестная version -> EttyxDecryptException', () async {
      await expectLater(
        decryptEttyxFile(
          jsonEncode({'format': 'ettyx', 'version': 999}),
          _passphrase,
        ),
        throwsA(isA<EttyxDecryptException>()),
      );
    });
  });
}
