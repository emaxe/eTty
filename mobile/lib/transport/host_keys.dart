// TOFU (trust-on-first-use) верификация host key — порт того, что на десктопе делает OpenSSH
// через системный known_hosts (REQ-8, docs/plans/mob/plan.md). В dartssh2 эта ответственность
// лежит на приложении: подтверждено спайком S3 (см. plan.md, «Результаты спайков») —
// SSHHostkeyVerifyHandler асинхронна (FutureOr<bool>), можно await настоящий UI-диалог прямо
// внутри колбэка; fingerprint уже приходит в формате OpenSSH SHA256:<base64 без паддинга> —
// свой хешинг не нужен.

import 'dart:convert';
import 'dart:typed_data';

import 'package:mobile/data/known_hosts_store.dart';

/// Итог сравнения предъявленного ключа с известными.
enum HostKeyVerdict {
  /// Ключа с таким `(host, port, keyType)` ещё не было — решение отдаётся [TrustNewHostKeyPrompt].
  newHost,

  /// Ключ совпал с уже сохранённым — подключение продолжается без вопросов.
  matched,

  /// Ключ ИЗМЕНИЛСЯ относительно сохранённого — возможный MITM. [HostKeyVerifier.call] в этом
  /// случае ВСЕГДА возвращает `false`, [TrustNewHostKeyPrompt] не вызывается: снять блокировку
  /// можно только явным действием в Настройках → Известные ключи (удалить старую запись), не
  /// кнопкой в диалоге подключения.
  mismatched,
}

/// Результат разбора одной проверки — передаётся в [TrustNewHostKeyPrompt] для кейса [newHost],
/// и достаточен, чтобы UI показал текст предупреждения для [mismatched] (даже раз решение там не
/// спрашивается этим колбэком).
class HostKeyCheckResult {
  const HostKeyCheckResult({
    required this.verdict,
    required this.host,
    required this.port,
    required this.keyType,
    required this.fingerprint,
    this.previousFingerprint,
  });

  final HostKeyVerdict verdict;
  final String host;
  final int port;
  final String keyType;
  final String fingerprint;

  /// Заполнен только при [HostKeyVerdict.mismatched] — что было сохранено раньше.
  final String? previousFingerprint;
}

/// UI-колбэк: показать пользователю отпечаток НОВОГО (ещё не виденного) ключа и вернуть решение
/// «доверять и запомнить» (`true`) / «отмена» (`false`). Никогда не вызывается для
/// [HostKeyVerdict.mismatched] — см. докстринг [HostKeyVerdict.mismatched].
typedef TrustNewHostKeyPrompt = Future<bool> Function(HostKeyCheckResult result);

/// Верификатор одного подключения `(host, port)` — экземпляр создаётся на каждое подключение
/// (не переиспользуется между хостами), совместим по сигнатуре вызова с
/// `SSHHostkeyVerifyHandler` из `dartssh2` (передаётся как `onVerifyHostKey:` в `SSHClient`,
/// см. `transport/ssh_connection.dart`, задача #11).
class HostKeyVerifier {
  HostKeyVerifier({
    required this.store,
    required this.host,
    required this.port,
    required this.onNewHostKey,
  });

  final KnownHostsStore store;
  final String host;
  final int port;
  final TrustNewHostKeyPrompt onNewHostKey;

  /// Совместима с сигнатурой `SSHHostkeyVerifyHandler` из dartssh2 (async, возвращает bool,
  /// принимает тип ключа и отпечаток байтами). `fingerprintBytes` — уже готовая UTF-8-строка
  /// вида `SHA256:...` в виде байт (так отдаёт dartssh2), декодируется здесь для сравнения со
  /// строковым представлением в хранилище.
  Future<bool> call(String type, Uint8List fingerprintBytes) async {
    final fingerprint = utf8.decode(fingerprintBytes);
    final existing = await store.find(host, port, type);

    if (existing == null) {
      final result = HostKeyCheckResult(
        verdict: HostKeyVerdict.newHost,
        host: host,
        port: port,
        keyType: type,
        fingerprint: fingerprint,
      );
      final trust = await onNewHostKey(result);
      if (trust) {
        final now = DateTime.now();
        await store.upsert(KnownHostEntry(
          host: host,
          port: port,
          keyType: type,
          fingerprint: fingerprint,
          addedAt: now,
          lastSeenAt: now,
        ));
      }
      return trust;
    }

    if (existing.fingerprint == fingerprint) {
      await store.upsert(existing.copyWith(lastSeenAt: DateTime.now()));
      return true;
    }

    // Несовпадение — жёсткая блокировка без вопроса пользователю здесь.
    return false;
  }
}
