import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/remote/remote_shell_hooks.dart';

import '_fixtures.dart';

/// Сверяет [RemoteShellHooks.buildRemoteInitCommand] побайтово с фикстурами
/// `mobile/test/fixtures/remote/init-command/`, сгенерированными из `buildRemoteInitCommand()`
/// десктопа (`src/main/ssh/remote-shell-hooks.js`) — самая тонкая точка совместимости протокола
/// (REQ-2, инвариант L0). Невалидные кейсы проверяют только факт исключения — текст сообщения
/// JS не обязателен к повторению (см. `scripts/gen-remote-fixtures.mjs`).
void main() {
  final cases = (loadFixtureJson('init-command/cases.json') as List<dynamic>)
      .cast<Map<String, dynamic>>();

  for (final c in cases) {
    final id = c['id'] as String;
    final params = c['params'] as Map<String, dynamic>;
    final expectThrow = c['expectThrow'] as bool;

    test(id, () {
      String call() => RemoteShellHooks.buildRemoteInitCommand(
        persistence: params['persistence'] as String? ?? 'off',
        sessionName: params['sessionName'] as String?,
        hooks: params['hooks'] as bool? ?? true,
        socketName: params.containsKey('socketName')
            ? (params['socketName'] as String? ?? '')
            : 'etty',
      );

      if (expectThrow) {
        expect(call, throwsArgumentError);
      } else {
        final expected = loadFixtureText(c['outputFile'] as String);
        final output = call();
        expect(output, expected);
        // Инвариант L0 (assertL0Safe на стороне генератора уже проверил это при сборке
        // фикстуры) — сверяется здесь ещё раз как самостоятельная гарантия Dart-порта, не
        // зависящая от того, что записано в фикстуре.
        final inner = output.substring("exec /bin/sh -c '".length, output.length - 1);
        expect(inner.contains("'"), isFalse, reason: 'L1 не должен содержать \'');
        expect(inner.contains('!'), isFalse, reason: 'L1 не должен содержать !');
      }
    });
  }
}
