import 'package:flutter/painting.dart';
import 'package:re_editor/re_editor.dart';
import 'package:re_highlight/re_highlight.dart';
import 'package:re_highlight/languages/bash.dart';
import 'package:re_highlight/languages/dart.dart';
import 'package:re_highlight/languages/javascript.dart';
import 'package:re_highlight/languages/json.dart';
import 'package:re_highlight/languages/markdown.dart';
import 'package:re_highlight/languages/python.dart';
import 'package:re_highlight/languages/typescript.dart';
import 'package:re_highlight/languages/yaml.dart';

import 'package:mobile/app/theme/etty_colors.dart';
import 'package:mobile/core/config/path_utils.dart';

/// Расширение файла (без точки, в нижнем регистре) -> (имя языка `re_highlight`, правило
/// [Mode]) — минимальный набор из брифа задачи #27. Расширение не из этой таблицы — обычный
/// текст без подсветки (см. [codeHighlightThemeForPath]).
final Map<String, (String, Mode)> _languageByExtension = {
  'dart': ('dart', langDart),
  'js': ('javascript', langJavascript),
  'jsx': ('javascript', langJavascript),
  'mjs': ('javascript', langJavascript),
  'cjs': ('javascript', langJavascript),
  'ts': ('typescript', langTypescript),
  'tsx': ('typescript', langTypescript),
  'py': ('python', langPython),
  'sh': ('bash', langBash),
  'bash': ('bash', langBash),
  'json': ('json', langJson),
  'yaml': ('yaml', langYaml),
  'yml': ('yaml', langYaml),
  'md': ('markdown', langMarkdown),
  'markdown': ('markdown', langMarkdown),
};

/// Тема подсветки для [path] на основе палитры [colors] — `null`, если расширение файла не
/// распознано (`CodeEditorStyle.codeTheme: null` в `re_editor` означает «без подсветки», не
/// ошибку, см. `_CodeHighlightEngine.theme` в исходниках пакета).
///
/// В `languages` кладём РОВНО одну запись: при единственном языке `_CodeHighlightEngine`
/// использует его напрямую (`highlight(language: ...)`), а не эвристику `highlightAuto` —
/// это и есть механизм принудительного выбора языка по расширению в API пакета.
CodeHighlightTheme? codeHighlightThemeForPath(
  String path,
  EditorColors colors,
) {
  final ext = PathUtils.posix.extname(path);
  if (ext.isEmpty) return null;
  final entry = _languageByExtension[ext.substring(1).toLowerCase()];
  if (entry == null) return null;
  final (name, mode) = entry;
  return CodeHighlightTheme(
    languages: {name: mode.themeMode},
    theme: _highlightStyles(colors),
  );
}

/// Маппинг [EditorColors] (портированная палитра подсветки из `themes.js`, см.
/// `mobile/lib/app/theme/etty_colors.dart`) на ключи стилей `re_highlight` (классы hljs,
/// см. `re_highlight/styles/*.dart` для образца полного набора ключей). Ключ не найденный в
/// этой карте не подсвечивается отдельным цветом — `_CodeHighlighter._findStyle` в этом случае
/// откатывается на базовый `textColor` редактора, что достаточно для неохваченных классов.
Map<String, TextStyle> _highlightStyles(EditorColors c) => {
  'root': TextStyle(color: c.text, backgroundColor: c.bg),
  'comment': TextStyle(color: c.comment),
  'quote': TextStyle(color: c.comment),
  'doctag': TextStyle(color: c.comment),
  'keyword': TextStyle(color: c.keyword),
  'meta-keyword': TextStyle(color: c.keyword),
  'string': TextStyle(color: c.string),
  'regexp': TextStyle(color: c.string),
  'addition': TextStyle(color: c.string),
  'meta-string': TextStyle(color: c.string),
  'template-tag': TextStyle(color: c.string),
  'number': TextStyle(color: c.number),
  'literal': TextStyle(color: c.number),
  'title.function': TextStyle(color: c.function),
  'built_in': TextStyle(color: c.function),
  'title.class': TextStyle(color: c.type),
  'class-title': TextStyle(color: c.type),
  'type': TextStyle(color: c.type),
  'selector-class': TextStyle(color: c.type),
  'selector-id': TextStyle(color: c.type),
  'variable': TextStyle(color: c.variable),
  'template-variable': TextStyle(color: c.variable),
  'operator': TextStyle(color: c.operator),
  'symbol': TextStyle(color: c.operator),
  'attr': TextStyle(color: c.property),
  'attribute': TextStyle(color: c.attribute),
  'selector-attr': TextStyle(color: c.attribute),
  'tag-attr': TextStyle(color: c.attribute),
  'tag': TextStyle(color: c.tag),
  'tag-name': TextStyle(color: c.tag),
  'name': TextStyle(color: c.tag),
  'selector-tag': TextStyle(color: c.tag),
  'section': TextStyle(color: c.tag),
  'punctuation': TextStyle(color: c.bracket),
  'emphasis': const TextStyle(fontStyle: FontStyle.italic),
  'strong': const TextStyle(fontWeight: FontWeight.bold),
};
