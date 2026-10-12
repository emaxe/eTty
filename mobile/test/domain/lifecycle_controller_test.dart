import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/domain/lifecycle_controller.dart';
import 'package:mobile/remote/remote_scripts.dart';
import 'package:mobile/transport/exec_channel.dart';

Uint8List _bytes(String s) => Uint8List.fromList(utf8.encode(s));

ExecResult _ok(String stdout) => ExecResult(
  exitCode: 0,
  stdout: _bytes(stdout),
  stderr: Uint8List(0),
  timedOut: false,
);

ExecResult _fail(int exitCode) => ExecResult(
  exitCode: exitCode,
  stdout: Uint8List(0),
  stderr: Uint8List(0),
  timedOut: false,
);

class _FakeRemoteExec implements RemoteExec {
  final List<({String script, List<String> args})> calls = [];
  ExecResult Function(String script, List<String> args) responder = (_, _) =>
      _ok('');

  @override
  Future<ExecResult> exec(
    String script,
    List<String> args, {
    Uint8List? stdin,
    Duration timeout = const Duration(milliseconds: 15000),
    int maxBufferBytes = 8 * 1024 * 1024,
  }) async {
    calls.add((script: script, args: args));
    return responder(script, args);
  }
}

class _FakeLifecycleTab implements LifecycleTab {
  _FakeLifecycleTab({this.isTmux = true, this.sessionName = 'etty-abc12345'});

  @override
  final bool isTmux;

  @override
  final String? sessionName;

  int detachCalls = 0;
  int reattachCalls = 0;
  int clearCalls = 0;
  final List<({String? path, bool? busy})> applied = [];

  @override
  Future<void> detach() async {
    detachCalls++;
  }

  @override
  Future<void> reattach() async {
    reattachCalls++;
  }

  @override
  void clearLocalBuffer() {
    clearCalls++;
  }

  @override
  void applyResyncedState({String? path, bool? busy}) {
    applied.add((path: path, busy: busy));
  }
}

void main() {
  group('LifecycleController — grace period', () {
    test('resume до истечения grace-таймера не детачит вкладку', () async {
      final tab = _FakeLifecycleTab();
      final controller = LifecycleController(
        exec: _FakeRemoteExec(),
        graceDuration: const Duration(milliseconds: 30),
      )..register(tab);

      controller.onPaused();
      await Future<void>.delayed(const Duration(milliseconds: 10));
      controller.onResumed();
      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(tab.detachCalls, 0);
      expect(tab.reattachCalls, 0);
      controller.dispose();
    });

    test('resume после истечения grace-таймера детачит, потом реаттачит', () async {
      final tab = _FakeLifecycleTab(isTmux: false, sessionName: null);
      final controller = LifecycleController(
        exec: _FakeRemoteExec(),
        graceDuration: const Duration(milliseconds: 10),
      )..register(tab);

      controller.onPaused();
      await Future<void>.delayed(const Duration(milliseconds: 30));
      expect(tab.detachCalls, 1);

      controller.onResumed();
      await Future<void>.delayed(const Duration(milliseconds: 10));

      expect(tab.reattachCalls, 1);
      controller.dispose();
    });

    test('повторный onPaused() пока ждём grace — не запускает второй таймер', () async {
      final tab = _FakeLifecycleTab();
      final controller = LifecycleController(
        exec: _FakeRemoteExec(),
        graceDuration: const Duration(milliseconds: 20),
      )..register(tab);

      controller.onPaused();
      controller.onPaused();
      await Future<void>.delayed(const Duration(milliseconds: 40));

      expect(tab.detachCalls, 1);
      controller.dispose();
    });
  });

  group('LifecycleController — реаттач tmux-вкладки', () {
    test(
      'перед reattach() очищает локальный буфер (риск дублирования содержимого)',
      () async {
        final tab = _FakeLifecycleTab();
        final controller = LifecycleController(
          exec: _FakeRemoteExec(),
          graceDuration: Duration.zero,
        )..register(tab);

        controller.onPaused();
        await Future<void>.delayed(const Duration(milliseconds: 5));
        controller.onResumed();
        await Future<void>.delayed(const Duration(milliseconds: 5));

        expect(tab.clearCalls, 1);
        expect(tab.reattachCalls, 1);
        controller.dispose();
      },
    );

    test('не-tmux вкладка не чистит буфер и не делает ресинк-exec', () async {
      final tab = _FakeLifecycleTab(isTmux: false, sessionName: null);
      final fake = _FakeRemoteExec();
      final controller = LifecycleController(
        exec: fake,
        graceDuration: Duration.zero,
      )..register(tab);

      controller.onPaused();
      await Future<void>.delayed(const Duration(milliseconds: 5));
      controller.onResumed();
      await Future<void>.delayed(const Duration(milliseconds: 5));

      expect(tab.clearCalls, 0);
      expect(fake.calls, isEmpty);
      controller.dispose();
    });

    test(
      'ресинк запрашивает TMUX_SESSION_STATE_SCRIPT с [socket, sessionName]',
      () async {
        final tab = _FakeLifecycleTab(sessionName: 'etty-abc12345');
        final fake = _FakeRemoteExec()
          ..responder = (_, _) => _ok('/home/u|/home/u|-bash');
        final controller = LifecycleController(
          exec: fake,
          socketName: 'etty',
          graceDuration: Duration.zero,
        )..register(tab);

        controller.onPaused();
        await Future<void>.delayed(const Duration(milliseconds: 5));
        controller.onResumed();
        await Future<void>.delayed(const Duration(milliseconds: 5));

        expect(fake.calls.single.script, RemoteScripts.tmuxSessionStateScript);
        expect(fake.calls.single.args, ['etty', 'etty-abc12345']);
        controller.dispose();
      },
    );

    test('успешный ресинк применяет path, login-shell не помечает busy', () async {
      final tab = _FakeLifecycleTab();
      final fake = _FakeRemoteExec()
        ..responder = (_, _) => _ok('/home/u|/home/u|-bash');
      final controller = LifecycleController(
        exec: fake,
        graceDuration: Duration.zero,
      )..register(tab);

      controller.onPaused();
      await Future<void>.delayed(const Duration(milliseconds: 5));
      controller.onResumed();
      await Future<void>.delayed(const Duration(milliseconds: 5));

      expect(tab.applied.single.path, '/home/u');
      expect(tab.applied.single.busy, isNull);
      controller.dispose();
    });

    test('команда не похожа на shell -> busy: true', () async {
      final tab = _FakeLifecycleTab();
      final fake = _FakeRemoteExec()
        ..responder = (_, _) => _ok('/home/u|/home/u|vim');
      final controller = LifecycleController(
        exec: fake,
        graceDuration: Duration.zero,
      )..register(tab);

      controller.onPaused();
      await Future<void>.delayed(const Duration(milliseconds: 5));
      controller.onResumed();
      await Future<void>.delayed(const Duration(milliseconds: 5));

      expect(tab.applied.single.busy, isTrue);
      controller.dispose();
    });

    test('currentPath пуст -> используется pathFromOsc', () async {
      final tab = _FakeLifecycleTab();
      final fake = _FakeRemoteExec()
        ..responder = (_, _) => _ok('|/home/from-osc|-zsh');
      final controller = LifecycleController(
        exec: fake,
        graceDuration: Duration.zero,
      )..register(tab);

      controller.onPaused();
      await Future<void>.delayed(const Duration(milliseconds: 5));
      controller.onResumed();
      await Future<void>.delayed(const Duration(milliseconds: 5));

      expect(tab.applied.single.path, '/home/from-osc');
      controller.dispose();
    });

    test('пустой вывод ресинка (сессии нет) -> applyResyncedState не вызывается', () async {
      final tab = _FakeLifecycleTab();
      final fake = _FakeRemoteExec()..responder = (_, _) => _ok('');
      final controller = LifecycleController(
        exec: fake,
        graceDuration: Duration.zero,
      )..register(tab);

      controller.onPaused();
      await Future<void>.delayed(const Duration(milliseconds: 5));
      controller.onResumed();
      await Future<void>.delayed(const Duration(milliseconds: 5));

      expect(tab.applied, isEmpty);
      controller.dispose();
    });

    test('ненулевой exit ресинка проглатывается — reattach не падает', () async {
      final tab = _FakeLifecycleTab();
      final fake = _FakeRemoteExec()..responder = (_, _) => _fail(1);
      final controller = LifecycleController(
        exec: fake,
        graceDuration: Duration.zero,
      )..register(tab);

      controller.onPaused();
      await Future<void>.delayed(const Duration(milliseconds: 5));
      controller.onResumed();
      await Future<void>.delayed(const Duration(milliseconds: 5));

      expect(tab.applied, isEmpty);
      expect(tab.reattachCalls, 1);
      controller.dispose();
    });
  });

  group('LifecycleController — register/unregister', () {
    test('unregister() исключает вкладку из следующих циклов', () async {
      final tab = _FakeLifecycleTab();
      final controller = LifecycleController(
        exec: _FakeRemoteExec(),
        graceDuration: Duration.zero,
      )..register(tab);
      controller.unregister(tab);

      controller.onPaused();
      await Future<void>.delayed(const Duration(milliseconds: 5));
      controller.onResumed();
      await Future<void>.delayed(const Duration(milliseconds: 5));

      expect(tab.detachCalls, 0);
      expect(tab.reattachCalls, 0);
      controller.dispose();
    });

    test('несколько вкладок детачатся и реаттачатся независимо', () async {
      final tabA = _FakeLifecycleTab(sessionName: 'etty-aaaaaaaa');
      final tabB = _FakeLifecycleTab(sessionName: 'etty-bbbbbbbb');
      final fake = _FakeRemoteExec()
        ..responder = (_, _) => _ok('/x|/x|-bash');
      final controller = LifecycleController(
        exec: fake,
        graceDuration: Duration.zero,
      )
        ..register(tabA)
        ..register(tabB);

      controller.onPaused();
      await Future<void>.delayed(const Duration(milliseconds: 5));
      expect(tabA.detachCalls, 1);
      expect(tabB.detachCalls, 1);

      controller.onResumed();
      await Future<void>.delayed(const Duration(milliseconds: 5));

      expect(tabA.reattachCalls, 1);
      expect(tabB.reattachCalls, 1);
      expect(fake.calls, hasLength(2));
      controller.dispose();
    });
  });

  group('LifecycleController — dispose', () {
    test('dispose() отменяет ожидающий grace-таймер', () async {
      final tab = _FakeLifecycleTab();
      final controller = LifecycleController(
        exec: _FakeRemoteExec(),
        graceDuration: const Duration(milliseconds: 10),
      )..register(tab);

      controller.onPaused();
      controller.dispose();
      await Future<void>.delayed(const Duration(milliseconds: 30));

      expect(tab.detachCalls, 0);
    });
  });
}
