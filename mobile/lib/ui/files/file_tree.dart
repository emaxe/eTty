import 'package:flutter/material.dart';

import 'package:mobile/domain/ssh_fs_provider.dart';
import 'package:mobile/ui/files/file_tree_controller.dart';
import 'package:mobile/ui/files/file_tree_node.dart';

/// Чистый виджет дерева удалённых файлов (задача #26) поверх уже готового [provider] —
/// установление SSH-подключения и вызов probe остаются снаружи (`RemoteFileTreeScreen`,
/// `remote_file_tree_screen.dart`), что даёт шов для виджет-тестов с фейковым `RemoteExec`
/// (см. `test/ui/files/file_tree_test.dart`), без реальной сети.
class FileTree extends StatefulWidget {
  const FileTree({
    super.key,
    required this.provider,
    required this.rootPath,
    this.onOpenFile,
  });

  final SshFsProvider provider;
  final String rootPath;

  /// Тап по файлу (не по папке — те раскрываются/сворачиваются через [FileTreeController]).
  /// `null` по умолчанию — тап по файлу тогда ничего не делает (обратная совместимость с местами,
  /// где просмотр/правка не подключены).
  final void Function(String path)? onOpenFile;

  @override
  State<FileTree> createState() => _FileTreeState();
}

class _FileTreeState extends State<FileTree> {
  late final FileTreeController _controller = FileTreeController(
    provider: widget.provider,
    rootPath: widget.rootPath,
  );

  String? _shownOpError;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onControllerChanged);
    _controller.init();
  }

  @override
  void dispose() {
    _controller.removeListener(_onControllerChanged);
    _controller.dispose();
    super.dispose();
  }

  void _onControllerChanged() {
    final error = _controller.lastOpError;
    if (error != null && error != _shownOpError) {
      _shownOpError = error;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error)));
      });
    }
    setState(() {});
  }

  List<({FileTreeNode node, int depth})> _visibleNodes() {
    final out = <({FileTreeNode node, int depth})>[];
    void walk(FileTreeNode node, int depth) {
      out.add((node: node, depth: depth));
      if (node.isDirectory && node.expanded) {
        for (final child in node.children ?? const <FileTreeNode>[]) {
          walk(child, depth + 1);
        }
      }
    }

    walk(_controller.root, 0);
    return out;
  }

  Future<String?> _promptNameValue(BuildContext context, String title) {
    return showDialog<String>(
      context: context,
      builder: (context) => _NamePromptDialog(title: title),
    );
  }

  Future<bool> _confirmDelete(BuildContext context, FileTreeNode node) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Удалить?'),
        content: Text('«${node.name}» будет удалено безвозвратно.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Удалить'),
          ),
        ],
      ),
    );
    return confirmed ?? false;
  }

  Future<void> _handleMenuAction(
    BuildContext context,
    FileTreeNode node,
    _NodeMenuAction action,
  ) async {
    switch (action) {
      case _NodeMenuAction.newFile:
        final name = await _promptNameValue(context, 'Новый файл');
        if (name != null && name.isNotEmpty) {
          await _controller.createFile(node, name);
        }
      case _NodeMenuAction.newDir:
        final name = await _promptNameValue(context, 'Новая папка');
        if (name != null && name.isNotEmpty) {
          await _controller.createDir(node, name);
        }
      case _NodeMenuAction.rename:
        final name = await _promptNameValue(context, 'Переименовать');
        if (name != null && name.isNotEmpty) {
          await _controller.rename(node, name);
        }
      case _NodeMenuAction.delete:
        if (await _confirmDelete(context, node)) {
          await _controller.delete(node);
        }
      case _NodeMenuAction.copy:
        _controller.copyToClipboard(node);
      case _NodeMenuAction.cut:
        _controller.cutToClipboard(node);
      case _NodeMenuAction.paste:
        await _controller.pasteInto(node);
    }
  }

  @override
  Widget build(BuildContext context) {
    final visible = _visibleNodes();
    return Column(
      children: [
        if (_controller.clipboard != null)
          Material(
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            child: ListTile(
              dense: true,
              leading: const Icon(Icons.content_paste),
              title: Text(
                _controller.clipboard!.move
                    ? 'Вырезано: ${_controller.clipboard!.path}'
                    : 'Скопировано: ${_controller.clipboard!.path}',
              ),
              trailing: IconButton(
                icon: const Icon(Icons.close),
                onPressed: _controller.clearClipboard,
              ),
            ),
          ),
        Expanded(
          child: ListView.builder(
            itemCount: visible.length,
            itemBuilder: (context, index) {
              final entry = visible[index];
              return _FileTreeRow(
                key: ValueKey(entry.node.path),
                node: entry.node,
                depth: entry.depth,
                hasClipboard: _controller.clipboard != null,
                onTap: entry.node.isDirectory
                    ? () => _controller.toggleExpand(entry.node)
                    : widget.onOpenFile == null
                    ? null
                    : () => widget.onOpenFile!(entry.node.path),
                onMenuAction: (action) =>
                    _handleMenuAction(context, entry.node, action),
              );
            },
          ),
        ),
      ],
    );
  }
}

enum _NodeMenuAction { newFile, newDir, rename, delete, copy, cut, paste }

class _FileTreeRow extends StatelessWidget {
  const _FileTreeRow({
    super.key,
    required this.node,
    required this.depth,
    required this.hasClipboard,
    required this.onTap,
    required this.onMenuAction,
  });

  final FileTreeNode node;
  final int depth;
  final bool hasClipboard;

  /// Уже вычислен вызывающей стороной с учётом [node.isDirectory] (раскрытие каталога / открытие
  /// файла / `null`, если для файла не задан [FileTree.onOpenFile]) — этот виджет тап не гейтит
  /// повторно.
  final VoidCallback? onTap;
  final ValueChanged<_NodeMenuAction> onMenuAction;

  IconData get _icon {
    if (!node.isDirectory) return Icons.insert_drive_file_outlined;
    return node.expanded ? Icons.folder_open : Icons.folder;
  }

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      onLongPress: () => _showMenu(context),
      child: Padding(
        padding: EdgeInsets.only(
          left: 16.0 * depth,
          right: 4,
          top: 2,
          bottom: 2,
        ),
        child: Row(
          children: [
            SizedBox(
              width: 24,
              child: node.loading
                  ? const Padding(
                      padding: EdgeInsets.all(2),
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Icon(_icon, size: 20),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    node.name,
                    overflow: TextOverflow.ellipsis,
                    style: node.error != null
                        ? TextStyle(color: Theme.of(context).colorScheme.error)
                        : null,
                  ),
                  if (node.error case final error?)
                    Text(
                      error,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 12,
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                ],
              ),
            ),
            IconButton(
              icon: const Icon(Icons.more_vert),
              onPressed: () => _showMenu(context),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _showMenu(BuildContext context) async {
    final button = context.findRenderObject() as RenderBox?;
    final overlay =
        Overlay.of(context).context.findRenderObject() as RenderBox?;
    final position = button != null && overlay != null
        ? RelativeRect.fromRect(
            Rect.fromPoints(
              button.localToGlobal(Offset.zero, ancestor: overlay),
              button.localToGlobal(
                button.size.bottomRight(Offset.zero),
                ancestor: overlay,
              ),
            ),
            Offset.zero & overlay.size,
          )
        : const RelativeRect.fromLTRB(0, 0, 0, 0);

    final action = await showMenu<_NodeMenuAction>(
      context: context,
      position: position,
      items: [
        if (node.isDirectory) ...[
          const PopupMenuItem(
            value: _NodeMenuAction.newFile,
            child: Text('Новый файл'),
          ),
          const PopupMenuItem(
            value: _NodeMenuAction.newDir,
            child: Text('Новая папка'),
          ),
        ],
        const PopupMenuItem(
          value: _NodeMenuAction.rename,
          child: Text('Переименовать'),
        ),
        const PopupMenuItem(
          value: _NodeMenuAction.delete,
          child: Text('Удалить'),
        ),
        const PopupMenuItem(
          value: _NodeMenuAction.copy,
          child: Text('Копировать'),
        ),
        const PopupMenuItem(
          value: _NodeMenuAction.cut,
          child: Text('Вырезать'),
        ),
        if (node.isDirectory && hasClipboard)
          const PopupMenuItem(
            value: _NodeMenuAction.paste,
            child: Text('Вставить сюда'),
          ),
      ],
    );
    if (action != null) onMenuAction(action);
  }
}

class _NamePromptDialog extends StatefulWidget {
  const _NamePromptDialog({required this.title});

  final String title;

  @override
  State<_NamePromptDialog> createState() => _NamePromptDialogState();
}

class _NamePromptDialogState extends State<_NamePromptDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.title),
      content: TextField(
        controller: _controller,
        autofocus: true,
        decoration: const InputDecoration(labelText: 'Имя'),
        onSubmitted: (value) => Navigator.of(context).pop(value),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(null),
          child: const Text('Отмена'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(_controller.text),
          child: const Text('Создать'),
        ),
      ],
    );
  }
}
