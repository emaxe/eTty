import 'dart:io' show Platform;

import 'package:flutter/services.dart';

/// Мост к нативному Android foreground service (REQ-19) — единственная задача службы на той
/// стороне (`android/app/src/main/kotlin/com/etty/mobile/TerminalForegroundService.kt`): не дать
/// Android убить процесс, пока есть активное SSH-соединение и приложение свёрнуто (без FGS
/// Android агрессивно убивает background-процессы уже через секунды-минуты после сворачивания).
///
/// На iOS/остальных платформах — no-op: прямого аналога Android foreground service там нет,
/// REQ-19 ограничивает iOS-часть корректным detach/reattach-циклом
/// (`domain/lifecycle_controller.dart`, задача #28) — фоновый сокет там всё равно не переживёт
/// приостановку ОС, держать его искусственно означало бы полагаться на недокументированное
/// поведение и рисковать отклонением при ревью App Store (см. риск в `docs/plans/mob/plan.md`).
///
/// [supported] — переопределяемый шов для тестов (`Platform.isAndroid` нельзя подменить на
/// хосте, где реально гоняются тесты, — тот же приём, что [mobile.data.connection_store]'s
/// `SecureKeyValueStore`).
class ForegroundService {
  ForegroundService({bool? supported})
    : _supported = supported ?? Platform.isAndroid;

  static const MethodChannel _channel = MethodChannel(
    'com.etty.mobile/foreground_service',
  );

  final bool _supported;

  /// Стартует foreground-службу с постоянной нотификацией — вызывать, когда появляется первое
  /// активное SSH-соединение (см. `terminal_page.dart`, задача #29). Идемпотентно на стороне
  /// Android (`startService` на уже запущенный `Service` просто доставляет новый `onStartCommand`).
  Future<void> start() => _invoke('start');

  /// Останавливает службу — когда закрывается последнее SSH-соединение/страница терминала.
  Future<void> stop() => _invoke('stop');

  Future<void> _invoke(String method) async {
    if (!_supported) return;
    try {
      await _channel.invokeMethod<void>(method);
    } on PlatformException {
      // Best-effort: провал не должен ронять поток управления соединением — в худшем случае
      // Android получает меньше шансов не убить процесс в фоне, а не ошибку пользователю.
    }
  }
}
