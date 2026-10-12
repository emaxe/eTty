import 'dart:convert';
import 'dart:io';

/// Читает и парсит JSON golden-фикстуру из `mobile/test/fixtures/remote/<relPath>`.
///
/// Фикстуры генерируются из десктопного JS-кода (`node scripts/gen-remote-fixtures.mjs` из
/// корня репозитория, см. `docs/plans/mob/plan.md`, раздел «Golden-тесты») — не редактировать
/// файлы в `fixtures/` вручную, при расхождении перегенерировать генератором.
dynamic loadFixtureJson(String relPath) {
  final file = File('test/fixtures/remote/$relPath');
  return jsonDecode(file.readAsStringSync());
}

/// Читает фикстуру как сырой текст (для `init-command/<case>.txt` — многострочный shell-текст).
String loadFixtureText(String relPath) {
  return File('test/fixtures/remote/$relPath').readAsStringSync();
}
