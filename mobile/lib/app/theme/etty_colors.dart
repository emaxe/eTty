import 'package:flutter/widgets.dart';

/// Палитры UI/терминала/редактора — порт `src/renderer/themes.js` (`THEMES.dark`/`THEMES.light`)
/// десктопного eTty. Значения — те же HEX, что в JS-источнике; расхождение здесь означало бы
/// расхождение внешнего вида между десктопом и мобилкой (задача #20, REQ «визуальная сверка с
/// десктопом»). Не золотой фикстурой (в отличие от `remote/*`) — цвета не участвуют в протоколе,
/// сверка ручная/визуальная, не автоматический golden-тест.
class UiColors {
  const UiColors({
    required this.bg,
    required this.surface,
    required this.border,
    required this.muted,
    required this.text,
    required this.subtext,
    required this.accent,
    required this.green,
    required this.red,
    required this.hover,
  });

  final Color bg;
  final Color surface;
  final Color border;
  final Color muted;
  final Color text;
  final Color subtext;
  final Color accent;
  final Color green;
  final Color red;
  final Color hover;
}

/// Палитра терминала — поля 1:1 с ключами `THEMES.*.terminal` на десктопе (`selectionBackground`
/// оставлено под тем же именем, а не переименовано в `selection`, чтобы искать по исходнику было
/// проще; маппинг на `xterm.TerminalTheme.selection` — в `etty_theme.dart`).
class TerminalColors {
  const TerminalColors({
    required this.background,
    required this.foreground,
    required this.cursor,
    required this.selectionBackground,
    required this.black,
    required this.red,
    required this.green,
    required this.yellow,
    required this.blue,
    required this.magenta,
    required this.cyan,
    required this.white,
    required this.brightBlack,
    required this.brightRed,
    required this.brightGreen,
    required this.brightYellow,
    required this.brightBlue,
    required this.brightMagenta,
    required this.brightCyan,
    required this.brightWhite,
  });

  final Color background;
  final Color foreground;
  final Color cursor;
  final Color selectionBackground;
  final Color black;
  final Color red;
  final Color green;
  final Color yellow;
  final Color blue;
  final Color magenta;
  final Color cyan;
  final Color white;
  final Color brightBlack;
  final Color brightRed;
  final Color brightGreen;
  final Color brightYellow;
  final Color brightBlue;
  final Color brightMagenta;
  final Color brightCyan;
  final Color brightWhite;
}

/// Палитра подсветки синтаксиса редактора — понадобится `re_highlight`/`re_editor` (задача #27);
/// портируется уже сейчас вместе с остальным `themes.js`, чтобы не читать источник дважды.
/// `activeLineBg` — `rgba(...)` на десктопе (полупрозрачная заливка активной строки поверх `bg`,
/// а не отдельный непрозрачный цвет) — сохранено как `Color` с альфой, а не как `activeLine`
/// (сплошной цвет, тоже присутствующий в источнике для мест без поддержки альфы).
class EditorColors {
  const EditorColors({
    required this.bg,
    required this.text,
    required this.gutterBg,
    required this.lineNumber,
    required this.activeLine,
    required this.activeLineBg,
    required this.selection,
    required this.selectionBorder,
    required this.cursor,
    required this.keyword,
    required this.string,
    required this.number,
    required this.comment,
    required this.function,
    required this.type,
    required this.variable,
    required this.operator,
    required this.property,
    required this.tag,
    required this.attribute,
    required this.bracket,
  });

  final Color bg;
  final Color text;
  final Color gutterBg;
  final Color lineNumber;
  final Color activeLine;
  final Color activeLineBg;
  final Color selection;
  final Color selectionBorder;
  final Color cursor;
  final Color keyword;
  final Color string;
  final Color number;
  final Color comment;
  final Color function;
  final Color type;
  final Color variable;
  final Color operator;
  final Color property;
  final Color tag;
  final Color attribute;
  final Color bracket;
}

/// Одна именованная тема (`THEMES.dark`/`THEMES.light` целиком).
class EttyPalette {
  const EttyPalette({
    required this.name,
    required this.ui,
    required this.terminal,
    required this.editor,
  });

  final String name;
  final UiColors ui;
  final TerminalColors terminal;
  final EditorColors editor;

  static const dark = EttyPalette(
    name: 'Dark',
    ui: UiColors(
      bg: Color(0xFF1E1E1E),
      surface: Color(0xFF141414),
      border: Color(0xFF2D2D2D),
      muted: Color(0xFF666666),
      text: Color(0xFFD4D4D4),
      subtext: Color(0xFFA0A0A0),
      accent: Color(0xFF569CD6),
      green: Color(0xFF4EC9B0),
      red: Color(0xFFF14C4C),
      hover: Color(0xFF2A2D2E),
    ),
    terminal: TerminalColors(
      background: Color(0xFF1E1E1E),
      foreground: Color(0xFFD4D4D4),
      cursor: Color(0xFFD4D4D4),
      selectionBackground: Color(0xFF264F78),
      black: Color(0xFF000000),
      red: Color(0xFFCD3131),
      green: Color(0xFF0DBC79),
      yellow: Color(0xFFE5E510),
      blue: Color(0xFF2472C8),
      magenta: Color(0xFFBC3FBC),
      cyan: Color(0xFF11A8CD),
      white: Color(0xFFE5E5E5),
      brightBlack: Color(0xFF666666),
      brightRed: Color(0xFFF14C4C),
      brightGreen: Color(0xFF23D18B),
      brightYellow: Color(0xFFF5F543),
      brightBlue: Color(0xFF3B8EEA),
      brightMagenta: Color(0xFFD670D6),
      brightCyan: Color(0xFF29B8DB),
      brightWhite: Color(0xFFE5E5E5),
    ),
    editor: EditorColors(
      bg: Color(0xFF1E1E1E),
      text: Color(0xFFD4D4D4),
      gutterBg: Color(0xFF141414),
      lineNumber: Color(0xFF6E7681),
      activeLine: Color(0xFF2C2C2C),
      activeLineBg: Color(0x0FFFFFFF), // rgba(255,255,255,0.06)
      selection: Color(0xFF60A5FA),
      selectionBorder: Color(0xFF93C5FD),
      cursor: Color(0xFFD4D4D4),
      keyword: Color(0xFF569CD6),
      string: Color(0xFFCE9178),
      number: Color(0xFFB5CEA8),
      comment: Color(0xFF6A9955),
      function: Color(0xFFDCDCAA),
      type: Color(0xFF4EC9B0),
      variable: Color(0xFF9CDCFE),
      operator: Color(0xFFD4D4D4),
      property: Color(0xFF9CDCFE),
      tag: Color(0xFF569CD6),
      attribute: Color(0xFF9CDCFE),
      bracket: Color(0xFFFFD700),
    ),
  );

  static const light = EttyPalette(
    name: 'Light',
    ui: UiColors(
      bg: Color(0xFFFFFFFF),
      surface: Color(0xFFF5F5F5),
      border: Color(0xFFE0E0E0),
      muted: Color(0xFF888888),
      text: Color(0xFF333333),
      subtext: Color(0xFF666666),
      accent: Color(0xFF007ACC),
      green: Color(0xFF008000),
      red: Color(0xFFC00000),
      hover: Color(0xFFE8E8E8),
    ),
    terminal: TerminalColors(
      background: Color(0xFFFFFFFF),
      foreground: Color(0xFF333333),
      cursor: Color(0xFF333333),
      selectionBackground: Color(0xFFADD6FF),
      black: Color(0xFF000000),
      red: Color(0xFFCD3131),
      green: Color(0xFF00BC00),
      yellow: Color(0xFF949800),
      blue: Color(0xFF0451A5),
      magenta: Color(0xFFBC05BC),
      cyan: Color(0xFF0598BC),
      white: Color(0xFF555555),
      brightBlack: Color(0xFF666666),
      brightRed: Color(0xFFCD3131),
      brightGreen: Color(0xFF14CE14),
      brightYellow: Color(0xFFB5BA00),
      brightBlue: Color(0xFF0451A5),
      brightMagenta: Color(0xFFBC05BC),
      brightCyan: Color(0xFF0598BC),
      brightWhite: Color(0xFFA5A5A5),
    ),
    editor: EditorColors(
      bg: Color(0xFFFFFFFF),
      text: Color(0xFF333333),
      gutterBg: Color(0xFFF5F5F5),
      lineNumber: Color(0xFF888888),
      activeLine: Color(0xFFF5F5F5),
      activeLineBg: Color(0x0A000000), // rgba(0,0,0,0.04)
      selection: Color(0xFF90BAFF),
      selectionBorder: Color(0xFF5B9CF7),
      cursor: Color(0xFF333333),
      keyword: Color(0xFF0000FF),
      string: Color(0xFFA31515),
      number: Color(0xFF098658),
      comment: Color(0xFF008000),
      function: Color(0xFF795E26),
      type: Color(0xFF267F99),
      variable: Color(0xFF001080),
      operator: Color(0xFF333333),
      property: Color(0xFF001080),
      tag: Color(0xFF0000FF),
      attribute: Color(0xFF001080),
      bracket: Color(0xFF000000),
    ),
  );
}
