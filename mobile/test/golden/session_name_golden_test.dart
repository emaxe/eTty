import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/remote/persistence.dart';
import 'package:mobile/remote/session_name.dart';

import '_fixtures.dart';

/// Сверяет [buildSessionNameBase]/[pickFreeSessionName]/[resolveSshPersistence] с
/// `session-names.json`/`persistence.json`, сгенерированными из `src/shared/ssh-session-name.js`
/// и `src/shared/ssh-persistence.js` десктопа (REQ-1, `docs/plans/mob/plan.md`).
void main() {
  group('buildSessionNameBase', () {
    final fixture = loadFixtureJson('session-names.json') as Map<String, dynamic>;
    final cases = (fixture['buildSessionNameBase'] as List<dynamic>).cast<Map<String, dynamic>>();
    for (final c in cases) {
      final connectionId = c['connectionId'] as String;
      test('connectionId="$connectionId"', () {
        expect(buildSessionNameBase(connectionId), c['expected']);
      });
    }
  });

  group('pickFreeSessionName', () {
    final fixture = loadFixtureJson('session-names.json') as Map<String, dynamic>;
    final cases = (fixture['pickFreeSessionName'] as List<dynamic>).cast<Map<String, dynamic>>();
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i];
      final base = c['base'] as String;
      final taken = (c['taken'] as List<dynamic>).cast<String>();
      test('[$i] base="$base", taken=$taken', () {
        expect(pickFreeSessionName(base, taken), c['expected']);
      });
    }
  });

  group('resolveSshPersistence', () {
    final cases = (loadFixtureJson('persistence.json') as List<dynamic>)
        .cast<Map<String, dynamic>>();
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i];
      final sshOptions = c['sshOptions'] as Map<String, dynamic>?;
      final connection = c['connection'] as Map<String, dynamic>?;
      test('[$i] sshOptions=$sshOptions, connection=$connection', () {
        final result = resolveSshPersistence(
          sshOptions?['persistence'] as String?,
          connection?['persistence'] as String?,
        );
        expect(result, c['expected']);
      });
    }
  });
}
