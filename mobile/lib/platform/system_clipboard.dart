import 'package:flutter/services.dart';

/// Текст из системного буфера обмена. `null` — буфер пуст, платформа вернула не текст или
/// чтение недоступно (см. докстринг [writeSystemClipboard]).
Future<String?> readSystemClipboard() async {
  try {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    return data?.text;
  } on PlatformException {
    return null;
  }
}

/// Пишет текст в системный буфер обмена (`kTextPlain`); пустая строка очищает буфер.
///
/// Ошибки платформенного канала сознательно глушатся: буфер обмена — побочный эффект (в том числе
/// для `OSC 52` из TUI-приложения), из-за него не должны падать терминал и разбор вывода.
///
/// Возвращает `Future<void>`, поэтому подходит как колбэк `void Function(String)` (например
/// `TabController.onClipboardWrite`).
Future<void> writeSystemClipboard(String text) async {
  try {
    await Clipboard.setData(ClipboardData(text: text));
  } on PlatformException {
    // Игнор — см. докстринг: буфер обмена не повод ломать вкладку.
  }
}
