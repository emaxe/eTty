import 'dart:convert';

import 'package:mobile/core/config/quick_actions_config.dart';

String encodeQuickActions(List<QuickAction> actions) =>
    jsonEncode([for (final a in actions) a.toJson()]);

/// `null` — JSON битый или структура неверна: вызывающая сторона берёт умолчания. Лишние
/// действия сверх [QuickActionsConfig.maxActions] отбрасываются.
List<QuickAction>? decodeQuickActions(String? json) {
  if (json == null || json.isEmpty) return null;
  try {
    final raw = jsonDecode(json);
    if (raw is! List) return null;
    final actions = <QuickAction>[];
    for (final a in raw.take(QuickActionsConfig.maxActions)) {
      if (a is! Map) return null;
      final id = a['id'];
      final label = a['label'];
      final kindName = a['kind'];
      final data = a['data'];
      if (id is! String || label is! String || kindName is! String || data is! String) {
        return null;
      }
      final kind = QuickActionKind.values.where((k) => k.name == kindName).firstOrNull;
      if (kind == null) return null;
      actions.add(QuickAction(id: id, label: label, data: data, kind: kind));
    }
    return actions;
  } on FormatException {
    return null;
  }
}

/// Запись клавиши -> сырые байты: `^X` (Ctrl+буква), `\e`, `\r`, `\n`, `\t`, `\xHH`, `\\`, `\^`.
/// `null` — пустая запись или неверная управляющая последовательность.
String? parseKeySequence(String input) {
  if (input.isEmpty) return null;
  final out = StringBuffer();
  var i = 0;
  while (i < input.length) {
    final ch = input[i];
    if (ch == '^') {
      if (i + 1 >= input.length) return null;
      final c = input[i + 1].toUpperCase().codeUnitAt(0);
      if (c < 0x40 || c > 0x5f) return null; // @ A-Z [ \ ] ^ _
      out.writeCharCode(c - 0x40);
      i += 2;
    } else if (ch == '\\') {
      if (i + 1 >= input.length) return null;
      final n = input[i + 1];
      switch (n) {
        case 'e':
          out.write('\x1b');
        case 'r':
          out.write('\r');
        case 'n':
          out.write('\n');
        case 't':
          out.write('\t');
        case '\\':
          out.write('\\');
        case '^':
          out.write('^');
        case 'x':
          if (i + 4 > input.length) return null;
          final v = int.tryParse(input.substring(i + 2, i + 4), radix: 16);
          if (v == null) return null;
          out.writeCharCode(v);
          i += 2;
        default:
          return null;
      }
      i += 2;
    } else {
      out.write(ch);
      i++;
    }
  }
  return out.toString();
}

/// Обратное к [parseKeySequence]: управляющие символы -> читаемая запись.
String formatKeySequence(String data) {
  final out = StringBuffer();
  for (final r in data.runes) {
    switch (r) {
      case 0x1b:
        out.write(r'\e');
      case 0x0d:
        out.write(r'\r');
      case 0x0a:
        out.write(r'\n');
      case 0x09:
        out.write(r'\t');
      case 0x5c:
        out.write(r'\\');
      case 0x5e:
        out.write(r'\^');
      default:
        if (r >= 1 && r <= 0x1f) {
          out.write('^${String.fromCharCode(r + 0x40)}');
        } else if (r == 0x7f) {
          out.write(r'\x7f');
        } else {
          out.writeCharCode(r);
        }
    }
  }
  return out.toString();
}
