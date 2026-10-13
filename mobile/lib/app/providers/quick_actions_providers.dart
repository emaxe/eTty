import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:mobile/app/providers/app_lock_providers.dart';
import 'package:mobile/core/config/quick_actions_config.dart';
import 'package:mobile/domain/quick_actions.dart';

/// Колесо быстрых действий: источник истины для редактора в настройках и для
/// `TerminalGestureLayer`. Битое/пустое хранилище → [QuickActionsConfig.defaultActions].
class QuickActionsNotifier extends AsyncNotifier<List<QuickAction>> {
  @override
  Future<List<QuickAction>> build() async {
    final json = await ref.watch(appSettingsStoreProvider).getQuickActionsJson();
    return decodeQuickActions(json) ?? QuickActionsConfig.defaultActions;
  }

  Future<void> save(List<QuickAction> actions) async {
    await ref.read(appSettingsStoreProvider).setQuickActionsJson(encodeQuickActions(actions));
    state = AsyncData(actions);
  }

  Future<void> resetToDefaults() => save(QuickActionsConfig.defaultActions);
}

final quickActionsProvider = AsyncNotifierProvider<QuickActionsNotifier, List<QuickAction>>(
  QuickActionsNotifier.new,
);
