import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/config/ssh_session_config.dart';
import 'package:mobile/core/config/terminal_gesture_config.dart';
import 'package:mobile/domain/quick_commands.dart';
import 'package:mobile/ui/terminal/quick_action_wheel.dart';
import 'package:mobile/ui/terminal/terminal_gestures.dart';
import 'package:xterm/xterm.dart' as xterm;

class _FakeTimer implements Timer {
  _FakeTimer(this.cb);
  final void Function() cb;
  bool cancelled = false;
  @override
  void cancel() => cancelled = true;
  @override
  bool get isActive => !cancelled;
  @override
  int get tick => 0;
  void fire() {
    if (!cancelled) cb();
  }
}

void main() {
  group('TerminalGestureInterpreter', () {
    late List<String> log;
    late List<_FakeTimer> timers;
    late TerminalGestureInterpreter g;

    setUp(() {
      log = [];
      timers = [];
      g = TerminalGestureInterpreter(
        onTap: (p) => log.add('tap'),
        onScroll: (dy, p) => log.add('scroll ${dy.round()}'),
        onLongPressStart: (p) => log.add('lpStart'),
        onLongPressMove: (p) => log.add('lpMove'),
        onLongPressEnd: (p) => log.add('lpEnd'),
        onSwipe: (d) => log.add('swipe ${d.name}'),
        timerFactory: (d, cb) {
          final t = _FakeTimer(cb);
          timers.add(t);
          return t;
        },
      );
    });

    test('короткое касание без движения — тап', () {
      g.pointerDown(1, const Offset(10, 10));
      g.pointerUp(1, const Offset(10, 10));
      expect(log, ['tap']);
      expect(timers.single.cancelled, isTrue);
    });

    test('движение в пределах slop остаётся тапом', () {
      g.pointerDown(1, const Offset(10, 10));
      g.pointerMove(1, const Offset(15, 12));
      g.pointerUp(1, const Offset(15, 12));
      expect(log, ['tap']);
    });

    test('движение за slop — скролл, тапа нет', () {
      g.pointerDown(1, const Offset(10, 10));
      g.pointerMove(1, const Offset(10, 50));
      g.pointerMove(1, const Offset(10, 70));
      g.pointerUp(1, const Offset(10, 70));
      expect(log, ['scroll 40', 'scroll 20']);
    });

    test('удержание — long-press, отпускание завершает его без тапа', () {
      g.pointerDown(1, const Offset(10, 10));
      timers.single.fire();
      g.pointerMove(1, const Offset(30, 10));
      g.pointerUp(1, const Offset(30, 10));
      expect(log, ['lpStart', 'lpMove', 'lpEnd']);
    });

    for (final c in {
      'left': const Offset(-60, 5),
      'right': const Offset(60, -5),
      'up': const Offset(5, -60),
      'down': const Offset(-5, 60),
    }.entries) {
      test('два пальца ${c.key} — ровно одна стрелка за жест', () {
        g.pointerDown(1, const Offset(100, 100));
        g.pointerDown(2, const Offset(140, 100));
        g.pointerMove(1, Offset(100, 100) + c.value);
        g.pointerMove(2, Offset(140, 100) + c.value);
        // дальнейшее движение того же жеста ничего не шлёт
        g.pointerMove(1, Offset(100, 100) + c.value * 2);
        g.pointerMove(2, Offset(140, 100) + c.value * 2);
        g.pointerUp(1, Offset(100, 100) + c.value * 2);
        g.pointerUp(2, Offset(140, 100) + c.value * 2);
        expect(log, ['swipe ${c.key}']);
      });
    }

    test('малое смещение двух пальцев — свайпа нет', () {
      g.pointerDown(1, const Offset(100, 100));
      g.pointerDown(2, const Offset(140, 100));
      g.pointerMove(1, const Offset(90, 100));
      g.pointerMove(2, const Offset(130, 100));
      expect(log, isEmpty);
    });

    test('после двухпальцевого жеста оставшийся палец не даёт тап/скролл', () {
      g.pointerDown(1, const Offset(100, 100));
      g.pointerDown(2, const Offset(140, 100));
      g.pointerUp(2, const Offset(140, 100));
      g.pointerMove(1, const Offset(100, 200));
      g.pointerUp(1, const Offset(100, 200));
      expect(log, isEmpty);
    });

    test('второй палец посреди скролла переключает в режим свайпа', () {
      g.pointerDown(1, const Offset(100, 100));
      g.pointerMove(1, const Offset(100, 150));
      g.pointerDown(2, const Offset(140, 150));
      g.pointerMove(1, const Offset(40, 150));
      g.pointerMove(2, const Offset(80, 150));
      expect(log, ['scroll 50', 'swipe left']);
    });
  });

  group('тап тремя пальцами (интерпретатор)', () {
    late List<String> log;
    late Duration now;
    late TerminalGestureInterpreter g;

    setUp(() {
      log = [];
      now = Duration.zero;
      g = TerminalGestureInterpreter(
        onThreeFingerTap: (p) => log.add('three ${p.dx.round()},${p.dy.round()}'),
        onTwoFingerDoubleTap: (p) => log.add('double'),
        onSwipe: (d) => log.add('swipe ${d.name}'),
        timerFactory: (d, cb) => _FakeTimer(cb),
        clock: () => now,
      );
    });

    void threeDown() {
      g.pointerDown(1, const Offset(80, 100));
      g.pointerDown(2, const Offset(120, 100));
      g.pointerDown(3, const Offset(160, 100));
    }

    void threeUp() {
      g.pointerUp(1, const Offset(80, 100));
      g.pointerUp(2, const Offset(120, 100));
      g.pointerUp(3, const Offset(160, 100));
    }

    test('короткий тап тремя пальцами — с центром пальцев', () {
      threeDown();
      now += const Duration(milliseconds: 50);
      threeUp();
      expect(log, ['three 120,100']);
    });

    test('долгое удержание тремя пальцами — не тап', () {
      threeDown();
      now += Duration(milliseconds: TerminalGestureConfig.threeFingerTapMaxMs + 50);
      threeUp();
      expect(log, isEmpty);
    });

    test('движение тремя пальцами — не тап', () {
      threeDown();
      g.pointerMove(1, const Offset(80, 60));
      g.pointerMove(2, const Offset(120, 60));
      g.pointerMove(3, const Offset(160, 60));
      now += const Duration(milliseconds: 50);
      threeUp();
      expect(log, isEmpty);
    });

    test('четвёртый палец отменяет жест', () {
      threeDown();
      g.pointerDown(4, const Offset(200, 100));
      now += const Duration(milliseconds: 50);
      threeUp();
      g.pointerUp(4, const Offset(200, 100));
      expect(log, isEmpty);
    });

    test('свайп двумя пальцами и третий палец после — не тап', () {
      g.pointerDown(1, const Offset(80, 100));
      g.pointerDown(2, const Offset(120, 100));
      g.pointerMove(1, const Offset(20, 100));
      g.pointerMove(2, const Offset(60, 100));
      g.pointerDown(3, const Offset(160, 100));
      now += const Duration(milliseconds: 50);
      g.pointerUp(1, const Offset(20, 100));
      expect(log, ['swipe left']);
    });

    test('тап двумя пальцами рядом с тапом тремя не даёт двойной тап', () {
      g.pointerDown(1, const Offset(80, 100));
      g.pointerDown(2, const Offset(120, 100));
      now += const Duration(milliseconds: 50);
      g.pointerUp(1, const Offset(80, 100));
      g.pointerUp(2, const Offset(120, 100));
      now += const Duration(milliseconds: 50);
      threeDown();
      now += const Duration(milliseconds: 50);
      threeUp();
      expect(log, ['three 120,100']);
    });
  });

  group('двойной тап двумя пальцами (интерпретатор)', () {
    late List<String> log;
    late Duration now;
    late TerminalGestureInterpreter g;

    setUp(() {
      log = [];
      now = Duration.zero;
      g = TerminalGestureInterpreter(
        onTwoFingerDoubleTap: (p) => log.add('double ${p.dx.round()},${p.dy.round()}'),
        onSwipe: (d) => log.add('swipe ${d.name}'),
        timerFactory: (d, cb) => _FakeTimer(cb),
        clock: () => now,
      );
    });

    void tap({Offset at = const Offset(100, 100), int holdMs = 50, Offset move = Offset.zero}) {
      g.pointerDown(1, at - const Offset(20, 0));
      g.pointerDown(2, at + const Offset(20, 0));
      if (move != Offset.zero) {
        g.pointerMove(1, at - const Offset(20, 0) + move);
        g.pointerMove(2, at + const Offset(20, 0) + move);
      }
      now += Duration(milliseconds: holdMs);
      g.pointerUp(1, at - const Offset(20, 0) + move);
      g.pointerUp(2, at + const Offset(20, 0) + move);
    }

    test('два быстрых тапа рядом — двойной тап с центром второго', () {
      tap();
      now += const Duration(milliseconds: 100);
      tap(at: const Offset(110, 105));
      expect(log, ['double 110,105']);
    });

    test('одиночный тап — ничего, а третий не считается продолжением пары', () {
      tap();
      expect(log, isEmpty);
      now += const Duration(milliseconds: 100);
      tap();
      now += const Duration(milliseconds: 100);
      tap();
      expect(log, ['double 100,100']);
    });

    test('вторая пара слишком поздно — не двойной', () {
      tap();
      now += Duration(milliseconds: TerminalGestureConfig.doubleTapWindowMs + 100);
      tap();
      expect(log, isEmpty);
    });

    test('вторая пара далеко — не двойной', () {
      tap();
      now += const Duration(milliseconds: 100);
      tap(at: Offset(100 + TerminalGestureConfig.doubleTapSlopPx + 40, 100));
      expect(log, isEmpty);
    });

    test('долгое удержание пальцев — не тап', () {
      tap(holdMs: TerminalGestureConfig.twoFingerTapMaxMs + 50);
      now += const Duration(milliseconds: 50);
      tap();
      expect(log, isEmpty);
    });

    test('движение пальцев — не тап (это скролл/свайп)', () {
      tap(move: const Offset(0, 25));
      now += const Duration(milliseconds: 50);
      tap(move: const Offset(0, 25));
      expect(log, isEmpty);
    });

    test('свайп двумя пальцами не считается тапом', () {
      tap(move: const Offset(-60, 0));
      now += const Duration(milliseconds: 50);
      tap();
      expect(log, ['swipe left']);
    });
  });

  group('TerminalGestureLayer', () {
    late xterm.Terminal terminal;
    late List<String> out;
    late List<String> raw;
    final viewKey = GlobalKey<xterm.TerminalViewState>();

    Future<void> pump(
      WidgetTester tester, {
      required bool isTmux,
      List<QuickCommandGroup> groups = const [],
      Future<void> Function()? onAttach,
    }) async {
      out = [];
      raw = [];
      terminal = xterm.Terminal()..onOutput = out.add;
      final controller = xterm.TerminalController();
      final scroll = ScrollController();
      addTearDown(controller.dispose);
      addTearDown(scroll.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Stack(
              fit: StackFit.expand,
              children: [
                xterm.TerminalView(
                  terminal,
                  key: viewKey,
                  controller: controller,
                  scrollController: scroll,
                ),
                TerminalGestureLayer(
                  terminal: terminal,
                  viewKey: viewKey,
                  controller: controller,
                  scrollController: scroll,
                  isTmux: isTmux,
                  write: raw.add,
                  commandGroups: groups,
                  onAttach: onAttach,
                ),
              ],
            ),
          ),
        ),
      );
      await tester.pump();
    }

    testWidgets('свайп двумя пальцами влево шлёт стрелку влево', (tester) async {
      await pump(tester, isTmux: false);
      final a = await tester.startGesture(const Offset(200, 200), pointer: 1);
      final b = await tester.startGesture(const Offset(260, 200), pointer: 2);
      await a.moveBy(const Offset(-30, 0));
      await b.moveBy(const Offset(-30, 0));
      await a.moveBy(const Offset(-30, 0));
      await b.moveBy(const Offset(-30, 0));
      await a.up();
      await b.up();
      expect(out, ['\x1b[D']);
      await tester.pump();
      expect(find.byIcon(Icons.arrow_back), findsOneWidget);
      await tester.pumpAndSettle();
    });

    Future<void> openWheel(WidgetTester tester, {Offset center = const Offset(200, 300)}) async {
      final ga = await tester.startGesture(center - const Offset(20, 0), pointer: 1);
      final gb = await tester.startGesture(center, pointer: 2);
      final gc = await tester.startGesture(center + const Offset(20, 0), pointer: 3);
      await ga.up();
      await gb.up();
      await gc.up();
      await tester.pump();
    }

    testWidgets('тап тремя пальцами открывает колесо, тап по сектору ^C шлёт Ctrl+C', (tester) async {
      await pump(tester, isTmux: false);
      await openWheel(tester);
      expect(find.byType(QuickActionWheel), findsOneWidget);
      await tester.tapAt(const Offset(200, 300 - 75));
      await tester.pumpAndSettle();
      expect(raw, ['\x03']);
      expect(find.byType(QuickActionWheel), findsNothing);
      expect(out, isEmpty);
    });

    testWidgets('тап по сектору ^D шлёт его последовательность',
        (tester) async {
      await pump(tester, isTmux: false);
      await openWheel(tester);
      expect(find.byType(QuickActionWheel), findsOneWidget);
      expect(raw, isEmpty);
      // Центр колеса (200,300); сектор ^D — индекс 4, внизу слева (угол 216° от 12 часов).
      await tester.tapAt(const Offset(200 - 55, 300 + 75));
      await tester.pumpAndSettle();
      expect(raw, ['\x04']);
      expect(find.byType(QuickActionWheel), findsNothing);
    });

    testWidgets('тап вне закреплённого колеса закрывает его и не доходит до терминала',
        (tester) async {
      await pump(tester, isTmux: false);
      terminal.write('\x1b[?1000h\x1b[?1006h');
      await openWheel(tester);
      await tester.tapAt(const Offset(20, 20));
      await tester.pumpAndSettle();
      expect(raw, isEmpty);
      expect(out, isEmpty);
      expect(find.byType(QuickActionWheel), findsNothing);
    });

    testWidgets('long-press в mouse mode шлёт TUI двойной клик, а при отпускании — up',
        (tester) async {
      await pump(tester, isTmux: false);
      terminal.write('\x1b[?1002h\x1b[?1006h');
      final g = await tester.startGesture(const Offset(100, 100), pointer: 1);
      await tester.pump(const Duration(milliseconds: 600));
      expect(out.map((e) => e.endsWith('M') ? 'd' : 'u'), ['d', 'u', 'd']);
      await g.moveBy(const Offset(60, 0));
      await tester.pump();
      expect(raw.single, startsWith('\x1b[<32;'));
      await g.up();
      await tester.pump();
      expect(out.last, endsWith('m'));
      expect(out.length, 4);
    });

    testWidgets('long-press без mouse mode выделяет слово локально', (tester) async {
      await pump(tester, isTmux: false);
      terminal.write('hello world');
      final g = await tester.startGesture(const Offset(5, 8), pointer: 1);
      await tester.pump(const Duration(milliseconds: 600));
      await g.up();
      expect(out, isEmpty);
      expect(raw, isEmpty);
    });

    testWidgets('сектор Esc шлёт \\x1b', (tester) async {
      await pump(tester, isTmux: false);
      await openWheel(tester, center: const Offset(400, 300));
      await tester.tapAt(const Offset(460, 252));
      await tester.pumpAndSettle();
      expect(raw, ['\x1b']);
    });

    testWidgets('сектор «Файл» вызывает onAttach и ничего не шлёт в канал', (tester) async {
      var attached = 0;
      await pump(tester, isTmux: false, onAttach: () async => attached++);
      await openWheel(tester, center: const Offset(400, 300));
      await tester.tapAt(const Offset(340, 252));
      await tester.pumpAndSettle();
      expect(attached, 1);
      expect(raw, isEmpty);
    });

    Future<void> twoFingerTap(WidgetTester tester) async {
      final a = await tester.startGesture(const Offset(380, 300), pointer: 1);
      final b = await tester.startGesture(const Offset(420, 300), pointer: 2);
      await a.up();
      await b.up();
      await tester.pump(const Duration(milliseconds: 20));
    }

    Future<void> openCommands(WidgetTester tester) async {
      await twoFingerTap(tester);
      await twoFingerTap(tester);
      await tester.pump();
    }

    testWidgets('двойной тап двумя пальцами: группа → команда вставляется без Enter',
        (tester) async {
      await pump(tester, isTmux: false, groups: QuickCommandsDefaults.groups);
      await openCommands(tester);
      expect(find.byType(QuickActionWheel), findsOneWidget);
      // Центр (400,300); «Команды» — сектор 1 из 3 (120° по часовой).
      await tester.tapAt(const Offset(400 + 69, 300 + 40));
      await tester.pumpAndSettle();
      expect(find.byType(QuickActionWheel), findsOneWidget);
      // «/compact» — сектор 1 из 5 (72°).
      await tester.tapAt(const Offset(400 + 76, 300 - 25));
      await tester.pumpAndSettle();
      expect(out, ['/compact']);
      expect(find.byType(QuickActionWheel), findsNothing);
    });

    testWidgets('центр на уровне команд возвращает к группам', (tester) async {
      await pump(tester, isTmux: false, groups: QuickCommandsDefaults.groups);
      await openCommands(tester);
      await tester.tapAt(const Offset(400 - 69, 300 + 40)); // «Промпты» (240°)
      await tester.pumpAndSettle();
      await tester.tapAt(const Offset(400, 300)); // назад
      await tester.pumpAndSettle();
      expect(out, isEmpty);
      expect(find.byType(QuickActionWheel), findsOneWidget);
      await tester.tapAt(const Offset(400 - 69, 300 + 40));
      await tester.pumpAndSettle();
      await tester.tapAt(const Offset(400, 220)); // «Тесты» — сектор 0
      await tester.pumpAndSettle();
      expect(out, ['Запусти тесты и исправь ошибки']);
    });

    testWidgets('тап мимо колеса команд закрывает его, не трогая терминал', (tester) async {
      await pump(tester, isTmux: false, groups: QuickCommandsDefaults.groups);
      await openCommands(tester);
      await tester.tapAt(const Offset(20, 20));
      await tester.pumpAndSettle();
      expect(find.byType(QuickActionWheel), findsNothing);
      expect(out, isEmpty);
      expect(raw, isEmpty);
    });

    testWidgets('без команд двойной тап показывает подсказку, а не колесо', (tester) async {
      await pump(tester, isTmux: false);
      await openCommands(tester);
      await tester.pump();
      expect(find.byType(QuickActionWheel), findsNothing);
      expect(find.textContaining('Нет быстрых команд'), findsOneWidget);
      await tester.pumpAndSettle(const Duration(seconds: 5));
    });

    testWidgets('тап при включённом mouse mode шлёт клик и не открывает клавиатуру',
        (tester) async {
      await pump(tester, isTmux: false);
      terminal.write('\x1b[?1000h\x1b[?1006h');
      await tester.tapAt(const Offset(100, 100));
      expect(out.length, 2);
      expect(out.first, startsWith('\x1b[<0;'));
      expect(out.first, endsWith('M'));
      expect(out.last, endsWith('m'));
    });

    testWidgets('скролл пальцем вниз в tmux шлёт WHEEL_SCROLL_UP', (tester) async {
      await pump(tester, isTmux: true);
      await tester.dragFrom(const Offset(200, 200), const Offset(0, 120));
      expect(raw, isNotEmpty);
      expect(raw.toSet(), {SshSessionConfig.wheelScrollUpSeq});
    });

    testWidgets('порог свайпа — константа из конфига', (tester) async {
      expect(TerminalGestureConfig.swipeThresholdPx, greaterThan(0));
    });
  });
}
