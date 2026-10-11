/// Узел дерева удалённых файлов (задача #26). Мутируется на месте контроллером
/// (`file_tree_controller.dart`) — сравнение узлов между собой всегда по identity (`==`
/// по умолчанию), не по [path], поэтому один и тот же узел можно безопасно переиспользовать
/// между перезагрузками каталога (см. `FileTreeController._mergeChildren`), не теряя состояние
/// `expanded` у вложенных узлов, которые не изменились.
class FileTreeNode {
  FileTreeNode({
    required this.path,
    required this.name,
    required this.isDirectory,
    this.expanded = false,
  });

  final String path;
  final String name;
  final bool isDirectory;

  bool expanded;

  /// `null` — каталог ещё ни разу не читался (`readDir` не вызывался). Пустой список — читался и
  /// пуст. Только для директорий.
  List<FileTreeNode>? children;

  bool loading = false;

  /// Сообщение последней неудачной загрузки ЭТОГО каталога (`readDir`) — показывается вместо
  /// списка детей, пока каталог не перезагрузят успешно.
  String? error;
}
