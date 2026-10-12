import 'dart:convert';
import 'dart:typed_data';

/// Чистые парсеры вывода скриптов из [RemoteScripts] — порт `src/main/ssh/remote-parse.js`
/// десктопного eTty. Без побочных эффектов: принимают уже полученные байты/строки exec-вызова,
/// возвращают типизированные структуры. Все функции предполагают успешный (`exitCode == 0`)
/// exec — проверка кода возврата остаётся на стороне вызывающего кода (`domain/ssh_fs_provider.dart`,
/// `domain/tmux_sessions.dart`, задачи #17/#18).
///
/// Сверяется golden-тестом (`mobile/test/golden/remote_parse_golden_test.dart`) против
/// `mobile/test/fixtures/remote/parse/*.json` — входы сгенерированы как реальные образцы вывода
/// [RemoteScripts], ожидания посчитаны самим JS-источником (REQ-3).

/// Результат [parseProbe].
class ProbeResult {
  const ProbeResult({
    required this.uname,
    required this.home,
    required this.user,
    required this.shell,
    required this.statFlavor,
    required this.find0,
    required this.inotify,
    required this.rg,
    required this.tmuxVersion,
    required this.tmuxPassthrough,
    required this.pkgManager,
  });

  final String uname;
  final String home;
  final String user;
  final String shell;

  /// `'gnu'` или `'bsd'` — какой флавор `stat`/`POLL_MTIME_*` использовать.
  final String statFlavor;
  final bool find0;
  final bool inotify;
  final bool rg;
  final String? tmuxVersion;
  final bool tmuxPassthrough;
  final String? pkgManager;
}

/// Результат [parseTmuxSessionState] — `null`, если ни одно поле не заполнено (сокета/сессии
/// нет — не ошибка, обрабатывается по коду возврата на стороне вызывающего).
class TmuxSessionState {
  const TmuxSessionState({
    required this.currentPath,
    required this.pathFromOsc,
    required this.currentCommand,
  });

  final String currentPath;
  final String pathFromOsc;
  final String currentCommand;
}

/// Один элемент результата [parseTmuxSessions]. `attached` первыми, дальше по `activityAt`
/// убыв. (сессии без activity — в конце, в исходном порядке) — сортировка уже применена.
class TmuxSessionInfo {
  const TmuxSessionInfo({
    required this.name,
    required this.windows,
    required this.attached,
    required this.createdAt,
    required this.activityAt,
    required this.currentCommand,
  });

  final String name;
  final int windows;
  final int attached;
  final int createdAt;
  final int? activityAt;
  final String? currentCommand;
}

/// Один элемент результата [parseReadDir].
class ReadDirEntry {
  const ReadDirEntry({required this.name, required this.path, required this.isDirectory});

  final String name;
  final String path;
  final bool isDirectory;
}

/// Один элемент результата [parseMoveOrCopyMany].
class PathOperationResult {
  const PathOperationResult({
    required this.path,
    required this.success,
    this.newPath,
    this.error,
  });

  final String path;
  final bool success;
  final String? newPath;
  final String? error;
}

/// Результат [parseStatFile].
class StatFileResult {
  const StatFileResult({required this.mtimeMs, required this.size});

  final int mtimeMs;
  final int size;
}

/// Сигнатура POSIX-safe join, передаваемая в [parseReadDir] — совместима с
/// `PathUtils.posix.join(dir, [name])`, обёрнутым вызывающей стороной.
typedef PathJoinFn = String Function(String dirPath, String name);

/// `tmux -V` печатает `tmux X.Y[letter]` (напр. `tmux 3.3a`) либо `tmux next-X.Y` на снапшотах
/// (считаем поддерживающими — снапшот заведомо новее любого релиза). Сравнение — числовое, не
/// лексикографическое: `"3.10"` лексикографически МЕНЬШЕ `"3.3"`, но численно minor=10 >= 3.
bool _tmuxSupportsPassthrough(String tmuxVersionLine) {
  if (tmuxVersionLine.isEmpty || tmuxVersionLine == '-') return false;
  if (RegExp(r'^tmux next-').hasMatch(tmuxVersionLine)) return true;
  final match = RegExp(r'^tmux (\d+)\.(\d+)').firstMatch(tmuxVersionLine);
  if (match == null) return false;
  final major = int.parse(match.group(1)!);
  final minor = int.parse(match.group(2)!);
  const minMajor = 3;
  const minMinor = 3;
  if (major != minMajor) return major > minMajor;
  return minor >= minMinor;
}

/// Мимикрия под JS `Array.prototype.slice(start, end)`: клэмпит индексы к границам списка,
/// поддерживает отрицательный `end` (от конца), никогда не бросает исключение — в отличие от
/// `List.sublist`, которое требует валидный диапазон. Нужна только там, где логика 1:1
/// скопирована из JS-кода, полагающегося на эту вседозволенность `slice()`.
List<T> _jsSlice<T>(List<T> list, int start, [int? end]) {
  final length = list.length;
  int normalize(int i) => i < 0 ? (length + i).clamp(0, length) : i.clamp(0, length);
  final s = normalize(start);
  final e = normalize(end ?? length);
  return s < e ? list.sublist(s, e) : <T>[];
}

/// Разбирает вывод `RemoteScripts.probeScript`.
ProbeResult parseProbe(String stdout) {
  final lines = stdout.split('\n');
  String at(int i) => (i < lines.length ? lines[i] : '').trim();
  final tmuxLine = at(8);
  final pkgManagerLine = at(9);
  return ProbeResult(
    uname: at(0),
    home: at(1),
    user: at(2),
    shell: at(3),
    statFlavor: at(4) == 'gnu' ? 'gnu' : 'bsd',
    find0: at(5) == 'find0',
    inotify: at(6) == 'inotify',
    rg: at(7) == 'rg',
    tmuxVersion: tmuxLine.isNotEmpty && tmuxLine != '-' ? tmuxLine : null,
    tmuxPassthrough: _tmuxSupportsPassthrough(tmuxLine),
    pkgManager: pkgManagerLine.isNotEmpty && pkgManagerLine != '-' ? pkgManagerLine : null,
  );
}

/// Разбирает вывод `RemoteScripts.tmuxSessionStateScript`:
/// `<pane_current_path>|<pane_path>|<pane_current_command>`.
TmuxSessionState? parseTmuxSessionState(String stdout) {
  final line = stdout.split('\n').first;
  if (line.isEmpty) return null;
  final parts = line.split('|');
  final currentPath = parts.isNotEmpty ? parts[0] : '';
  final pathFromOsc = parts.length > 1 ? parts[1] : '';
  final currentCommand = parts.length > 2 ? parts[2] : '';
  if (currentPath.isEmpty && pathFromOsc.isEmpty && currentCommand.isEmpty) return null;
  return TmuxSessionState(
    currentPath: currentPath,
    pathFromOsc: pathFromOsc,
    currentCommand: currentCommand,
  );
}

/// Разбирает вывод `RemoteScripts.tmuxListSessionsScript`: строки-записи (`\n` — естественный
/// разделитель от самого tmux), поля внутри строки — NUL (TAB→NUL на сервере, не TAB/NEWLINE→NUL —
/// чтобы пустой `session_activity` не путался с границей секций). Секции — «сессии» (5 полей) и
/// «активная команда каждой сессии» (4 поля) — разделены ровно ОДНОЙ ПУСТОЙ строкой; запись
/// сессии, даже с пустой `activity`, никогда не бывает пустой строкой целиком (минимум 4 NUL
/// между 5 полями), поэтому первая пустая строка после разбиения по `\n` ГАРАНТИРОВАННО
/// разделитель секций.
List<TmuxSessionInfo> parseTmuxSessions(Uint8List stdoutBuffer) {
  final lines = utf8.decode(stdoutBuffer).split('\n');
  // Хвостовой элемент — всегда артефакт финального \n второй секции (или единственного \n при
  // пустом сервере), отбрасывается безусловно.
  if (lines.isNotEmpty && lines.last == '') lines.removeLast();

  final sepIndex = lines.indexWhere((l) => l == '');
  final sessionLines = sepIndex == -1 ? lines : _jsSlice(lines, 0, sepIndex);
  final paneLines = sepIndex == -1 ? <String>[] : _jsSlice(lines, sepIndex + 1);

  final commandBySession = <String, String?>{};
  for (final line in paneLines) {
    final fields = line.split('\x00');
    if (fields.length < 4) continue;
    final windowActive = fields[0];
    final paneActive = fields[1];
    final command = fields[2];
    final name = fields[3];
    if (windowActive == '1' && paneActive == '1' && name.isNotEmpty) {
      commandBySession[name] = command.isNotEmpty ? command : null;
    }
  }

  final digitsRe = RegExp(r'^\d+$');
  final sessions = <TmuxSessionInfo>[];
  for (final line in sessionLines) {
    final fields = line.split('\x00');
    if (fields.length < 5) continue;
    final windowsRaw = fields[0];
    final attachedRaw = fields[1];
    final createdRaw = fields[2];
    final activityRaw = fields[3];
    final name = fields[4];
    // Защита от TAB (→NUL) в имени сессии (возможно только через ручной rename-session) — если
    // числовые поля не числа, запись сдвинулась и разбирать её нельзя; пропускаем битую запись
    // целиком, соседние (валидные) записи не трогаем.
    if (name.isEmpty ||
        !digitsRe.hasMatch(windowsRaw) ||
        !digitsRe.hasMatch(attachedRaw) ||
        !digitsRe.hasMatch(createdRaw)) {
      continue;
    }
    sessions.add(TmuxSessionInfo(
      name: name,
      windows: int.parse(windowsRaw),
      attached: int.parse(attachedRaw),
      createdAt: int.parse(createdRaw) * 1000,
      activityAt: digitsRe.hasMatch(activityRaw) ? int.parse(activityRaw) * 1000 : null,
      currentCommand: commandBySession[name],
    ));
  }

  sessions.sort((a, b) {
    if (a.attached != b.attached) return b.attached - a.attached;
    final aAct = a.activityAt ?? -1;
    final bAct = b.activityAt ?? -1;
    return bAct - aAct;
  });
  return sessions;
}

/// Разбирает вывод `RemoteScripts.readDirScript`/`readDirFallbackScript`:
/// `<dirs NUL-terminated>` + один разделительный `\0` + `<files NUL-terminated>`. Первая пустая
/// строка после разбиения по `\0` ГАРАНТИРОВАННО разделитель — реальное имя файла не может быть
/// пустым. [joinFn] — POSIX-safe join (`PathUtils.posix.join`, обёрнутый вызывающей стороной).
List<ReadDirEntry> parseReadDir(Uint8List stdoutBuffer, String dirPath, PathJoinFn joinFn) {
  final parts = utf8.decode(stdoutBuffer).split('\x00');
  final sepIndex = parts.indexWhere((p) => p == '');
  final dirNames = sepIndex == -1 ? <String>[] : _jsSlice(parts, 0, sepIndex);
  final fileNames = sepIndex == -1 ? <String>[] : _jsSlice(parts, sepIndex + 1, -1);

  String stripPrefix(String raw) => raw.startsWith('./') ? raw.substring(2) : raw;

  final entries = <ReadDirEntry>[];
  for (final raw in dirNames) {
    final name = stripPrefix(raw);
    if (name.isEmpty) continue;
    entries.add(ReadDirEntry(name: name, path: joinFn(dirPath, name), isDirectory: true));
  }
  for (final raw in fileNames) {
    final name = stripPrefix(raw);
    if (name.isEmpty) continue;
    entries.add(ReadDirEntry(name: name, path: joinFn(dirPath, name), isDirectory: false));
  }
  return entries;
}

/// Разбирает вывод `RemoteScripts.moveScript`/`copyManyScript`: пары `O\0<newPath>\0` (успех)
/// или `E\0<srcPath>\0` (ошибка), по одной на каждый исходный путь, в порядке входа.
/// [srcPaths] — исходный порядок вызова (для сопоставления с `path` в ответе).
List<PathOperationResult> parseMoveOrCopyMany(Uint8List stdoutBuffer, List<String> srcPaths) {
  final rawTokens = utf8.decode(stdoutBuffer).split('\x00');
  final tokens = _jsSlice(rawTokens, 0, rawTokens.length - 1);
  final results = <PathOperationResult>[];
  var srcIndex = 0;
  for (var i = 0; i + 1 < tokens.length; i += 2) {
    final status = tokens[i];
    final value = tokens[i + 1];
    final src = srcIndex < srcPaths.length ? srcPaths[srcIndex] : value;
    srcIndex++;
    if (status == 'O') {
      results.add(PathOperationResult(path: src, success: true, newPath: value));
    } else {
      results.add(PathOperationResult(path: src, success: false, error: 'Operation failed'));
    }
  }
  return results;
}

/// Разбирает `"%s\0"`-вывод `RemoteScripts.copyScript` (один путь — новый путь после разрешения
/// коллизии).
String? parseSinglePathResult(Uint8List stdoutBuffer) {
  final s = utf8.decode(stdoutBuffer);
  final idx = s.indexOf('\x00');
  final value = idx == -1 ? s : s.substring(0, idx);
  return value.isEmpty ? null : value;
}

/// Разбирает `"<mtimeSec> <sizeBytes>"` (вывод `RemoteScripts.statFileGnuScript`/`statFileBsdScript`).
StatFileResult? parseStatFile(String stdout) {
  final match = RegExp(r'^(\d+)\s+(\d+)$').firstMatch(stdout.trim());
  if (match == null) return null;
  return StatFileResult(
    mtimeMs: int.parse(match.group(1)!) * 1000,
    size: int.parse(match.group(2)!),
  );
}

/// Разбирает вывод `RemoteScripts.pollMtimeGnuScript`/`pollMtimeBsdScript`: по одной строке
/// (mtime сек либо `x`) на каждый переданный каталог, в том же порядке. `null` в значении —
/// каталог исчез/недоступен.
Map<String, int?> parsePollMtimes(String stdout, List<String> dirPaths) {
  final rawLines = stdout.split('\n');
  final lines = <String>[
    for (var i = 0; i < rawLines.length; i++)
      if (i < rawLines.length - 1 || rawLines[i] != '') rawLines[i],
  ];
  final result = <String, int?>{};
  for (var i = 0; i < dirPaths.length; i++) {
    final line = (i < lines.length ? lines[i] : '').trim();
    result[dirPaths[i]] = (line == 'x' || line.isEmpty) ? null : int.parse(line);
  }
  return result;
}
