import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/theme/etty_colors.dart';
import 'package:mobile/app/theme/etty_theme.dart';

void main() {
  group('EttyTheme.themeData', () {
    test(
      'dark: фон/текст/акцент/успех/ошибка совпадают с EttyPalette.dark.ui',
      () {
        final theme = EttyTheme.themeData(EttyPalette.dark);
        final ui = EttyPalette.dark.ui;

        expect(theme.scaffoldBackgroundColor, ui.bg);
        expect(theme.colorScheme.surface, ui.bg);
        expect(theme.colorScheme.onSurface, ui.text);
        expect(theme.colorScheme.primary, ui.accent);
        expect(theme.colorScheme.secondary, ui.green);
        expect(theme.colorScheme.error, ui.red);
        expect(theme.dividerColor, ui.border);
        expect(theme.hoverColor, ui.hover);
        expect(theme.disabledColor, ui.muted);
        expect(theme.brightness, Brightness.dark);
      },
    );

    test(
      'light: фон/текст/акцент/успех/ошибка совпадают с EttyPalette.light.ui',
      () {
        final theme = EttyTheme.themeData(EttyPalette.light);
        final ui = EttyPalette.light.ui;

        expect(theme.scaffoldBackgroundColor, ui.bg);
        expect(theme.colorScheme.surface, ui.bg);
        expect(theme.colorScheme.onSurface, ui.text);
        expect(theme.colorScheme.primary, ui.accent);
        expect(theme.colorScheme.secondary, ui.green);
        expect(theme.colorScheme.error, ui.red);
        expect(theme.brightness, Brightness.light);
      },
    );

    test('textTheme использует шрифт Roboto', () {
      final theme = EttyTheme.themeData(EttyPalette.dark);
      expect(theme.textTheme.bodyMedium?.fontFamily, 'Roboto');
      expect(theme.textTheme.bodyMedium?.color, EttyPalette.dark.ui.text);
    });

    test('appBarTheme использует surface/text из палитры', () {
      final theme = EttyTheme.themeData(EttyPalette.light);
      expect(theme.appBarTheme.backgroundColor, EttyPalette.light.ui.surface);
      expect(theme.appBarTheme.foregroundColor, EttyPalette.light.ui.text);
    });
  });

  group('EttyTheme.terminalTheme', () {
    test(
      'dark: базовые и яркие ANSI-цвета совпадают с EttyPalette.dark.terminal',
      () {
        final t = EttyTheme.terminalTheme(EttyPalette.dark);
        final src = EttyPalette.dark.terminal;

        expect(t.background, src.background);
        expect(t.foreground, src.foreground);
        expect(t.cursor, src.cursor);
        expect(t.selection, src.selectionBackground);
        expect(t.black, src.black);
        expect(t.red, src.red);
        expect(t.green, src.green);
        expect(t.yellow, src.yellow);
        expect(t.blue, src.blue);
        expect(t.magenta, src.magenta);
        expect(t.cyan, src.cyan);
        expect(t.white, src.white);
        expect(t.brightBlack, src.brightBlack);
        expect(t.brightRed, src.brightRed);
        expect(t.brightGreen, src.brightGreen);
        expect(t.brightYellow, src.brightYellow);
        expect(t.brightBlue, src.brightBlue);
        expect(t.brightMagenta, src.brightMagenta);
        expect(t.brightCyan, src.brightCyan);
        expect(t.brightWhite, src.brightWhite);
      },
    );

    test(
      'light: базовые ANSI-цвета совпадают с EttyPalette.light.terminal',
      () {
        final t = EttyTheme.terminalTheme(EttyPalette.light);
        final src = EttyPalette.light.terminal;

        expect(t.background, src.background);
        expect(t.foreground, src.foreground);
        expect(t.selection, src.selectionBackground);
        expect(t.green, src.green);
        expect(t.red, src.red);
      },
    );
  });

  group('EttyPalette — данные из themes.js (src/renderer/themes.js)', () {
    test('dark.ui.accent/green/red — те же HEX, что на десктопе', () {
      expect(EttyPalette.dark.ui.accent.toARGB32(), 0xFF569CD6);
      expect(EttyPalette.dark.ui.green.toARGB32(), 0xFF4EC9B0);
      expect(EttyPalette.dark.ui.red.toARGB32(), 0xFFF14C4C);
    });

    test('light.ui.accent/green/red — те же HEX, что на десктопе', () {
      expect(EttyPalette.light.ui.accent.toARGB32(), 0xFF007ACC);
      expect(EttyPalette.light.ui.green.toARGB32(), 0xFF008000);
      expect(EttyPalette.light.ui.red.toARGB32(), 0xFFC00000);
    });

    test('dark.editor.activeLineBg — альфа из rgba(255,255,255,0.06)', () {
      expect(EttyPalette.dark.editor.activeLineBg.toARGB32(), 0x0FFFFFFF);
    });

    test('light.editor.activeLineBg — альфа из rgba(0,0,0,0.04)', () {
      expect(EttyPalette.light.editor.activeLineBg.toARGB32(), 0x0A000000);
    });
  });
}
