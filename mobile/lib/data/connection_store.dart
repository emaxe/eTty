import 'dart:convert';
import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'package:mobile/core/config/ssh_session_config.dart';

/// Способ аутентификации. Без `agent` — на мобилке нет SSH-агента (REQ-7,
/// `docs/plans/mob/plan.md`); значение `agent` в импортированном с десктопа профиле (задача #32)
/// помечается как неподдерживаемое той стороной, которая делает импорт, не этим хранилищем.
enum SshAuthType { password, privateKey, keyboardInteractive }

/// Публичные (не секретные) данные одного профиля подключения — живут обычным JSON-файлом.
/// Секреты (пароль/passphrase/приватный ключ) — отдельно, в [ConnectionSecrets] через
/// secure storage (REQ-18): даже полный доступ к файлу профилей не даёт доступа к ним.
///
/// `persistence`/`tmuxSocket` — те же значения, что принимает
/// `RemoteShellHooks.buildRemoteInitCommand` (`'off'`|`'tmux'` и имя сокета соответственно) —
/// хранятся как настройка ПРОФИЛЯ, а не только вкладки: REQ-10 делает `'tmux'` дефолтом на
/// мобилке (в отличие от десктопа), но пользователь может переключить на обычный SSH-режим.
class ConnectionProfile {
  const ConnectionProfile({
    required this.id,
    required this.label,
    required this.host,
    required this.username,
    this.port = 22,
    this.authType = SshAuthType.password,
    this.persistence = 'tmux',
    this.tmuxSocket = SshSessionConfig.defaultSocket,
    this.hooksEnabled = true,
  });

  /// Стабильный идентификатор — источник имени tmux-сессии
  /// ([buildSessionNameBase], `remote/session_name.dart`) и ключа секретов в
  /// [ConnectionSecrets]; сохраняется при экспорте/импорте (`*.ettyx`, задачи #31/#32), чтобы
  /// повторное подключение с любого клиента находило ту же серверную сессию (REQ-1).
  final String id;

  final String label;
  final String host;
  final int port;
  final String username;
  final SshAuthType authType;

  /// `'off'` | `'tmux'`.
  final String persistence;
  final String tmuxSocket;

  /// Инжект OSC 7/133-хуков на удалённой стороне (`RemoteShellHooks`) — эквивалент
  /// `injectShellIntegration` на десктопе.
  final bool hooksEnabled;

  ConnectionProfile copyWith({
    String? label,
    String? host,
    int? port,
    String? username,
    SshAuthType? authType,
    String? persistence,
    String? tmuxSocket,
    bool? hooksEnabled,
  }) {
    return ConnectionProfile(
      id: id,
      label: label ?? this.label,
      host: host ?? this.host,
      port: port ?? this.port,
      username: username ?? this.username,
      authType: authType ?? this.authType,
      persistence: persistence ?? this.persistence,
      tmuxSocket: tmuxSocket ?? this.tmuxSocket,
      hooksEnabled: hooksEnabled ?? this.hooksEnabled,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'label': label,
    'host': host,
    'port': port,
    'username': username,
    'authType': authType.name,
    'persistence': persistence == 'tmux' ? 'tmux' : 'off',
    'tmuxSocket': tmuxSocket,
    'hooksEnabled': hooksEnabled,
  };

  factory ConnectionProfile.fromJson(Map<String, dynamic> json) {
    // Отсутствующее поле — старый/неполный JSON, дефолт 'tmux' (REQ-10); присутствующее, но не
    // 'tmux' — нормализуем в 'off', а не пропускаем произвольную строку дальше.
    final rawPersistence = json['persistence'] as String?;
    return ConnectionProfile(
      id: json['id'] as String,
      label: json['label'] as String,
      host: json['host'] as String,
      port: json['port'] as int? ?? 22,
      username: json['username'] as String,
      authType: SshAuthType.values.firstWhere(
        (t) => t.name == json['authType'],
        orElse: () => SshAuthType.password,
      ),
      persistence: rawPersistence == null
          ? 'tmux'
          : (rawPersistence == 'tmux' ? 'tmux' : 'off'),
      tmuxSocket:
          json['tmuxSocket'] as String? ?? SshSessionConfig.defaultSocket,
      hooksEnabled: json['hooksEnabled'] as bool? ?? true,
    );
  }
}

/// Секреты одного профиля — пароль, passphrase приватного ключа, сам приватный ключ (PEM-текст:
/// на мобилке нет произвольного доступа к ФС, как `privateKeyPath` на десктопе, поэтому ключ
/// хранится содержимым, а не путём). Какие поля осмысленны, зависит от `ConnectionProfile.authType`
/// вызывающей стороны — этот класс сам ничего не валидирует, только переносит данные.
class ConnectionSecrets {
  const ConnectionSecrets({this.password, this.privateKeyPem, this.passphrase});

  static const empty = ConnectionSecrets();

  final String? password;
  final String? privateKeyPem;
  final String? passphrase;

  bool get isEmpty =>
      password == null && privateKeyPem == null && passphrase == null;

  Map<String, dynamic> toJson() => {
    if (password != null) 'password': password,
    if (privateKeyPem != null) 'privateKeyPem': privateKeyPem,
    if (passphrase != null) 'passphrase': passphrase,
  };

  factory ConnectionSecrets.fromJson(Map<String, dynamic> json) =>
      ConnectionSecrets(
        password: json['password'] as String?,
        privateKeyPem: json['privateKeyPem'] as String?,
        passphrase: json['passphrase'] as String?,
      );
}

/// Узкий контракт над шифрованным key-value хранилищем — швом для тестов (см.
/// `dart-generate-test-mocks`/`SshClientSource` в транспортном слое: та же идея, продакшен-код
/// зависит от интерфейса, а не от конкретного `FlutterSecureStorage`).
abstract class SecureKeyValueStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

/// Реализация [SecureKeyValueStore] поверх `flutter_secure_storage` (Keychain на iOS, Keystore
/// на Android — REQ-18).
class FlutterSecureKeyValueStore implements SecureKeyValueStore {
  const FlutterSecureKeyValueStore([
    this._storage = const FlutterSecureStorage(),
  ]);

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

/// Хранилище профилей подключений — контракт, не завязанный на конкретный бэкенд.
abstract class ConnectionStore {
  Future<List<ConnectionProfile>> all();
  Future<ConnectionProfile?> find(String id);

  /// Создаёт новый профиль либо заменяет существующий с тем же `id`. Секреты профиля не трогает —
  /// для них [saveSecrets].
  Future<void> upsert(ConnectionProfile profile);

  /// Удаляет профиль и его секреты (если были) — секреты профиля без самого профиля бессмысленны.
  Future<void> remove(String id);

  /// Переставляет профили в порядке [ids] (полностью аналогично `reorderConnections` на
  /// десктопе) — id, отсутствующие в [ids], дописываются в конец в исходном порядке (защита от
  /// рассинхрона), а не теряются.
  Future<void> reorder(List<String> ids);

  Future<ConnectionSecrets> loadSecrets(String id);

  /// `ConnectionSecrets.empty` удаляет запись секретов целиком, а не хранит пустой JSON.
  Future<void> saveSecrets(String id, ConnectionSecrets secrets);
}

/// [ConnectionStore] поверх одного JSON-файла (профили, как [FileKnownHostsStore]) и
/// [SecureKeyValueStore] (секреты, по одной JSON-записи `ConnectionSecrets` на профиль, ключ —
/// `id` профиля с префиксом, чтобы не смешаться с другими будущими пользователями того же
/// secure storage).
class FileConnectionStore implements ConnectionStore {
  FileConnectionStore(this._file, [SecureKeyValueStore? secrets])
    : _secrets = secrets ?? const FlutterSecureKeyValueStore();

  static const String _secretKeyPrefix = 'etty.connection.';

  final File _file;
  final SecureKeyValueStore _secrets;

  List<ConnectionProfile>? _cache;

  String _secretKey(String id) => '$_secretKeyPrefix$id';

  Future<List<ConnectionProfile>> _load() async {
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
        .map((e) => ConnectionProfile.fromJson(e as Map<String, dynamic>))
        .toList(growable: true);
    return _cache!;
  }

  Future<void> _persist(List<ConnectionProfile> profiles) async {
    _cache = profiles;
    await _file.parent.create(recursive: true);
    final json = jsonEncode(profiles.map((p) => p.toJson()).toList());
    await _file.writeAsString(json);
  }

  @override
  Future<List<ConnectionProfile>> all() async =>
      List.unmodifiable(await _load());

  @override
  Future<ConnectionProfile?> find(String id) async {
    final profiles = await _load();
    for (final p in profiles) {
      if (p.id == id) return p;
    }
    return null;
  }

  @override
  Future<void> upsert(ConnectionProfile profile) async {
    final profiles = List<ConnectionProfile>.from(await _load());
    final index = profiles.indexWhere((p) => p.id == profile.id);
    if (index == -1) {
      profiles.add(profile);
    } else {
      profiles[index] = profile;
    }
    await _persist(profiles);
  }

  @override
  Future<void> remove(String id) async {
    final profiles = List<ConnectionProfile>.from(await _load());
    profiles.removeWhere((p) => p.id == id);
    await _persist(profiles);
    await _secrets.delete(_secretKey(id));
  }

  @override
  Future<void> reorder(List<String> ids) async {
    final profiles = await _load();
    final byId = {for (final p in profiles) p.id: p};
    final reordered = <ConnectionProfile>[
      for (final id in ids)
        if (byId[id] != null) byId[id]!,
    ];
    for (final p in profiles) {
      if (!ids.contains(p.id)) reordered.add(p);
    }
    await _persist(reordered);
  }

  @override
  Future<ConnectionSecrets> loadSecrets(String id) async {
    final raw = await _secrets.read(_secretKey(id));
    if (raw == null) return ConnectionSecrets.empty;
    return ConnectionSecrets.fromJson(jsonDecode(raw) as Map<String, dynamic>);
  }

  @override
  Future<void> saveSecrets(String id, ConnectionSecrets secrets) async {
    if (secrets.isEmpty) {
      await _secrets.delete(_secretKey(id));
      return;
    }
    await _secrets.write(_secretKey(id), jsonEncode(secrets.toJson()));
  }
}
