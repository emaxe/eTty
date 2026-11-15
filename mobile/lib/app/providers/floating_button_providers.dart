import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:mobile/app/providers/app_lock_providers.dart';
import 'package:mobile/domain/floating_button.dart';

/// Настройки плавающей кнопки: источник истины и для терминала (`_TerminalTabView`), и для экрана
/// настроек. Битое/пустое хранилище → умолчания [FloatingButtonSettings].
class FloatingButtonNotifier extends AsyncNotifier<FloatingButtonSettings> {
  @override
  Future<FloatingButtonSettings> build() async {
    final json = await ref.watch(appSettingsStoreProvider).getFloatingButtonJson();
    return decodeFloatingButton(json) ?? const FloatingButtonSettings();
  }

  Future<void> save(FloatingButtonSettings settings) async {
    await ref
        .read(appSettingsStoreProvider)
        .setFloatingButtonJson(encodeFloatingButton(settings));
    state = AsyncData(settings);
  }

  Future<void> resetToDefaults() => save(const FloatingButtonSettings());
}

final floatingButtonProvider =
    AsyncNotifierProvider<FloatingButtonNotifier, FloatingButtonSettings>(
      FloatingButtonNotifier.new,
    );
