import 'package:flutter/material.dart';
import 'package:xterm/xterm.dart' show TerminalTheme;

import 'package:mobile/app/theme/etty_colors.dart';

/// Строит `ThemeData`/`TerminalTheme` из [EttyPalette] (задача #20) — порт `src/renderer/themes.js`.
///
/// `fontFamily: 'Roboto'` без бандла файлов шрифта: на Android это системный шрифт ОС (бесплатно,
/// точное соответствие), на iOS при отсутствии `Roboto` среди установленных/забандленных шрифтов
/// Flutter молча откатывается на системный (San Francisco) — компромисс, принятый явно (см.
/// обсуждение задачи #20 в сессии планирования), а не недосмотр. Если понадобится байт-в-байт
/// Roboto на iOS — бандл `.ttf` в `assets/fonts` + запись в `pubspec.yaml`.
abstract final class EttyTheme {
  static const String fontFamily = 'Roboto';

  /// `ColorScheme`/`ThemeData` для `MaterialApp` — фирменные цвета (`accent`/`green`/`red`/
  /// `surface`/`text`) идут поверх материальной M3-палитры, сгенерированной из `accent`
  /// (`ColorScheme.fromSeed`): в палитре `themes.js` всего ~10 цветов, а M3 `ColorScheme` требует
  /// порядка 30 ролей — придумывать недостающие оттенки вручную избыточно, когда генератор делает
  /// это консистентно, а именованные роли ниже гарантируют совпадение с десктопом там, где это
  /// реально видно (фон, текст, акцент, успех/ошибка).
  static ThemeData themeData(EttyPalette palette) {
    final ui = palette.ui;
    final brightness = palette.name == EttyPalette.dark.name
        ? Brightness.dark
        : Brightness.light;

    final colorScheme =
        ColorScheme.fromSeed(
          seedColor: ui.accent,
          brightness: brightness,
        ).copyWith(
          primary: ui.accent,
          onPrimary: brightness == Brightness.dark
              ? Colors.black
              : Colors.white,
          secondary: ui.green,
          error: ui.red,
          surface: ui.bg,
          onSurface: ui.text,
          surfaceContainerHighest: ui.surface,
          outline: ui.border,
          outlineVariant: ui.border,
        );

    final base = ThemeData(
      colorScheme: colorScheme,
      useMaterial3: true,
      brightness: brightness,
    );

    return base.copyWith(
      scaffoldBackgroundColor: ui.bg,
      canvasColor: ui.bg,
      cardColor: ui.surface,
      dividerColor: ui.border,
      hoverColor: ui.hover,
      splashColor: ui.hover,
      highlightColor: ui.hover,
      disabledColor: ui.muted,
      textTheme: base.textTheme.apply(
        fontFamily: fontFamily,
        bodyColor: ui.text,
        displayColor: ui.text,
      ),
      appBarTheme: base.appBarTheme.copyWith(
        backgroundColor: ui.surface,
        foregroundColor: ui.text,
      ),
    );
  }

  /// `xterm.TerminalTheme` для `TerminalView` (задача #22). `searchHitBackground*`/
  /// `searchHitForeground` не существуют в `themes.js` (десктоп ищет по терминалу иначе, не через
  /// `xterm.js`-подсветку) — берём дефолты самого пакета `xterm` (`TerminalThemes.defaultTheme`),
  /// фиксированные для обеих тем: акцентная жёлтая/зелёная подсветка совместе.
  static TerminalTheme terminalTheme(EttyPalette palette) {
    final t = palette.terminal;
    return TerminalTheme(
      cursor: t.cursor,
      selection: t.selectionBackground,
      foreground: t.foreground,
      background: t.background,
      black: t.black,
      red: t.red,
      green: t.green,
      yellow: t.yellow,
      blue: t.blue,
      magenta: t.magenta,
      cyan: t.cyan,
      white: t.white,
      brightBlack: t.brightBlack,
      brightRed: t.brightRed,
      brightGreen: t.brightGreen,
      brightYellow: t.brightYellow,
      brightBlue: t.brightBlue,
      brightMagenta: t.brightMagenta,
      brightCyan: t.brightCyan,
      brightWhite: t.brightWhite,
      searchHitBackground: const Color(0xFFFFFF2B),
      searchHitBackgroundCurrent: const Color(0xFF31FF26),
      searchHitForeground: const Color(0xFF000000),
    );
  }
}
