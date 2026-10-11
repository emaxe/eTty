import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import 'package:mobile/data/known_hosts_store.dart';

/// Хранилище отпечатков известных host key (REQ-8, TOFU) — один экземпляр на приложение, тот же
/// принцип, что [connectionStoreProvider] (`app/providers/connection_providers.dart`): не секрет,
/// но нарушение целостности файла ослабляет TOFU, поэтому app-private песочница, а не общедоступное
/// место.
final knownHostsStoreProvider = FutureProvider<KnownHostsStore>((ref) async {
  final dir = await getApplicationSupportDirectory();
  return FileKnownHostsStore(File('${dir.path}/known_hosts.json'));
});
