import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/providers/app_lock_providers.dart';
import 'package:mobile/core/config/floating_button_config.dart';
import 'package:mobile/core/config/quick_actions_config.dart';
import 'package:mobile/data/app_settings_store.dart';
import 'package:mobile/domain/floating_button.dart';
import 'package:mobile/ui/settings/floating_button_screen.dart';

class _FakeStore implements AppSettingsStore {
  String? json;

  @override
  Future<String?> getFloatingButtonJson() async => json;

  @override
  Future<void> setFloatingButtonJson(String value) async => json = value;

  @override
  Future<String?> getQuickCommandsJson() async => null;

  @override
  Future<void> setQuickCommandsJson(String value) async {}

  @override
  Future<String?> getQuickActionsJson() async => null;

  @override
  Future<void> setQuickActionsJson(String json) async {}

  @override
  Future<bool> getBiometricLockEnabled() async => false;

  @override
  Future<void> setBiometricLockEnabled(bool enabled) async {}

  @override
  Future<bool> getShowHiddenFiles() async => false;

  @override
  Future<void> setShowHiddenFiles(bool enabled) async {}
}

final Finder _sheetScrollable = find
    .descendant(
      of: find.byKey(const Key('action-picker-list')),
      matching: find.byType(Scrollable),
    )
    .first;

void main() {
  late _FakeStore store;

  /// Высокий экран: список панели должен быть виден целиком, иначе `ReorderableListView` не
  /// строит нижние строки и поиск по тексту врёт.
  Future<void> pump(WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 1000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      ProviderScope(
        overrides: [appSettingsStoreProvider.overrideWithValue(store)],
        child: const MaterialApp(home: FloatingButtonScreen()),
      ),
    );
    await tester.pumpAndSettle();
  }

  FloatingButtonSettings saved() => decodeFloatingButton(store.json)!;

  /// Лист выбора действия длиннее экрана и ленивый — до нужного пункта надо доскроллить.
  /// Скроллящийся список ищем по ключу, а не по `add-custom-action`: верхняя строка уезжает из
  /// дерева при прокрутке, и finder по ней перестаёт находиться.
  Future<void> pickFromCatalog(WidgetTester tester, String id) async {
    final sheet = _sheetScrollable;
    await tester.scrollUntilVisible(
      find.byKey(Key('catalog-$id')),
      120,
      scrollable: sheet,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(Key('catalog-$id')));
    await tester.pumpAndSettle();
  }

  setUp(() => store = _FakeStore());

  testWidgets('показывает умолчания: включена, ⇧⏎ / вставка, весь список', (
    tester,
  ) async {
    await pump(tester);

    expect(
      tester
          .widget<SwitchListTile>(find.byKey(const Key('floating-enabled')))
          .value,
      isTrue,
    );
    expect(find.textContaining('⇧⏎ ·'), findsOneWidget);
    expect(find.textContaining('📋 Вставить ·'), findsOneWidget);
    expect(find.text('📎 Файл'), findsOneWidget);
    expect(find.text('⇧⏎'), findsWidgets);
  });

  testWidgets('выключение кнопки сохраняется и не сбрасывает остальное', (
    tester,
  ) async {
    await pump(tester);

    await tester.tap(find.byKey(const Key('floating-enabled')));
    await tester.pumpAndSettle();

    final settings = saved();
    expect(settings.enabled, isFalse);
    expect(settings.positionX, FloatingButtonConfig.defaultPositionX);
    expect(
      settings.actions,
      hasLength(FloatingButtonConfig.defaultActions.length),
    );
  });

  testWidgets('действие одиночного тапа выбирается из каталога и сохраняется', (
    tester,
  ) async {
    await pump(tester);

    await tester.tap(find.byKey(const Key('floating-tap')));
    await tester.pumpAndSettle();
    await pickFromCatalog(tester, 'ctrl-c');

    expect(saved().tapAction.id, 'ctrl-c');
    expect(saved().tapAction.data, '\x03');
  });

  testWidgets('действие двойного тапа можно повесить на «Копировать»', (
    tester,
  ) async {
    await pump(tester);

    await tester.tap(find.byKey(const Key('floating-double-tap')));
    await tester.pumpAndSettle();
    await pickFromCatalog(tester, 'copy');

    expect(saved().doubleTapAction.kind, QuickActionKind.copy);
    expect(saved().tapAction.id, FloatingButtonConfig.defaultTapAction.id);
  });

  testWidgets(
    'каталог кнопки предлагает «Вставить» и «Копировать», у колеса их нет',
    (tester) async {
      await pump(tester);

      await tester.tap(find.byKey(const Key('floating-tap')));
      await tester.pumpAndSettle();

      await tester.scrollUntilVisible(
        find.byKey(const Key('catalog-paste')),
        120,
        scrollable: _sheetScrollable,
      );
      expect(find.byKey(const Key('catalog-paste')), findsOneWidget);
      await tester.scrollUntilVisible(
        find.byKey(const Key('catalog-copy')),
        120,
        scrollable: _sheetScrollable,
      );
      expect(find.byKey(const Key('catalog-copy')), findsOneWidget);
      final wheelKinds = {for (final a in QuickActionsConfig.catalog) a.kind};
      expect(wheelKinds, isNot(contains(QuickActionKind.paste)));
      expect(wheelKinds, isNot(contains(QuickActionKind.copy)));
    },
  );

  testWidgets('добавление кнопки панели из каталога сохраняется', (
    tester,
  ) async {
    await pump(tester);

    await tester.tap(find.byKey(const Key('add-action')));
    await tester.pumpAndSettle();
    await pickFromCatalog(tester, 'shift-tab');

    expect(saved().actions.map((a) => a.id), contains('shift-tab'));
    expect(
      saved().actions,
      hasLength(FloatingButtonConfig.defaultActions.length + 1),
    );
  });

  testWidgets('удаление свайпом убирает кнопку из списка', (tester) async {
    await pump(tester);

    await tester.drag(find.text('📎 Файл'), const Offset(-500, 0));
    await tester.pumpAndSettle();

    expect(saved().actions.map((a) => a.id), isNot(contains('attach')));
  });

  testWidgets('сброс к умолчаниям возвращает включённую кнопку со списком', (
    tester,
  ) async {
    store.json = encodeFloatingButton(
      const FloatingButtonSettings().copyWith(
        enabled: false,
        actions: const [QuickAction(id: 'mine', label: 'Моя', data: 'x')],
      ),
    );
    await pump(tester);
    expect(find.text('Моя'), findsOneWidget);

    await tester.tap(find.byType(PopupMenuButton<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Сбросить к стандартным'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Да'));
    await tester.pumpAndSettle();

    expect(find.text('Моя'), findsNothing);
    expect(saved().enabled, isTrue);
    expect(
      saved().actions,
      hasLength(FloatingButtonConfig.defaultActions.length),
    );
  });
}
