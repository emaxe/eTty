import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/domain/tmux_sessions.dart';
import 'package:mobile/remote/remote_scripts.dart';
import 'package:mobile/transport/exec_channel.dart';
import 'package:mobile/ui/connections/tmux_sessions_sheet.dart';

/// Одна фейковая tmux-сессия, которой [_FakeRemoteExec] отвечает на `list`, и которую
/// `kill`/`rename` мутируют, имитируя реальный сервер (в отличие от `_FakeRemoteExec` из
/// `test/domain/tmux_sessions_test.dart`, у которого ответ не зависит от предыдущих вызовов — тут
/// это нужно, чтобы после rename обновлённый список пришёл со следующим `list()`).
class _FakeSession {
  _FakeSession({required this.name, this.windows = 1, this.attached = 0});

  String name;
  final int windows;
  final int attached;
  final int createdAt = 1;
  final int? activityAt = null;
}

Uint8List _encodeSessions(List<_FakeSession> sessions) {
  if (sessions.isEmpty) return Uint8List.fromList(utf8.encode('\n'));
  final lines = sessions.map(
    (s) =>
        '${s.windows}\x00${s.attached}\x00${s.createdAt}\x00'
        '${s.activityAt ?? ''}\x00${s.name}',
  );
  return Uint8List.fromList(utf8.encode('${lines.join('\n')}\n\n'));
}

ExecResult _ok({Uint8List? stdout}) => ExecResult(
  exitCode: 0,
  stdout: stdout ?? Uint8List(0),
  stderr: Uint8List(0),
  timedOut: false,
);

ExecResult _fail(int exitCode) => ExecResult(
  exitCode: exitCode,
  stdout: Uint8List(0),
  stderr: Uint8List(0),
  timedOut: false,
);

/// Сервер, поддерживающий состояние своего списка сессий между вызовами (список сохраняется в
/// [_sessions] и правится kill/rename), плюс переключатель [noTmux] для проверки ветки ошибки.
class _FakeRemoteExec implements RemoteExec {
  _FakeRemoteExec(this._sessions);

  final List<_FakeSession> _sessions;
  bool noTmux = false;
  final List<({String script, List<String> args})> calls = [];

  @override
  Future<ExecResult> exec(
    String script,
    List<String> args, {
    Uint8List? stdin,
    Duration timeout = const Duration(milliseconds: 15000),
    int maxBufferBytes = 8 * 1024 * 1024,
  }) async {
    calls.add((script: script, args: args));
    if (noTmux) return _fail(127);

    if (script == RemoteScripts.tmuxListSessionsScript) {
      return _ok(stdout: _encodeSessions(_sessions));
    }
    if (script == RemoteScripts.tmuxKillSessionScript) {
      final name = args[1];
      final existed = _sessions.any((s) => s.name == name);
      if (!existed) return _fail(3);
      _sessions.removeWhere((s) => s.name == name);
      return _ok();
    }
    if (script == RemoteScripts.tmuxRenameSessionScript) {
      final name = args[1];
      final newName = args[2];
      final index = _sessions.indexWhere((s) => s.name == name);
      if (index == -1) return _fail(3);
      if (_sessions.any((s) => s.name == newName)) return _fail(17);
      _sessions[index].name = newName;
      return _ok();
    }
    throw UnimplementedError(script);
  }
}

Widget _app(TmuxSessionsService service, {ValueChanged<String>? onSelect}) {
  return MaterialApp(
    home: Scaffold(
      body: TmuxSessionsSheet(
        title: 'Test Server',
        createService: () async =>
            TmuxSessionsHandle(service: service, close: () async {}),
        onSelect: onSelect,
      ),
    ),
  );
}

/// Никакого реального `dart:io` в этих тестах нет — `_FakeRemoteExec.exec()` разрешается через
/// микротаски, без настоящих Future из файловой/сетевой системы, поэтому обычный `tester.pump()`
/// с искусственным продвижением часов (а не реальная задержка + `runAsync`, как в
/// `connections_screen_test.dart` для `FileConnectionStore`) вполне ловит все перестройки.
Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 20));
  }
}

/// Заменяет дерево на пустышку, чтобы `TmuxSessionsSheet.dispose()` (а значит и
/// `TmuxSessionsService.dispose()`) отработал до конца теста — иначе периодический таймер
/// автополлинга/дебаунса `refreshSoon()` остаётся висеть и тест падает с "A Timer is still
/// pending".
Future<void> _unmount(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump();
}

void main() {
  testWidgets('список отображает сессии из фейкового list()', (tester) async {
    final fake = _FakeRemoteExec([
      _FakeSession(name: 'etty-abc', windows: 2, attached: 1),
      _FakeSession(name: 'etty-def'),
    ]);
    final service = TmuxSessionsService(exec: fake, socket: 'etty');

    await tester.pumpWidget(_app(service));
    await _settle(tester);

    expect(find.text('etty-abc'), findsOneWidget);
    expect(find.text('etty-def'), findsOneWidget);
    expect(find.textContaining('активна'), findsOneWidget);

    await _unmount(tester);
  });

  testWidgets('kill убирает сессию из списка и вызывает service.kill', (
    tester,
  ) async {
    final fake = _FakeRemoteExec([_FakeSession(name: 'etty-abc')]);
    final service = TmuxSessionsService(exec: fake, socket: 'etty');

    await tester.pumpWidget(_app(service));
    await _settle(tester);
    expect(find.text('etty-abc'), findsOneWidget);

    await tester.tap(find.byKey(const Key('tmux-kill-etty-abc')));
    await _settle(tester);
    expect(find.text('Завершить сессию?'), findsOneWidget);

    await tester.tap(find.widgetWithText(TextButton, 'Завершить'));
    await _settle(tester);

    expect(find.text('etty-abc'), findsNothing);
    expect(
      fake.calls.any(
        (c) =>
            c.script == RemoteScripts.tmuxKillSessionScript &&
            c.args.last == 'etty-abc',
      ),
      isTrue,
    );

    await _unmount(tester);
  });

  testWidgets('rename переименовывает сессию', (tester) async {
    final fake = _FakeRemoteExec([_FakeSession(name: 'old-name')]);
    final service = TmuxSessionsService(exec: fake, socket: 'etty');

    await tester.pumpWidget(_app(service));
    await _settle(tester);

    await tester.tap(find.byKey(const Key('tmux-rename-old-name')));
    await _settle(tester);

    await tester.enterText(find.byType(TextField), 'new-name');
    await tester.tap(find.widgetWithText(FilledButton, 'Переименовать'));
    await _settle(tester);

    expect(
      fake.calls.any(
        (c) =>
            c.script == RemoteScripts.tmuxRenameSessionScript &&
            c.args.contains('new-name'),
      ),
      isTrue,
    );

    // refreshSoon() после успешного rename публикует обновлённый список через дебаунс
    // (SshSessionConfig.sessionsRefreshDelayMs = 800ms) — продвигаем часы за эту паузу.
    await tester.pump(const Duration(milliseconds: 900));
    await _settle(tester);

    expect(find.text('new-name'), findsOneWidget);
    expect(find.text('old-name'), findsNothing);

    await _unmount(tester);
  });

  testWidgets('ошибка noTmux показывает понятное сообщение', (tester) async {
    final fake = _FakeRemoteExec([])..noTmux = true;
    final service = TmuxSessionsService(exec: fake, socket: 'etty');

    await tester.pumpWidget(_app(service));
    await _settle(tester);

    expect(find.text('tmux не установлен на сервере'), findsOneWidget);

    await _unmount(tester);
  });

  group('выбор сессии', () {
    Future<List<String>> pumpSheet(
      WidgetTester tester,
      List<_FakeSession> sessions, {
      bool withSelect = true,
    }) async {
      final selected = <String>[];
      final service = TmuxSessionsService(
        exec: _FakeRemoteExec(sessions),
        socket: 'etty',
      );
      await tester.pumpWidget(
        _app(service, onSelect: withSelect ? selected.add : null),
      );
      await _settle(tester);
      return selected;
    }

    testWidgets('свободная сессия: onSelect без диалога', (tester) async {
      final selected = await pumpSheet(tester, [_FakeSession(name: 'free')]);

      await tester.tap(find.byKey(const Key('tmux-session-free')));
      await _settle(tester);

      expect(selected, ['free']);
      expect(find.text('Перехватить сессию?'), findsNothing);
      await _unmount(tester);
    });

    testWidgets('активная: диалог, отмена не выбирает', (tester) async {
      final selected = await pumpSheet(tester, [
        _FakeSession(name: 'busy', attached: 1),
      ]);

      await tester.tap(find.byKey(const Key('tmux-session-busy')));
      await _settle(tester);
      expect(find.text('Перехватить сессию?'), findsOneWidget);
      expect(find.text('Прежний клиент будет отключён.'), findsOneWidget);

      await tester.tap(find.widgetWithText(TextButton, 'Отмена'));
      await _settle(tester);

      expect(selected, isEmpty);
      expect(find.text('Перехватить сессию?'), findsNothing);
      await _unmount(tester);
    });

    testWidgets('активная: «Перехватить» вызывает onSelect', (tester) async {
      final selected = await pumpSheet(tester, [
        _FakeSession(name: 'busy', attached: 2),
      ]);

      await tester.tap(find.byKey(const Key('tmux-session-busy')));
      await _settle(tester);
      await tester.tap(find.widgetWithText(FilledButton, 'Перехватить'));
      await _settle(tester);

      expect(selected, ['busy']);
      await _unmount(tester);
    });

    testWidgets('имя вне sessionNameRe: неактивно, onSelect не вызывается', (
      tester,
    ) async {
      final selected = await pumpSheet(tester, [_FakeSession(name: 'my.work')]);

      expect(find.text('my.work'), findsOneWidget);
      expect(find.textContaining('имя не поддерживается'), findsOneWidget);
      final tile = tester.widget<ListTile>(
        find.byKey(const Key('tmux-session-my.work')),
      );
      expect(tile.enabled, isFalse);

      await tester.tap(find.byKey(const Key('tmux-session-my.work')));
      await _settle(tester);

      expect(selected, isEmpty);
      await _unmount(tester);
    });

    testWidgets('тап по kill/rename не выбирает строку', (tester) async {
      final selected = await pumpSheet(tester, [_FakeSession(name: 'free')]);

      await tester.tap(find.byKey(const Key('tmux-kill-free')));
      await _settle(tester);
      await tester.tap(find.widgetWithText(TextButton, 'Отмена'));
      await _settle(tester);
      await tester.tap(find.byKey(const Key('tmux-rename-free')));
      await _settle(tester);
      await tester.tap(find.widgetWithText(TextButton, 'Отмена'));
      await _settle(tester);

      expect(selected, isEmpty);
      await _unmount(tester);
    });

    testWidgets('без onSelect тап ничего не делает', (tester) async {
      await pumpSheet(tester, [
        _FakeSession(name: 'busy', attached: 1),
      ], withSelect: false);

      final tile = tester.widget<ListTile>(
        find.byKey(const Key('tmux-session-busy')),
      );
      expect(tile.onTap, isNull);

      await tester.tap(find.byKey(const Key('tmux-session-busy')));
      await _settle(tester);

      expect(find.text('Перехватить сессию?'), findsNothing);
      await _unmount(tester);
    });

    testWidgets('активная плитка подсвечена, свободная нет', (tester) async {
      await pumpSheet(tester, [
        _FakeSession(name: 'busy', attached: 1),
        _FakeSession(name: 'free'),
      ]);

      expect(find.byKey(const Key('tmux-attached-busy')), findsOneWidget);
      expect(find.byKey(const Key('tmux-attached-free')), findsNothing);
      final busy = tester.widget<ListTile>(
        find.byKey(const Key('tmux-session-busy')),
      );
      final free = tester.widget<ListTile>(
        find.byKey(const Key('tmux-session-free')),
      );
      expect(busy.tileColor, isNotNull);
      expect(free.tileColor, isNull);
      await _unmount(tester);
    });
  });
}
