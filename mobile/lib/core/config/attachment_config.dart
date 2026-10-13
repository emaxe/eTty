/// Загрузка файла с телефона на сервер из колеса быстрых действий (`attachment_upload.dart`).
abstract final class AttachmentConfig {
  /// Больше не грузим: файл целиком читается в память и уходит через stdin exec-канала.
  static const int maxBytes = 25 * 1024 * 1024;

  /// Максимум символов в имени файла на сервере (без префикса).
  static const int maxNameLength = 80;
}
