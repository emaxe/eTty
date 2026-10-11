/// POSIX/Windows-safe утилиты путей — порт `src/shared/path-utils.js` десктопного eTty.
///
/// На мобилке нужен только POSIX-вариант (`PathUtils.posix`) — удалённая ФС по SSH всегда POSIX.
/// Windows-ветка (`sep == '\\'`) портирована ради побайтового соответствия алгоритму десктопа
/// (используется там для локального провайдера на Windows, которого на мобилке нет), а не
/// потому что она нужна здесь — так проще держать один источник истины при будущем ревью.
///
/// Сверяется golden-тестом (`mobile/test/golden/path_utils_golden_test.dart`) против
/// `mobile/test/fixtures/remote/path-utils.json`, покрывающим только `sep='/'`.
class PathUtils {
  PathUtils(this.sep) : isWin = sep == r'\' {
    _splitRe = isWin ? RegExp(r'[\\/]') : RegExp('/');
  }

  /// Разделитель для POSIX-путей (единственный, реально используемый на мобилке — удалённая ФС
  /// по SSH всегда POSIX).
  static final PathUtils posix = PathUtils('/');

  final String sep;
  final bool isWin;
  late final RegExp _splitRe;

  String _normalizeSlashes(String p) => isWin ? p.replaceAll('/', r'\') : p;

  List<String> split(String p) =>
      _normalizeSlashes(p).split(_splitRe).where((s) => s.isNotEmpty).toList();

  /// Абсолютный ли путь начинается с root-маркера (используется join/dirname/normalize).
  String _rootPrefix(String p) {
    final norm = _normalizeSlashes(p);
    if (isWin) {
      final match = RegExp(r'^[A-Za-z]:\\').firstMatch(norm);
      if (match != null) return match.group(0)!;
      if (norm.startsWith(r'\\')) return r'\\'; // UNC — упрощённо, без разбора \\server\share
      return '';
    }
    return norm.startsWith('/') ? sep : '';
  }

  String join(String dir, [List<String> parts = const []]) {
    final root = _rootPrefix(dir);
    // split() режет по разделителям, но не знает о корневом маркере (`C:\`) — без явного среза
    // он попадёт в сегменты как обычный кусок пути и задвоится с `root`.
    final dirWithoutRoot = root.isNotEmpty ? _normalizeSlashes(dir).substring(root.length) : dir;
    final segments = [...split(dirWithoutRoot), ...parts.expand(split)];
    return root + segments.join(sep);
  }

  String dirname(String p) {
    final root = _rootPrefix(p);
    final withoutRoot = root.isNotEmpty ? _normalizeSlashes(p).substring(root.length) : p;
    final segments = split(withoutRoot);
    if (segments.length <= 1) return root.isNotEmpty ? root : sep;
    return root + segments.sublist(0, segments.length - 1).join(sep);
  }

  String basename(String p) {
    final segments = split(p);
    return segments.isNotEmpty ? segments.last : '';
  }

  String extname(String name) {
    final base = basename(name);
    // Паритет с node:path.extname: ведущие точки (dotfile) не считаются расширением.
    final idx = base.lastIndexOf('.');
    if (idx <= 0) return '';
    return base.substring(idx);
  }

  String normalize(String p) {
    final root = _rootPrefix(p);
    final withoutRoot = root.isNotEmpty ? _normalizeSlashes(p).substring(root.length) : p;
    final out = <String>[];
    for (final seg in split(withoutRoot)) {
      if (seg == '.') continue;
      if (seg == '..') {
        if (out.isNotEmpty && out.last != '..') {
          out.removeLast();
        } else if (root.isEmpty) {
          out.add('..');
        }
        continue;
      }
      out.add(seg);
    }
    final result = root + out.join(sep);
    if (result.isNotEmpty) return result;
    return root.isNotEmpty ? root : '.';
  }

  /// true, если `child` лежит внутри (или равен) `root`. Регистронезависимо на Windows.
  bool isInside(String root, String child) {
    bool eq(String a, String b) => isWin ? a.toLowerCase() == b.toLowerCase() : a == b;
    final rootNorm = normalize(root);
    final childNorm = normalize(child);
    if (eq(rootNorm, childNorm)) return true;
    final prefix = rootNorm.endsWith(sep) ? rootNorm : rootNorm + sep;
    return isWin
        ? childNorm.toLowerCase().startsWith(prefix.toLowerCase())
        : childNorm.startsWith(prefix);
  }
}
