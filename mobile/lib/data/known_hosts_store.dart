import 'dart:convert';
import 'dart:io';

/// Одна запись об известном отпечатке host key — соответствует одной строке `known_hosts` у
/// OpenSSH, но в собственном JSON-хранилище (dartssh2 не читает системный `known_hosts`, TOFU
/// реализуется приложением, см. `transport/host_keys.dart` и REQ-8 в `docs/plans/mob/plan.md`).
class KnownHostEntry {
  const KnownHostEntry({
    required this.host,
    required this.port,
    required this.keyType,
    required this.fingerprint,
    required this.addedAt,
    required this.lastSeenAt,
    this.source = 'tofu',
  });

  /// Хост в исходном виде (как введён пользователем в профиле подключения).
  final String host;
  final int port;

  /// Тип ключа (`ssh-ed25519`, `rsa-sha2-256`, …) — совпадает с `type` из
  /// `SSHHostkeyVerifyHandler`. Один хост может иметь несколько записей с разными типами.
  final String keyType;

  /// Отпечаток в формате OpenSSH `SHA256:<base64 без паддинга>` — то же представление, что
  /// dartssh2 отдаёт в `onVerifyHostKey` (см. `transport/host_keys.dart`), сравнение строковое.
  final String fingerprint;

  final DateTime addedAt;
  final DateTime lastSeenAt;

  /// `'tofu'` — добавлена при первом подключении; `'import'` — принесена вместе с профилями с
  /// десктопа (`data/connection_export.dart`, задача #32).
  final String source;

  KnownHostEntry copyWith({DateTime? lastSeenAt}) {
    return KnownHostEntry(
      host: host,
      port: port,
      keyType: keyType,
      fingerprint: fingerprint,
      addedAt: addedAt,
      lastSeenAt: lastSeenAt ?? this.lastSeenAt,
      source: source,
    );
  }

  Map<String, dynamic> toJson() => {
        'host': host,
        'port': port,
        'keyType': keyType,
        'fingerprint': fingerprint,
        'addedAt': addedAt.toIso8601String(),
        'lastSeenAt': lastSeenAt.toIso8601String(),
        'source': source,
      };

  factory KnownHostEntry.fromJson(Map<String, dynamic> json) {
    return KnownHostEntry(
      host: json['host'] as String,
      port: json['port'] as int,
      keyType: json['keyType'] as String,
      fingerprint: json['fingerprint'] as String,
      addedAt: DateTime.parse(json['addedAt'] as String),
      lastSeenAt: DateTime.parse(json['lastSeenAt'] as String),
      source: json['source'] as String? ?? 'tofu',
    );
  }
}

/// Хранилище известных host key — контракт, не завязанный на конкретный бэкенд (файл — сейчас
/// единственная реализация, [FileKnownHostsStore]). Ключ записи — тройка
/// `(host, port, keyType)`: один хост может легитимно иметь несколько разных ключей (rsa + ed25519
/// одновременно), это не конфликт.
abstract class KnownHostsStore {
  Future<KnownHostEntry?> find(String host, int port, String keyType);

  /// Добавляет новую запись либо заменяет существующую с тем же `(host, port, keyType)`.
  Future<void> upsert(KnownHostEntry entry);

  Future<void> remove(String host, int port, String keyType);

  Future<List<KnownHostEntry>> all();
}

/// Реализация [KnownHostsStore] поверх одного JSON-файла — путь к файлу передаётся снаружи
/// (в приложении это app-private документы через `path_provider`, в тестах — временный файл),
/// сам класс о платформе ничего не знает. Не секрет (в отличие от паролей/ключей в
/// `flutter_secure_storage`), но нарушение целостности этого файла — ослабление TOFU, поэтому
/// он живёт в app sandbox, а не в общедоступном месте.
class FileKnownHostsStore implements KnownHostsStore {
  FileKnownHostsStore(this._file);

  final File _file;

  List<KnownHostEntry>? _cache;

  Future<List<KnownHostEntry>> _load() async {
    if (_cache != null) return _cache!;
    if (!await _file.exists()) {
      _cache = [];
      return _cache!;
    }
    final raw = await _file.readAsString();
    if (raw.trim().isEmpty) {
      _cache = [];
      return _cache!;
    }
    final decoded = jsonDecode(raw) as List<dynamic>;
    _cache = decoded
        .map((e) => KnownHostEntry.fromJson(e as Map<String, dynamic>))
        .toList(growable: true);
    return _cache!;
  }

  Future<void> _persist(List<KnownHostEntry> entries) async {
    _cache = entries;
    await _file.parent.create(recursive: true);
    final json = jsonEncode(entries.map((e) => e.toJson()).toList());
    await _file.writeAsString(json);
  }

  bool _matches(KnownHostEntry e, String host, int port, String keyType) =>
      e.host == host && e.port == port && e.keyType == keyType;

  @override
  Future<KnownHostEntry?> find(String host, int port, String keyType) async {
    final entries = await _load();
    for (final e in entries) {
      if (_matches(e, host, port, keyType)) return e;
    }
    return null;
  }

  @override
  Future<void> upsert(KnownHostEntry entry) async {
    final entries = List<KnownHostEntry>.from(await _load());
    final index = entries.indexWhere((e) => _matches(e, entry.host, entry.port, entry.keyType));
    if (index == -1) {
      entries.add(entry);
    } else {
      entries[index] = entry;
    }
    await _persist(entries);
  }

  @override
  Future<void> remove(String host, int port, String keyType) async {
    final entries = List<KnownHostEntry>.from(await _load());
    entries.removeWhere((e) => _matches(e, host, port, keyType));
    await _persist(entries);
  }

  @override
  Future<List<KnownHostEntry>> all() async => List.unmodifiable(await _load());
}
