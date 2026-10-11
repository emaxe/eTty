import 'dart:async';

import 'package:flutter/foundation.dart';

import 'package:mobile/core/config/path_utils.dart';
import 'package:mobile/domain/ssh_fs_provider.dart';
import 'package:mobile/remote/remote_parse.dart';
import 'package:mobile/ui/files/file_tree_node.dart';

/// Буфер «копировать/вырезать» — один элемент за раз (как «вставить сюда» в брифе задачи #26,
/// не полноценный drag-n-drop).
class ClipboardOp {
  const ClipboardOp({required this.path, required this.move});

  final String path;

  /// `true` — вырезано (move), `false` — скопировано (copy).
  final bool move;
}

/// Человеко-читаемое сообщение по коду [SshFsException] — общий текст для всех операций дерева
/// (см. бриф задачи #26: notFound/traversalDenied/alreadyExists — фиксированные сообщения,
/// остальное — `e.message`).
String describeSshFsError(SshFsException e) {
  switch (e.code) {
    case SshFsErrorCode.notFound:
      return 'Путь не найден';
    case SshFsErrorCode.traversalDenied:
      return 'Доступ за пределами корня запрещён';
    case SshFsErrorCode.alreadyExists:
      return 'Уже существует';
    case SshFsErrorCode.tooLarge:
      return 'Файл слишком большой';
    case SshFsErrorCode.io:
      return e.message;
  }
}

String _describeError(Object error) =>
    error is SshFsException ? describeSshFsError(error) : error.toString();

/// Состояние дерева удалённых файлов поверх готового [SshFsProvider] (задача #26) — чистая
/// модель без зависимости от `BuildContext`/виджетов, тестируется отдельно от `FileTree`.
/// Ленивая загрузка: только [root] читается сразу ([init]), остальные каталоги — при
/// [toggleExpand]. Раскрытые каталоги наблюдаются через [SshFsProvider.watchDir]; изменение
/// публикуется в [SshFsProvider.onDirChanged] и обрабатывается точечным перечитыванием ТОЛЬКО
/// изменившегося каталога — состояние раскрытых соседних узлов не теряется (см.
/// `_mergeChildren`, который переиспользует существующие узлы по пути).
class FileTreeController extends ChangeNotifier {
  FileTreeController({required this.provider, required String rootPath})
    : root = FileTreeNode(
        path: rootPath,
        name: PathUtils.posix.basename(rootPath).isEmpty
            ? rootPath
            : PathUtils.posix.basename(rootPath),
        isDirectory: true,
        expanded: true,
      );

  final SshFsProvider provider;
  final FileTreeNode root;

  StreamSubscription<String>? _dirChangedSub;

  ClipboardOp? clipboard;

  /// Последняя ошибка операции (create/rename/delete/copy/move) — не привязана к конкретному
  /// узлу, показывается один раз виджетом (снэкбар) и не персистится в модели.
  String? lastOpError;

  bool _disposed = false;

  bool _showHidden = false;

  /// Показывать ли скрытые узлы (имя начинается с `.`). Фильтрация чисто клиентская: данные
  /// провайдера и состояние `expanded`/`children` узлов не меняются, поэтому раскрытая папка
  /// после «скрыть → показать» остаётся раскрытой.
  bool get showHidden => _showHidden;

  set showHidden(bool value) {
    if (_showHidden == value) return;
    _showHidden = value;
    _notify();
  }

  /// Виден ли [node] при текущем [showHidden]. Корень не скрывается никогда.
  bool isVisible(FileTreeNode node) =>
      _showHidden || identical(node, root) || !node.name.startsWith('.');

  /// Дети [node], видимые при текущем [showHidden] (пусто, если дети не загружены).
  List<FileTreeNode> visibleChildren(FileTreeNode node) => [
    for (final child in node.children ?? const <FileTreeNode>[])
      if (isVisible(child)) child,
  ];

  Future<void> init() {
    _dirChangedSub = provider.onDirChanged.listen(_onDirChanged);
    return _loadChildren(root, isRoot: true);
  }

  @override
  void dispose() {
    _disposed = true;
    _dirChangedSub?.cancel();
    provider.unwatchAll();
    super.dispose();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> toggleExpand(FileTreeNode node) async {
    if (!node.isDirectory) return;
    if (node.expanded) {
      node.expanded = false;
      provider.unwatchDir(node.path);
      _notify();
      return;
    }
    node.expanded = true;
    _notify();
    if (node.children == null) {
      await _loadChildren(node);
    } else {
      provider.watchDir(node.path);
    }
  }

  Future<void> refresh(FileTreeNode node) =>
      _loadChildren(node, isRoot: identical(node, root));

  Future<void> _loadChildren(FileTreeNode node, {bool isRoot = false}) async {
    node.loading = true;
    node.error = null;
    _notify();
    try {
      final entries = await provider.readDir(node.path);
      node.children = _mergeChildren(node.children, entries);
      provider.watchDir(node.path, isRoot: isRoot);
    } catch (error) {
      node.error = _describeError(error);
    } finally {
      node.loading = false;
      _notify();
    }
  }

  List<FileTreeNode> _mergeChildren(
    List<FileTreeNode>? previous,
    List<ReadDirEntry> entries,
  ) {
    final byPath = {
      for (final n in previous ?? const <FileTreeNode>[]) n.path: n,
    };
    final result = <FileTreeNode>[
      for (final entry in entries)
        if (byPath[entry.path] case final existing?
            when existing.isDirectory == entry.isDirectory)
          existing
        else
          FileTreeNode(
            path: entry.path,
            name: entry.name,
            isDirectory: entry.isDirectory,
          ),
    ];
    result.sort((a, b) {
      if (a.isDirectory != b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.compareTo(b.name);
    });
    return result;
  }

  void _onDirChanged(String path) {
    final node = _findNode(root, path);
    if (node != null && node.expanded) {
      unawaited(_loadChildren(node, isRoot: identical(node, root)));
    }
  }

  FileTreeNode? _findNode(FileTreeNode node, String path) {
    if (node.path == path) return node;
    for (final child in node.children ?? const <FileTreeNode>[]) {
      final found = _findNode(child, path);
      if (found != null) return found;
    }
    return null;
  }

  FileTreeNode? _parentOf(FileTreeNode target) => _findParent(root, target);

  FileTreeNode? _findParent(FileTreeNode node, FileTreeNode target) {
    for (final child in node.children ?? const <FileTreeNode>[]) {
      if (identical(child, target)) return node;
      final found = _findParent(child, target);
      if (found != null) return found;
    }
    return null;
  }

  Future<bool> createFile(FileTreeNode parent, String name) => _runOp(
    parent,
    () => provider.createFile(PathUtils.posix.join(parent.path, [name])),
  );

  Future<bool> createDir(FileTreeNode parent, String name) => _runOp(
    parent,
    () => provider.createDir(PathUtils.posix.join(parent.path, [name])),
  );

  Future<bool> rename(FileTreeNode node, String newName) {
    final parent = _parentOf(node) ?? root;
    final newPath = PathUtils.posix.join(PathUtils.posix.dirname(node.path), [
      newName,
    ]);
    return _runOp(parent, () => provider.rename(node.path, newPath));
  }

  Future<bool> delete(FileTreeNode node) {
    final parent = _parentOf(node) ?? root;
    return _runOp(parent, () => provider.delete(node.path));
  }

  void copyToClipboard(FileTreeNode node) {
    clipboard = ClipboardOp(path: node.path, move: false);
    _notify();
  }

  void cutToClipboard(FileTreeNode node) {
    clipboard = ClipboardOp(path: node.path, move: true);
    _notify();
  }

  void clearClipboard() {
    clipboard = null;
    _notify();
  }

  Future<bool> pasteInto(FileTreeNode destDir) async {
    final op = clipboard;
    if (op == null) return false;
    final ok = await _runOp(destDir, () async {
      if (op.move) {
        final results = await provider.move([op.path], destDir.path);
        final result = results.first;
        if (!result.success) {
          throw SshFsException(
            SshFsErrorCode.io,
            result.error ?? 'Операция не удалась',
          );
        }
      } else {
        await provider.copy(op.path, destDir.path);
      }
    });
    if (ok) {
      clipboard = null;
      _notify();
    }
    return ok;
  }

  Future<bool> _runOp(
    FileTreeNode refreshNode,
    Future<void> Function() op,
  ) async {
    lastOpError = null;
    try {
      await op();
      await _loadChildren(refreshNode, isRoot: identical(refreshNode, root));
      return true;
    } catch (error) {
      lastOpError = _describeError(error);
      _notify();
      return false;
    }
  }
}
