import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/config/path_utils.dart';
import 'package:mobile/remote/remote_parse.dart';

import '_fixtures.dart';

Uint8List _bytes(String base64) => base64Decode(base64);

String _join(String dir, String name) => PathUtils.posix.join(dir, [name]);

/// Сверяет каждый парсер из `lib/remote/remote_parse.dart` с соответствующим
/// `mobile/test/fixtures/remote/parse/*.json`, посчитанным реальным JS-кодом десктопа
/// (`src/main/ssh/remote-parse.js`) — REQ-3, `docs/plans/mob/plan.md`.
void main() {
  group('parseProbe', () {
    final cases = (loadFixtureJson('parse/parse-probe.json') as List<dynamic>)
        .cast<Map<String, dynamic>>();
    for (final c in cases) {
      test(c['name'] as String, () {
        final stdout = utf8.decode(_bytes(c['inputBase64'] as String));
        final result = parseProbe(stdout);
        final expected = c['expected'] as Map<String, dynamic>;
        expect(result.uname, expected['uname']);
        expect(result.home, expected['home']);
        expect(result.user, expected['user']);
        expect(result.shell, expected['shell']);
        expect(result.statFlavor, expected['statFlavor']);
        expect(result.find0, expected['find0']);
        expect(result.inotify, expected['inotify']);
        expect(result.rg, expected['rg']);
        expect(result.tmuxVersion, expected['tmuxVersion']);
        expect(result.tmuxPassthrough, expected['tmuxPassthrough']);
        expect(result.pkgManager, expected['pkgManager']);
      });
    }
  });

  group('parseTmuxSessionState', () {
    final cases = (loadFixtureJson('parse/parse-tmux-session-state.json') as List<dynamic>)
        .cast<Map<String, dynamic>>();
    for (final c in cases) {
      test(c['name'] as String, () {
        final stdout = utf8.decode(_bytes(c['inputBase64'] as String));
        final result = parseTmuxSessionState(stdout);
        final expected = c['expected'];
        if (expected == null) {
          expect(result, isNull);
        } else {
          final e = expected as Map<String, dynamic>;
          expect(result, isNotNull);
          expect(result!.currentPath, e['currentPath']);
          expect(result.pathFromOsc, e['pathFromOsc']);
          expect(result.currentCommand, e['currentCommand']);
        }
      });
    }
  });

  group('parseTmuxSessions', () {
    final cases = (loadFixtureJson('parse/parse-tmux-sessions.json') as List<dynamic>)
        .cast<Map<String, dynamic>>();
    for (final c in cases) {
      test(c['name'] as String, () {
        final buffer = _bytes(c['inputBase64'] as String);
        final result = parseTmuxSessions(buffer);
        final expected = (c['expected'] as List<dynamic>).cast<Map<String, dynamic>>();
        expect(result.length, expected.length, reason: 'количество сессий');
        for (var i = 0; i < expected.length; i++) {
          final e = expected[i];
          expect(result[i].name, e['name'], reason: 'session[$i].name');
          expect(result[i].windows, e['windows'], reason: 'session[$i].windows');
          expect(result[i].attached, e['attached'], reason: 'session[$i].attached');
          expect(result[i].createdAt, e['createdAt'], reason: 'session[$i].createdAt');
          expect(result[i].activityAt, e['activityAt'], reason: 'session[$i].activityAt');
          expect(
            result[i].currentCommand,
            e['currentCommand'],
            reason: 'session[$i].currentCommand',
          );
        }
      });
    }
  });

  group('parseReadDir', () {
    final cases = (loadFixtureJson('parse/parse-read-dir.json') as List<dynamic>)
        .cast<Map<String, dynamic>>();
    for (final c in cases) {
      test(c['name'] as String, () {
        final buffer = _bytes(c['inputBase64'] as String);
        final dirPath = c['dirPath'] as String;
        final result = parseReadDir(buffer, dirPath, _join);
        final expected = (c['expected'] as List<dynamic>).cast<Map<String, dynamic>>();
        expect(result.length, expected.length, reason: 'количество записей');
        for (var i = 0; i < expected.length; i++) {
          expect(result[i].name, expected[i]['name'], reason: 'entry[$i].name');
          expect(result[i].path, expected[i]['path'], reason: 'entry[$i].path');
          expect(
            result[i].isDirectory,
            expected[i]['isDirectory'],
            reason: 'entry[$i].isDirectory',
          );
        }
      });
    }
  });

  group('parseMoveOrCopyMany', () {
    final cases = (loadFixtureJson('parse/parse-move-or-copy-many.json') as List<dynamic>)
        .cast<Map<String, dynamic>>();
    for (final c in cases) {
      test(c['name'] as String, () {
        final buffer = _bytes(c['inputBase64'] as String);
        final srcPaths = (c['srcPaths'] as List<dynamic>).cast<String>();
        final result = parseMoveOrCopyMany(buffer, srcPaths);
        final expected = (c['expected'] as List<dynamic>).cast<Map<String, dynamic>>();
        expect(result.length, expected.length, reason: 'количество результатов');
        for (var i = 0; i < expected.length; i++) {
          expect(result[i].path, expected[i]['path'], reason: 'result[$i].path');
          expect(result[i].success, expected[i]['success'], reason: 'result[$i].success');
          expect(result[i].newPath, expected[i]['newPath'], reason: 'result[$i].newPath');
          expect(result[i].error, expected[i]['error'], reason: 'result[$i].error');
        }
      });
    }
  });

  group('parseSinglePathResult', () {
    final cases = (loadFixtureJson('parse/parse-single-path-result.json') as List<dynamic>)
        .cast<Map<String, dynamic>>();
    for (final c in cases) {
      test(c['name'] as String, () {
        final buffer = _bytes(c['inputBase64'] as String);
        expect(parseSinglePathResult(buffer), c['expected']);
      });
    }
  });

  group('parseStatFile', () {
    final cases = (loadFixtureJson('parse/parse-stat-file.json') as List<dynamic>)
        .cast<Map<String, dynamic>>();
    for (final c in cases) {
      test(c['name'] as String, () {
        final stdout = utf8.decode(_bytes(c['inputBase64'] as String));
        final result = parseStatFile(stdout);
        final expected = c['expected'];
        if (expected == null) {
          expect(result, isNull);
        } else {
          final e = expected as Map<String, dynamic>;
          expect(result, isNotNull);
          expect(result!.mtimeMs, e['mtimeMs']);
          expect(result.size, e['size']);
        }
      });
    }
  });

  group('parsePollMtimes', () {
    final cases = (loadFixtureJson('parse/parse-poll-mtimes.json') as List<dynamic>)
        .cast<Map<String, dynamic>>();
    for (final c in cases) {
      test(c['name'] as String, () {
        final stdout = utf8.decode(_bytes(c['inputBase64'] as String));
        final dirPaths = (c['dirPaths'] as List<dynamic>).cast<String>();
        final result = parsePollMtimes(stdout, dirPaths);
        final expectedEntries = (c['expected'] as List<dynamic>)
            .map((e) => (e as List<dynamic>))
            .toList();
        expect(result.length, expectedEntries.length, reason: 'количество ключей');
        for (final entry in expectedEntries) {
          final key = entry[0] as String;
          final value = entry[1];
          expect(result.containsKey(key), isTrue, reason: 'ключ $key отсутствует');
          expect(result[key], value, reason: 'значение для $key');
        }
      });
    }
  });
}
