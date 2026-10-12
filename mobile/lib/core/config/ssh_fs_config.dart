/// Константы транспорта удалённой ФС по SSH — порт `src/shared/ssh-fs-config.js` десктопного
/// eTty. Сверяется golden-тестом против `mobile/test/fixtures/remote/config.json`
/// (см. `ssh_session_config.dart` — тот же принцип синхронизации).
abstract final class SshFsConfig {
  /// Интервал опроса при ожидании готовности соединения (пароль/2FA может вводиться долго).
  static const int masterCheckIntervalMs = 750;
  static const int masterWaitMaxMs = 5 * 60 * 1000;

  /// Кэш «соединение живо» между служебными exec-вызовами.
  static const int masterAliveCacheMs = 2000;

  /// sshd `MaxSessions` по умолчанию — 10; без лимита параллельные операции дерева файлов
  /// (раскрытие нескольких папок разом) упрутся в «administratively prohibited». На мобилке
  /// делится с shell-каналами одного `SSHClient` (см. риск R7/спайк S6 в `docs/plans/mob/plan.md`) —
  /// это стартовое значение статического лимита, транспортный слой может его урезать динамически.
  static const int maxConcurrentExec = 4;

  /// Таймауты служебных non-interactive вызовов (readDir/rename/move/...).
  static const int opTimeoutMs = 15 * 1000;

  /// Чтение/запись файлов — отдельный, больший таймаут (сетевая передача содержимого).
  static const int ioTimeoutMs = 60 * 1000;
  static const int probeTimeoutMs = 20 * 1000;

  /// Защита от нечитаемо большого stdout/stderr одного exec-вызова.
  static const int maxExecBufferBytes = 8 * 1024 * 1024;

  /// Polling раскрытых каталогов взамен `fs.watch` (недоступен по SSH).
  static const int pollIntervalMs = 3000;
  static const int pollMaxDirs = 40;

  /// Максимум путей в одном exec-вызове для batch-операций (rename/copy/move/delete) — защита от
  /// превышения `ARG_MAX`. Порт `BATCH_SIZE` из `src/main/fs/ssh-fs-provider.js:14` — десктоп НЕ
  /// экспортирует эту константу, значение дублируется вручную; при изменении на десктопе нужно
  /// синхронизировать здесь и в `scripts/gen-remote-fixtures.mjs` (см. риск R10 в plan.md).
  static const int batchSize = 150;
}
