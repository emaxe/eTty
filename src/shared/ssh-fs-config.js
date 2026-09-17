/**
 * Константы транспорта удалённой ФС по SSH (ControlMaster-канал, polling-watcher).
 * Отдельно от `renderer/core/config/app-config.js` — та не видна main-процессу,
 * а эти значения используются в main (ssh-control-channel.js, ssh-fs-provider.js).
 */

export const SSH_FS_CONFIG = Object.freeze({
  // ssh -O check — интервал опроса при ожидании поднятия ControlMaster (пароль/2FA может
  // вводиться долго) и предохранитель на случай, если пользователь так и не подключится
  MASTER_CHECK_INTERVAL_MS: 750,
  MASTER_WAIT_MAX_MS: 5 * 60 * 1000,

  // Кэш «мастер жив» между служебными вызовами exec()
  MASTER_ALIVE_CACHE_MS: 2000,

  // sshd MaxSessions по умолчанию — 10; без лимита параллельные операции дерева
  // (раскрытие нескольких папок разом) упрутся в «administratively prohibited»
  MAX_CONCURRENT_EXEC: 4,

  // Таймауты служебных non-interactive вызовов (readDir/rename/move/...)
  OP_TIMEOUT_MS: 15 * 1000,
  // Чтение/запись файлов — отдельный, больший таймаут (сетевая передача содержимого)
  IO_TIMEOUT_MS: 60 * 1000,
  PROBE_TIMEOUT_MS: 20 * 1000,

  // Защита от нечитаемо большого stdout/stderr одного exec()-вызова
  MAX_EXEC_BUFFER_BYTES: 8 * 1024 * 1024,

  // Polling раскрытых каталогов взамен fs.watch (недоступен по SSH)
  POLL_INTERVAL_MS: 3000,
  POLL_MAX_DIRS: 40,
})
