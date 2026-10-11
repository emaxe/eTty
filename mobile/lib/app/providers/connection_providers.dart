import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import 'package:mobile/data/connection_store.dart';

/// Хранилище профилей — один экземпляр на весь жизненный цикл приложения (провайдер без
/// `.autoDispose`, кэшируется контейнером). Путь — `getApplicationSupportDirectory()`, app-private
/// песочница (REQ-18: секреты отдельно, в `flutter_secure_storage`, сюда попадают только
/// не-секретные поля профиля).
final connectionStoreProvider = FutureProvider<ConnectionStore>((ref) async {
  final dir = await getApplicationSupportDirectory();
  return FileConnectionStore(File('${dir.path}/connections.json'));
});

/// Список профилей подключений — источник истины для экрана подключений (задача #21) и панели
/// сессий сервера (задача #25). `AsyncNotifier`, а не `FutureProvider`: список изменяется CRUD-
/// методами ниже, а не только перечитывается.
class ConnectionsNotifier extends AsyncNotifier<List<ConnectionProfile>> {
  @override
  Future<List<ConnectionProfile>> build() async {
    final store = await ref.watch(connectionStoreProvider.future);
    return store.all();
  }

  Future<ConnectionStore> _store() => ref.read(connectionStoreProvider.future);

  Future<void> upsert(ConnectionProfile profile) async {
    final store = await _store();
    await store.upsert(profile);
    state = AsyncData(await store.all());
  }

  Future<void> remove(String id) async {
    final store = await _store();
    await store.remove(id);
    state = AsyncData(await store.all());
    ref.invalidate(connectionSecretsProvider(id));
  }

  Future<void> reorder(List<String> ids) async {
    final store = await _store();
    await store.reorder(ids);
    state = AsyncData(await store.all());
  }

  /// Секреты профиля — CRUD только через этот метод (не напрямую через [connectionStoreProvider]),
  /// чтобы [connectionSecretsProvider] узнавал об изменении (см. `ref.invalidate` ниже).
  Future<void> saveSecrets(String id, ConnectionSecrets secrets) async {
    final store = await _store();
    await store.saveSecrets(id, secrets);
    ref.invalidate(connectionSecretsProvider(id));
  }
}

final connectionsProvider =
    AsyncNotifierProvider<ConnectionsNotifier, List<ConnectionProfile>>(
      ConnectionsNotifier.new,
    );

/// Секреты одного профиля, по требованию (экран редактирования подключения — задача #21) —
/// секреты всех профилей сразу в память не тянем, только активно редактируемого.
final connectionSecretsProvider =
    FutureProvider.family<ConnectionSecrets, String>((ref, id) async {
      final store = await ref.watch(connectionStoreProvider.future);
      return store.loadSecrets(id);
    });
