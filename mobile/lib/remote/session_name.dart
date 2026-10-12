import 'package:mobile/core/config/ssh_session_config.dart';

/// Имена tmux-сессий — порт `src/shared/ssh-session-name.js` десктопного eTty. Сверяется
/// golden-тестом против `mobile/test/fixtures/remote/session-names.json` (REQ-1,
/// `docs/plans/mob/plan.md`): десктоп и мобилка обязаны выбирать одно и то же имя сессии для
/// одного и того же `connectionId`, иначе повторное подключение не найдёт уже существующую
/// (созданную с другого клиента) tmux-сессию.

/// Базовое имя tmux-сессии для подключения — детерминировано от `connectionId`, чтобы повторное
/// открытие того же подключения находило ту же (уже существующую) сессию вместо создания новой.
String buildSessionNameBase(String connectionId) {
  final cleaned = connectionId.replaceAll(RegExp(r'[^A-Za-z0-9]'), '');
  final truncated = cleaned.length > 8 ? cleaned.substring(0, 8) : cleaned;
  return 'etty-$truncated';
}

/// Первое свободное имя сессии вида `<base>`, `<base>-2`, `<base>-3`, … — свободное значит: не
/// входит в [takenNames] (объединение сессий на сервере и `sessionName` открытых вкладок).
/// Результат ГАРАНТИРОВАННО проходит [SshSessionConfig.sessionNameRe] и не превышает лимит длины
/// (64 символа) — обрезает `base`, если суффикс не влезает, а не сам суффикс.
String pickFreeSessionName(String base, [Iterable<String> takenNames = const []]) {
  final taken = takenNames.toSet();
  if (!taken.contains(base)) return base;

  final maxLenMatch = RegExp(r'\{1,(\d+)\}').firstMatch(SshSessionConfig.sessionNameRe.pattern);
  final limit = maxLenMatch != null ? int.parse(maxLenMatch.group(1)!) : 64;

  for (var n = 2; n < 10000; n++) {
    final suffix = '-$n';
    final candidate = base.length + suffix.length > limit
        ? base.substring(0, limit - suffix.length) + suffix
        : base + suffix;
    if (!taken.contains(candidate)) return candidate;
  }

  // Практически недостижимо (10000 занятых имён на одно подключение) — но функция обязана
  // вернуть что-то валидное, а не зависнуть.
  final epoch36 = DateTime.now().millisecondsSinceEpoch.toRadixString(36);
  final tail = epoch36.length > 5 ? epoch36.substring(epoch36.length - 5) : epoch36;
  return '${base.substring(0, limit - 6)}-$tail';
}
