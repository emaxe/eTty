import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/providers/app_lock_providers.dart';
import 'package:mobile/data/app_settings_store.dart';
import 'package:mobile/domain/quick_commands.dart';
import 'package:mobile/ui/settings/quick_commands_screen.dart';

class _FakeStore implements AppSettingsStore {
  String? json;

  @override
  Future<String?> getQuickCommandsJson() async => json;

  @override
  Future<void> setQuickCommandsJson(String value) async => json = value;

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

void main() {
  late _FakeStore store;

  Future<void> pump(WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [appSettingsStoreProvider.overrideWithValue(store)],
        child: const MaterialApp(home: QuickCommandsScreen()),
      ),
    );
    await tester.pumpAndSettle();
  }

  setUp(() => store = _FakeStore());

  testWidgets('показывает группы по умолчанию', (tester) async {
    await pump(tester);

    expect(find.text('Ответы'), findsOneWidget);
    expect(find.text('Команды'), findsOneWidget);
    expect(find.text('Промпты'), findsOneWidget);
  });

  testWidgets('добавление группы сохраняется в хранилище', (tester) async {
    await pump(tester);

    await tester.tap(find.byKey(const Key('add-group')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Мои');
    await tester.tap(find.text('Сохранить'));
    await tester.pumpAndSettle();

    final saved = decodeQuickCommands(store.json)!;
    expect(saved.map((g) => g.label), ['Ответы', 'Команды', 'Промпты', 'Мои']);
    expect(find.text('Мои'), findsOneWidget);
  });

  testWidgets('добавление команды в группу', (tester) async {
    await pump(tester);

    await tester.tap(find.text('Ответы'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('add-command')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('command-label')), 'Стоп');
    await tester.enterText(find.byKey(const Key('command-text')), 'Остановись');
    await tester.tap(find.text('Сохранить'));
    await tester.pumpAndSettle();

    final group = decodeQuickCommands(store.json)!.first;
    expect(group.commands.last.label, 'Стоп');
    expect(group.commands.last.text, 'Остановись');
    expect(group.commands.length, 5);
  });

  testWidgets('удаление группы с подтверждением', (tester) async {
    await pump(tester);

    await tester.tap(find.byTooltip('Удалить').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Да'));
    await tester.pumpAndSettle();

    expect(decodeQuickCommands(store.json)!.map((g) => g.label), ['Команды', 'Промпты']);
  });

  testWidgets('сброс к стандартным возвращает умолчания', (tester) async {
    store.json = encodeQuickCommands(const [
      QuickCommandGroup(id: 'x', label: 'Своя', commands: []),
    ]);
    await pump(tester);
    expect(find.text('Своя'), findsOneWidget);

    await tester.tap(find.byType(PopupMenuButton<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Сбросить к стандартным'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Да'));
    await tester.pumpAndSettle();

    expect(find.text('Своя'), findsNothing);
    expect(find.text('Ответы'), findsOneWidget);
  });
}
