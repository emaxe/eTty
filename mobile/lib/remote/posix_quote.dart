/// Экранирование для L1-уровня генератора remote-команды (`remote_shell_hooks.dart`) — порт
/// `posixDquote()` из `src/main/ssh/remote-shell-hooks.js`.
///
/// Это НЕ то же самое, что квотирование argv-токенов при сборке exec-команды для транспорта
/// (`posixQuote()` из `src/main/ssh/ssh-control-channel.js` — полное экранирование одинарными
/// кавычками одного argv-элемента). Та функция портируется отдельно в `transport/remote_exec.dart`
/// (задачи #12/#27), когда появится сам транспортный слой — не путать эти два разных механизма
/// цитирования при аудите.
///
/// Экранирует произвольную строку для встраивания как один double-quoted аргумент L1
/// (см. докстринг модуля `remote_shell_hooks.dart` про уровни L0/L1/L2).
String posixDquote(String str) {
  return str
      .replaceAll(r'\', r'\\')
      .replaceAll('"', r'\"')
      .replaceAll(r'$', r'\$')
      .replaceAll('`', r'\`');
}
