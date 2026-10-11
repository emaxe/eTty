import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/providers/connection_providers.dart';
import 'package:mobile/data/connection_store.dart';
import 'package:mobile/ui/connections/connections_screen.dart';

/// In-memory реализация [SecureKeyValueStore] для тестов — не трогает Keychain/Keystore (тот же
/// паттерн, что в `test/app/providers/connection_providers_test.dart`).
class _InMemorySecureStore implements SecureKeyValueStore {
  final Map<String, String> _values = {};

  @override
  Future<String?> read(String key) async => _values[key];

  @override
  Future<void> write(String key, String value) async => _values[key] = value;

  @override
  Future<void> delete(String key) async => _values.remove(key);
}

ConnectionProfile _profile({
  required String id,
  required String label,
  String host = 'a.example.com',
  String username = 'root',
}) => ConnectionProfile(id: id, label: label, host: host, username: username);

Widget _app({
  required FileConnectionStore store,
  required void Function(ConnectionProfile) onOpen,
}) {
  return ProviderScope(
    overrides: [connectionStoreProvider.overrideWith((ref) async => store)],
    child: MaterialApp(home: ConnectionsScreen(onOpen: onOpen)),
  );
}

/// `pumpAndSettle()` пампит, только пока запланированы кадры (анимации/перестройки) — она НЕ
/// ждёт произвольный незавершённый реальный `Future` (в т.ч. `dart:io` внутри
/// `FileConnectionStore`, используемого провайдерами этого экрана и самим тестом): убедились
/// экспериментально, что `pumpAndSettle()` возвращается, пока `connectionsProvider` ещё в
/// `AsyncLoading` — планировщик кадров не знает про эту Future. Вместо неё — ручной поллинг с
/// РЕАЛЬНОЙ паузой между кадрами.
Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 50; i++) {
    await Future<void>.delayed(const Duration(milliseconds: 20));
    // `pump()` без длительности не продвигает фейковые часы анимаций (переход между
    // экранами/тултипы) ни на шаг — передаём тот же интервал, что реально прождали, иначе
    // анимация страницы никогда не считается завершённой.
    await tester.pump(const Duration(milliseconds: 20));
  }
}

void main() {
  late Directory tempDir;
  late FileConnectionStore store;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp(
      'etty_connections_screen_test_',
    );
    store = FileConnectionStore(
      File('${tempDir.path}/connections.json'),
      _InMemorySecureStore(),
    );
  });

  tearDown(() async {
    await tempDir.delete(recursive: true);
  });

  // ВЕСЬ код теста — ВНУТРИ tester.runAsync(): любой прямой dart:io (в т.ч. `store.upsert()`,
  // `store.all()` из проверок ПОСЛЕ взаимодействия с экраном) внутри testWidgets()-колбэка вне
  // runAsync зависает намертво — testWidgets крутится в управляемой Zone без реального event loop
  // для настоящих файловых Future (проверено экспериментально, см. докстринг _settle выше).
  // setUp()/tearDown() — отдельные хуки package:test, ИХ эта Zone не касается, поэтому они
  // остаются снаружи как обычно.

  testWidgets('список отображает профили', (tester) async {
    await tester.runAsync(() async {
      await store.upsert(_profile(id: 'a', label: 'Server A'));
      await store.upsert(
        _profile(id: 'b', label: 'Server B', host: 'b.example.com'),
      );

      await tester.pumpWidget(_app(store: store, onOpen: (_) {}));
      await _settle(tester);

      expect(find.text('Server A'), findsOneWidget);
      expect(find.text('Server B'), findsOneWidget);
    });
  });

  testWidgets('пустой список показывает empty-state', (tester) async {
    await tester.runAsync(() async {
      await tester.pumpWidget(_app(store: store, onOpen: (_) {}));
      await _settle(tester);

      expect(find.text('Пока нет ни одного подключения'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Добавить'), findsOneWidget);
    });
  });

  testWidgets('добавление профиля через форму появляется в списке', (
    tester,
  ) async {
    await tester.runAsync(() async {
      await tester.pumpWidget(_app(store: store, onOpen: (_) {}));
      await _settle(tester);

      await tester.tap(find.byTooltip('Добавить подключение'));
      await _settle(tester);

      await tester.enterText(
        find.byKey(const Key('connection_form_label')),
        'New Server',
      );
      await tester.enterText(
        find.byKey(const Key('connection_form_host')),
        'new.example.com',
      );
      await tester.enterText(
        find.byKey(const Key('connection_form_username')),
        'admin',
      );

      await tester.tap(find.byTooltip('Сохранить'));
      await _settle(tester);

      expect(find.text('New Server'), findsOneWidget);
      final saved = await store.all();
      expect(saved.map((p) => p.label), contains('New Server'));
    });
  });

  testWidgets('удаление убирает профиль после подтверждения', (tester) async {
    await tester.runAsync(() async {
      await store.upsert(_profile(id: 'a', label: 'Server A'));

      await tester.pumpWidget(_app(store: store, onOpen: (_) {}));
      await _settle(tester);

      expect(find.text('Server A'), findsOneWidget);

      await tester.fling(
        find.byKey(const ValueKey('a')),
        const Offset(-400, 0),
        1000,
      );
      await _settle(tester);

      expect(find.text('Удалить подключение?'), findsOneWidget);

      await tester.tap(find.widgetWithText(TextButton, 'Удалить'));
      await _settle(tester);

      expect(find.text('Server A'), findsNothing);
      expect((await store.all()).map((p) => p.id), isNot(contains('a')));
    });
  });

  testWidgets('тап по профилю вызывает onOpen с правильным профилем', (
    tester,
  ) async {
    await tester.runAsync(() async {
      await store.upsert(_profile(id: 'a', label: 'Server A'));
      ConnectionProfile? opened;

      await tester.pumpWidget(_app(store: store, onOpen: (p) => opened = p));
      await _settle(tester);

      await tester.tap(find.text('Server A'));
      await _settle(tester);

      expect(opened?.id, 'a');
      expect(opened?.label, 'Server A');
    });
  });
}
