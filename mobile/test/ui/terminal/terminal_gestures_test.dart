import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/config/ssh_session_config.dart';
import 'package:mobile/core/config/terminal_gesture_config.dart';
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

  group('TerminalGestureLayer', () {
    late xterm.Terminal terminal;
    late List<String> out;
    late List<String> raw;
    final viewKey = GlobalKey<xterm.TerminalViewState>();

    Future<void> pump(WidgetTester tester, {required bool isTmux}) async {
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
