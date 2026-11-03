import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Текст из системного буфера обмена. `null` — буфер пуст, платформа вернула не текст или
/// чтение недоступно (ошибка платформенного канала глушится).
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
/// `true` — запись выполнена, `false` — платформа отказала (исключение поймано и залогировано,
/// не проброшено). Исключение не пробрасывается сознательно: буфер обмена — побочный эффект (в том
/// числе для `OSC 52` из TUI-приложения), из-за него не должны падать терминал и разбор вывода.
/// Вызывающая сторона сама решает, показывать ли пользователю, что копирование не удалось.
///
/// Возвращает `Future<bool>`, поэтому подходит как колбэк `void Function(String)` (например
/// `TabController.onClipboardWrite`): тип возврата при таком использовании отбрасывается.
Future<bool> writeSystemClipboard(String text) async {
  try {
    await Clipboard.setData(ClipboardData(text: text));
    return true;
  } on PlatformException catch (error) {
    debugPrint('[clipboard] не удалось записать в системный буфер: $error');
    return false;
  }
}
