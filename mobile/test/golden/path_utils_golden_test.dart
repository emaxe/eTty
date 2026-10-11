import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/config/path_utils.dart';

import '_fixtures.dart';

/// Сверяет [PathUtils] (`sep='/'`) с `path-utils.json`, сгенерированным вызовом
/// `createPathUtils('/')` из `src/shared/path-utils.js` десктопа.
void main() {
  final fixture = loadFixtureJson('path-utils.json') as Map<String, dynamic>;
  final p = PathUtils.posix;

  group('join', () {
    final cases = (fixture['join'] as List<dynamic>).cast<Map<String, dynamic>>();
    for (final c in cases) {
      final dir = c['dir'] as String;
      final parts = (c['parts'] as List<dynamic>).cast<String>();
      test('join("$dir", $parts) == "${c['expected']}"', () {
        expect(p.join(dir, parts), c['expected']);
      });
    }
  });

  group('dirname/basename/extname/normalize', () {
    final cases = (fixture['singleArg'] as List<dynamic>).cast<Map<String, dynamic>>();
    for (final c in cases) {
      final input = c['input'] as String;
      test('на входе "$input"', () {
        expect(p.dirname(input), c['dirname'], reason: 'dirname');
        expect(p.basename(input), c['basename'], reason: 'basename');
        expect(p.extname(input), c['extname'], reason: 'extname');
        expect(p.normalize(input), c['normalize'], reason: 'normalize');
      });
    }
  });

  group('isInside', () {
    final cases = (fixture['isInside'] as List<dynamic>).cast<Map<String, dynamic>>();
    for (final c in cases) {
      final root = c['root'] as String;
      final child = c['child'] as String;
      test('isInside("$root", "$child") == ${c['expected']}', () {
        expect(p.isInside(root, child), c['expected']);
      });
    }
  });
}
