import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:mobile/app/providers/app_lock_providers.dart';
import 'package:mobile/domain/quick_commands.dart';

/// Пользовательские команды второго колеса: источник истины для редактора в настройках и для
/// `TerminalGestureLayer`. Битое/пустое хранилище → [QuickCommandsDefaults.groups].
class QuickCommandsNotifier extends AsyncNotifier<List<QuickCommandGroup>> {
  @override
  Future<List<QuickCommandGroup>> build() async {
    final json = await ref.watch(appSettingsStoreProvider).getQuickCommandsJson();
    return decodeQuickCommands(json) ?? QuickCommandsDefaults.groups;
  }

  Future<void> save(List<QuickCommandGroup> groups) async {
    await ref
        .read(appSettingsStoreProvider)
        .setQuickCommandsJson(encodeQuickCommands(groups));
    state = AsyncData(groups);
  }

  Future<void> resetToDefaults() => save(QuickCommandsDefaults.groups);
}

final quickCommandsProvider =
    AsyncNotifierProvider<QuickCommandsNotifier, List<QuickCommandGroup>>(
      QuickCommandsNotifier.new,
    );
