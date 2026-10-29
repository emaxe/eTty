import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:mobile/core/config/path_utils.dart';
import 'package:mobile/core/config/ssh_fs_config.dart';
import 'package:mobile/remote/remote_parse.dart';
import 'package:mobile/remote/remote_scripts.dart';
import 'package:mobile/transport/exec_channel.dart';

/// Дефолтный лимит [SshFsProvider.readFile] — то же значение, что хардкожено в
/// `src/main/fs/ssh-fs-provider.js` (`readFile(filePath, maxSize = 5 * 1024 * 1024)`), десктоп
/// его тоже не выносит в конфиг.
const int defaultReadFileMaxSizeBytes = 5 * 1024 * 1024;

/// Символическая причина отказа операции удалённой ФС — то же разделение кодов возврата, что
/// на десктопе (`ssh-fs-provider.js`), но типизировано вместо сравнения строк сообщения.
enum SshFsErrorCode {
  /// exit 13 из `RemoteScripts` (`_validatePrefix`) — путь вне корня сессии.
  traversalDenied,

  /// exit 3 (`readDirScript`) / exit 2 (`readFileScript`) — цели не существует.
  notFound,

  /// exit 17 (`renameScript`/`moveScript`) — назначение уже занято.
  alreadyExists,

  /// exit 9 (`readFileScript`) — файл больше `maxSize`.
  tooLarge,

  /// Экзек не выполнился технически (обрыв/таймаут) либо скрипт вернул неожиданный код —
  /// [SshFsException.message] несёт stderr/диагностику.
  io,
}

/// Ошибка операции удалённой ФС — аналог `{ success: false, error }` на десктопе, но исключение
/// (идиоматичнее для Dart, чем повсеместные проверки `success` на стороне вызывающего).
class SshFsException implements Exception {
  const SshFsException(this.code, this.message, {this.size});

  final SshFsErrorCode code;
  final String message;

  /// Заполнен только для [SshFsErrorCode.tooLarge] — фактический размер файла в байтах, если
  /// сервер его сообщил (`stderr` от `readFileScript`).
  final int? size;

  @override
  String toString() => 'SshFsException(${code.name}): $message';
}

/// Результат [SshFsProvider.readFile].
class FileContent {
  const FileContent({required this.content, required this.size});

  final String content;
  final int size;
}

/// `FsProvider` для удалённой ФС по SSH — порт `src/main/fs/ssh-fs-provider.js`. Операции идут
/// через [ExecChannel] (короткоживущие non-interactive exec-вызовы, ограниченные семафором,
/// задача #12) и скрипты из [RemoteScripts]; батчатся по [SshFsConfig.batchSize] путей за вызов —
/// защита от `ARG_MAX` на удалённой стороне (REQ-20).
///
/// `fs.watch` по SSH невозможен — [watchDir]/[unwatchDir] реализованы собственным polling: раз в
/// [SshFsConfig.pollIntervalMs] один exec опрашивает mtime всех наблюдаемых каталогов (не больше
/// [SshFsConfig.pollMaxDirs] за цикл) и публикует изменившиеся через [onDirChanged] — вместо
/// `webContents.send('fs:dir-changed', ...)` на десктопе, у мобилки нет процесса-получателя,
/// только Dart-стрим, на который подписывается UI-слой (задача #26).
class SshFsProvider {
  SshFsProvider({
    required this.exec,
    required String root,
    required this.statFlavorGnu,
    required this.find0,
    String Function(String dirPath, String name)? joinFn,
  }) : _root = root, // ignore: prefer_initializing_formals
       _joinFn = joinFn ?? ((dir, name) => PathUtils.posix.join(dir, [name]));

  final RemoteExec exec;
  String _root;
  final bool statFlavorGnu;
  final bool find0;
  final String Function(String dirPath, String name) _joinFn;

  String _dirname(String p) => PathUtils.posix.dirname(p);

  String get cwd => _root;

  /// Реаттач к другому корню (смена активной вкладки/переподключение) — не трогает состояние
  /// watcher'а, только базу для проверки traversal в последующих вызовах.
  void setRoot(String newRoot) => _root = newRoot;

  String get _statScript => statFlavorGnu
      ? RemoteScripts.statFileGnuScript
      : RemoteScripts.statFileBsdScript;

  String get _pollScript => statFlavorGnu
      ? RemoteScripts.pollMtimeGnuScript
      : RemoteScripts.pollMtimeBsdScript;

  String _execError(ExecResult result, String fallback) {
    if (result.error != null) return result.error.toString();
    if (result.timedOut) return 'Timed out';
    final stderr = utf8.decode(result.stderr, allowMalformed: true).trim();
    if (stderr.isNotEmpty) return stderr;
    return '$fallback (exit ${result.exitCode})';
  }

  Future<List<ReadDirEntry>> readDir(String dirPath) async {
    final script = find0
        ? RemoteScripts.readDirScript
        : RemoteScripts.readDirFallbackScript;
    final result = await exec.exec(script, [dirPath]);
    if (result.exitCode == 3) {
      throw const SshFsException(SshFsErrorCode.notFound, 'No such directory');
    }
    if (result.exitCode != 0) {
      throw SshFsException(
        SshFsErrorCode.io,
        _execError(result, 'readDir failed'),
      );
    }
    return parseReadDir(result.stdout, dirPath, _joinFn);
  }

  Future<void> createFile(String filePath) async {
    final result = await exec.exec(RemoteScripts.createFileScript, [
      _root,
      filePath,
    ]);
    if (result.exitCode == 13) {
      throw const SshFsException(
        SshFsErrorCode.traversalDenied,
        'Path traversal denied: path is outside CWD',
      );
    }
    if (result.exitCode != 0) {
      throw SshFsException(
        SshFsErrorCode.io,
        _execError(result, 'File already exists'),
      );
    }
  }

  Future<void> createDir(String dirPath) async {
    final result = await exec.exec(RemoteScripts.createDirScript, [
      _root,
      dirPath,
    ]);
    if (result.exitCode == 13) {
      throw const SshFsException(
        SshFsErrorCode.traversalDenied,
        'Path traversal denied: path is outside CWD',
      );
    }
    if (result.exitCode != 0) {
      throw SshFsException(
        SshFsErrorCode.io,
        _execError(result, 'createDir failed'),
      );
    }
  }

  Future<void> rename(String oldPath, String newPath) async {
    final result = await exec.exec(RemoteScripts.renameScript, [
      _root,
      oldPath,
      newPath,
    ]);
    if (result.exitCode == 13) {
      throw const SshFsException(
        SshFsErrorCode.traversalDenied,
        'Path traversal denied: path is outside CWD',
      );
    }
    if (result.exitCode == 17) {
      throw const SshFsException(
        SshFsErrorCode.alreadyExists,
        'Destination already exists',
      );
    }
    if (result.exitCode != 0) {
      throw SshFsException(
        SshFsErrorCode.io,
        _execError(result, 'rename failed'),
      );
    }
  }

  Future<void> delete(String targetPath) => deleteMany([targetPath]);

  Future<void> deleteMany(List<String> targetPaths) async {
    for (final batch in _chunk(targetPaths, SshFsConfig.batchSize)) {
      final result = await exec.exec(RemoteScripts.deleteManyScript, [
        _root,
        ...batch,
      ]);
      if (result.exitCode != 0) {
        throw SshFsException(
          SshFsErrorCode.io,
          _execError(result, 'delete failed'),
        );
      }
    }
    _touchAffectedDirs(targetPaths.map(_dirname));
  }

  Future<String> copy(String srcPath, String destDir) async {
    final result = await exec.exec(RemoteScripts.copyScript, [
      _root,
      srcPath,
      destDir,
    ]);
    if (result.exitCode == 13) {
      throw const SshFsException(
        SshFsErrorCode.traversalDenied,
        'Path traversal denied: path is outside CWD',
      );
    }
    if (result.exitCode != 0) {
      throw SshFsException(
        SshFsErrorCode.io,
        _execError(result, 'copy failed'),
      );
    }
    final newPath = parseSinglePathResult(result.stdout);
    if (newPath == null) {
      throw const SshFsException(
        SshFsErrorCode.io,
        'copy failed: empty result',
      );
    }
    _touchAffectedDirs([destDir]);
    return newPath;
  }

  Future<List<PathOperationResult>> copyMany(
    List<String> srcPaths,
    String destDir,
  ) async {
    final results = <PathOperationResult>[];
    for (final batch in _chunk(srcPaths, SshFsConfig.batchSize)) {
      final result = await exec.exec(RemoteScripts.copyManyScript, [
        _root,
        destDir,
        ...batch,
      ]);
      if (result.exitCode != 0) {
        final message = _execError(result, 'copy failed');
        results.addAll(
          batch.map(
            (p) => PathOperationResult(path: p, success: false, error: message),
          ),
        );
        continue;
      }
      results.addAll(parseMoveOrCopyMany(result.stdout, batch));
    }
    _touchAffectedDirs([destDir]);
    return results;
  }

  Future<List<PathOperationResult>> move(
    List<String> srcPaths,
    String destDir,
  ) async {
    final results = <PathOperationResult>[];
    for (final batch in _chunk(srcPaths, SshFsConfig.batchSize)) {
      final result = await exec.exec(RemoteScripts.moveScript, [
        _root,
        destDir,
        ...batch,
      ]);
      if (result.exitCode != 0) {
        final message = _execError(result, 'move failed');
        results.addAll(
          batch.map(
            (p) => PathOperationResult(path: p, success: false, error: message),
          ),
        );
        continue;
      }
      results.addAll(parseMoveOrCopyMany(result.stdout, batch));
    }
    _touchAffectedDirs([destDir, ...srcPaths.map(_dirname)]);
    return results;
  }

  Future<FileContent> readFile(
    String filePath, {
    int maxSize = defaultReadFileMaxSizeBytes,
  }) async {
    final result = await exec.exec(RemoteScripts.readFileScript, [
      filePath,
      '$maxSize',
    ], timeout: const Duration(milliseconds: SshFsConfig.ioTimeoutMs));
    if (result.exitCode == 2) {
      throw const SshFsException(SshFsErrorCode.notFound, 'No such file');
    }
    if (result.exitCode == 9) {
      final size = int.tryParse(
        utf8.decode(result.stderr, allowMalformed: true).trim(),
      );
      throw SshFsException(
        SshFsErrorCode.tooLarge,
        'File too large',
        size: size,
      );
    }
    if (result.exitCode != 0) {
      throw SshFsException(
        SshFsErrorCode.io,
        _execError(result, 'readFile failed'),
      );
    }
    return FileContent(
      content: utf8.decode(result.stdout, allowMalformed: true),
      size: result.stdout.length,
    );
  }

  Future<void> writeFile(String filePath, String content) async {
    final result = await exec.exec(
      RemoteScripts.writeFileScript,
      [filePath],
      stdin: Uint8List.fromList(utf8.encode(content)),
      timeout: const Duration(milliseconds: SshFsConfig.ioTimeoutMs),
    );
    if (result.exitCode != 0) {
      throw SshFsException(
        SshFsErrorCode.io,
        _execError(result, 'writeFile failed'),
      );
    }
    _touchAffectedDirs([_dirname(filePath)]);
  }

  Future<StatFileResult> statFile(String filePath) async {
    final result = await exec.exec(_statScript, [filePath]);
    if (result.exitCode != 0) {
      throw SshFsException(
        SshFsErrorCode.io,
        _execError(result, 'statFile failed'),
      );
    }
    final stat = parseStatFile(
      utf8.decode(result.stdout, allowMalformed: true),
    );
    if (stat == null) {
      throw const SshFsException(SshFsErrorCode.io, 'Unexpected stat output');
    }
    return stat;
  }

  // --- Polling-watcher взамен fs.watch (недоступен по SSH) ---

  final Map<String, int?> _mtimeCache = {};
  final Set<String> _watched = {};
  String? _rootWatchPath;
  Timer? _pollTimer;
  bool _pollInFlight = false;
  final StreamController<String> _dirChanged =
      StreamController<String>.broadcast();

  /// Каталоги, для которых poll-цикл обнаружил изменение mtime (или мутация этого провайдера
  /// коснулась их напрямую, см. [_touchAffectedDirs]) — путь передаётся как есть, без деталей
  /// изменения (сервер по SSH не даёт их дешевле, чем полным `readDir`, это ответственность
  /// подписчика).
  Stream<String> get onDirChanged => _dirChanged.stream;

  /// [isRoot] — этот каталог опрашивается ПЕРВЫМ в каждом цикле (не теряется при обрезке до
  /// [SshFsConfig.pollMaxDirs], в отличие от остальных).
  void watchDir(String dirPath, {bool isRoot = false}) {
    _watched.add(dirPath);
    if (isRoot) _rootWatchPath = dirPath;
    _ensurePolling();
  }

  void unwatchDir(String dirPath) {
    _watched.remove(dirPath);
    _mtimeCache.remove(dirPath);
    if (_rootWatchPath == dirPath) _rootWatchPath = null;
    if (_watched.isEmpty) _stopPolling();
  }

  void unwatchAll() {
    _watched.clear();
    _mtimeCache.clear();
    _rootWatchPath = null;
    _stopPolling();
  }

  /// Освобождает таймер и стрим — вызывать при закрытии вкладки/провайдера.
  void dispose() {
    _stopPolling();
    _dirChanged.close();
  }

  void _touchAffectedDirs(Iterable<String> dirPaths) {
    for (final dir in dirPaths) {
      if (_watched.contains(dir)) _dirChanged.add(dir);
    }
  }

  void _ensurePolling() {
    _pollTimer ??= Timer.periodic(
      const Duration(milliseconds: SshFsConfig.pollIntervalMs),
      (_) => pollOnce(),
    );
  }

  void _stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  /// Один цикл опроса — публичный, чтобы тесты могли триггерить его напрямую вместо ожидания
  /// реального таймера (`watchDir` планирует его же через [Timer.periodic]).
  Future<void> pollOnce() async {
    if (_pollInFlight || _watched.isEmpty) return;
    _pollInFlight = true;
    try {
      final all = _watched.toList();
      final dirs = _rootWatchPath != null
          ? [
              _rootWatchPath!,
              ...all.where((d) => d != _rootWatchPath),
            ].take(SshFsConfig.pollMaxDirs).toList()
          : all.length > SshFsConfig.pollMaxDirs
          ? all.sublist(all.length - SshFsConfig.pollMaxDirs)
          : all;

      final result = await exec.exec(_pollScript, dirs);
      if (result.exitCode != 0) return;
      final mtimes = parsePollMtimes(
        utf8.decode(result.stdout, allowMalformed: true),
        dirs,
      );
      for (final entry in mtimes.entries) {
        final prev = _mtimeCache[entry.key];
        final hadPrev = _mtimeCache.containsKey(entry.key);
        _mtimeCache[entry.key] = entry.value;
        if (hadPrev && prev != entry.value) {
          _dirChanged.add(entry.key);
        }
      }
    } finally {
      _pollInFlight = false;
    }
  }

  List<List<T>> _chunk<T>(List<T> list, int size) {
    final out = <List<T>>[];
    for (var i = 0; i < list.length; i += size) {
      out.add(list.sublist(i, i + size > list.length ? list.length : i + size));
    }
    return out;
  }
}
