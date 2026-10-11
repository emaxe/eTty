import 'dart:async';

import 'package:flutter/material.dart';
import 'package:re_editor/re_editor.dart';

import 'package:mobile/app/theme/etty_colors.dart';
import 'package:mobile/core/config/path_utils.dart';
import 'package:mobile/domain/ssh_fs_provider.dart';
import 'package:mobile/ui/editor/code_theme.dart';
import 'package:mobile/ui/files/file_tree_controller.dart'
    show describeSshFsError;

/// Порог размера содержимого (в байтах прочитанного `FileContent.size`), начиная с которого
/// используется `CodeLineEditingController.fromTextAsync` вместо синхронного `fromText` — по
/// решению спайка S5 (`docs/plans/mob/plan.md`): на 1 МБ синхронный разбор уже занимает 74 мс,
/// на файлах, близких к лимиту `SshFsProvider.readFile` (по умолчанию 5 МБ), это заметный джанк
/// кадра, поэтому для них разбор уводится в асинхронный путь пакета.
const int asyncParseThresholdBytes = 512 * 1024;

enum _EditorScreenState { loading, tooLarge, error, ready }

/// Экран просмотра/правки одного удалённого файла (задача #27, REQ-21).
///
/// Принимает уже готовый [SshFsProvider] и путь конструктором — в отличие от экранов
/// подключения (#25/#26), у редактора нет причины устанавливать своё SSH-подключение: он всегда
/// открывается из уже открытого дерева файлов с уже готовым провайдером (см. разделение
/// «подключение» vs «чистый виджет» в `mobile/lib/ui/terminal/terminal_page.dart`,
/// `_TerminalPageState._connect()`).
class FileEditorScreen extends StatefulWidget {
  const FileEditorScreen({
    super.key,
    required this.provider,
    required this.path,
  });

  final SshFsProvider provider;
  final String path;

  @override
  State<FileEditorScreen> createState() => _FileEditorScreenState();
}

class _FileEditorScreenState extends State<FileEditorScreen> {
  _EditorScreenState _state = _EditorScreenState.loading;
  CodeLineEditingController? _controller;
  String _savedText = '';
  bool _dirty = false;
  bool _saving = false;
  String? _message;

  String get _fileName => PathUtils.posix.basename(widget.path);

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _controller?.removeListener(_onControllerChanged);
    _controller?.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _state = _EditorScreenState.loading;
      _message = null;
    });
    try {
      final content = await widget.provider.readFile(widget.path);
      final controller = content.size > asyncParseThresholdBytes
          ? CodeLineEditingController.fromTextAsync(content.content)
          : CodeLineEditingController.fromText(content.content);
      if (!mounted) {
        controller.dispose();
        return;
      }
      controller.addListener(_onControllerChanged);
      setState(() {
        _controller = controller;
        _savedText = content.content;
        _dirty = false;
        _state = _EditorScreenState.ready;
      });
    } on SshFsException catch (e) {
      if (!mounted) return;
      setState(() {
        if (e.code == SshFsErrorCode.tooLarge) {
          _state = _EditorScreenState.tooLarge;
          _message = e.size != null
              ? '${describeSshFsError(e)} для редактирования (${_formatSize(e.size!)})'
              : '${describeSshFsError(e)} для редактирования';
        } else {
          _state = _EditorScreenState.error;
          _message = describeSshFsError(e);
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _state = _EditorScreenState.error;
        _message = e.toString();
      });
    }
  }

  void _onControllerChanged() {
    final controller = _controller;
    if (controller == null) return;
    final dirty = controller.text != _savedText;
    if (dirty != _dirty) {
      setState(() => _dirty = dirty);
    }
  }

  Future<void> _save() async {
    final controller = _controller;
    if (controller == null || _saving) return;
    final text = controller.text;
    setState(() => _saving = true);
    try {
      await widget.provider.writeFile(widget.path, text);
      if (!mounted) return;
      setState(() {
        _savedText = text;
        _dirty = false;
        _saving = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      final message = error is SshFsException
          ? describeSshFsError(error)
          : error.toString();
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final palette = brightness == Brightness.dark
        ? EttyPalette.dark
        : EttyPalette.light;
    final colors = palette.editor;

    return Scaffold(
      appBar: AppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(child: Text(_fileName, overflow: TextOverflow.ellipsis)),
            if (_dirty)
              const Padding(
                padding: EdgeInsets.only(left: 6),
                child: Text('●', style: TextStyle(fontSize: 10)),
              ),
          ],
        ),
        actions: [
          if (_state == _EditorScreenState.ready)
            _saving
                ? const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 16),
                    child: SizedBox(
                      width: 20,
                      height: 20,
                      child: Center(
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ),
                  )
                : IconButton(
                    icon: const Icon(Icons.save),
                    tooltip: 'Сохранить',
                    onPressed: _dirty ? _save : null,
                  ),
        ],
      ),
      body: _buildBody(colors),
    );
  }

  Widget _buildBody(EditorColors colors) {
    switch (_state) {
      case _EditorScreenState.loading:
        return const Center(child: CircularProgressIndicator());
      case _EditorScreenState.tooLarge:
        return _MessageView(
          icon: Icons.insert_drive_file_outlined,
          message: _message ?? 'Файл слишком большой для редактирования',
        );
      case _EditorScreenState.error:
        return _MessageView(
          icon: Icons.error_outline,
          message: _message ?? 'Не удалось открыть файл',
        );
      case _EditorScreenState.ready:
        final controller = _controller!;
        return ColoredBox(
          color: colors.bg,
          child: CodeEditor(
            controller: controller,
            style: CodeEditorStyle(
              fontSize: 13,
              textColor: colors.text,
              backgroundColor: colors.bg,
              cursorColor: colors.cursor,
              cursorLineColor: colors.activeLine,
              selectionColor: colors.selection.withAlpha(90),
              codeTheme: codeHighlightThemeForPath(widget.path, colors),
            ),
            indicatorBuilder:
                (context, editingController, chunkController, notifier) =>
                    ColoredBox(
                      color: colors.gutterBg,
                      child: DefaultCodeLineNumber(
                        controller: editingController,
                        notifier: notifier,
                        textStyle: TextStyle(
                          color: colors.lineNumber,
                          fontSize: 13,
                        ),
                        focusedTextStyle: TextStyle(
                          color: colors.text,
                          fontSize: 13,
                        ),
                      ),
                    ),
          ),
        );
    }
  }
}

String _formatSize(int bytes) {
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  var size = bytes.toDouble();
  var unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  final digits = unitIndex == 0 || size >= 10 ? 0 : 1;
  return '${size.toStringAsFixed(digits)} ${units[unitIndex]}';
}

/// Экран-заглушка для состояний «файл слишком большой» / «ошибка чтения» — вместо пустого
/// редактора (брифинг задачи #27), с кнопкой «Назад».
class _MessageView extends StatelessWidget {
  const _MessageView({required this.icon, required this.message});

  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: Theme.of(context).colorScheme.error),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 20),
            OutlinedButton(
              onPressed: () => Navigator.of(context).maybePop(),
              child: const Text('Назад'),
            ),
          ],
        ),
      ),
    );
  }
}
