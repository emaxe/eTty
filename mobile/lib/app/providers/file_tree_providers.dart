import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:mobile/app/providers/app_lock_providers.dart';

/// Источник истины для переключателя «Показать скрытые» в дереве файлов
/// (`RemoteFileTreeScreen`). Значение общее для всех подключений и переживает перезапуск: оно
/// отражает предпочтение пользователя, а не свойство конкретного сервера, поэтому хранится в
/// [AppSettingsStore] (как биометрическая блокировка), а не в профиле подключения. Сама
/// фильтрация клиентская и живёт в `FileTreeController.showHidden`.
class ShowHiddenFilesNotifier extends AsyncNotifier<bool> {
  @override
  Future<bool> build() =>
      ref.watch(appSettingsStoreProvider).getShowHiddenFiles();

  Future<void> setEnabled(bool enabled) async {
    await ref.read(appSettingsStoreProvider).setShowHiddenFiles(enabled);
    state = AsyncData(enabled);
  }
}

final showHiddenFilesProvider =
    AsyncNotifierProvider<ShowHiddenFilesNotifier, bool>(
      ShowHiddenFilesNotifier.new,
    );
