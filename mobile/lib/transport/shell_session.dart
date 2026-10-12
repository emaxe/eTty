// Интерактивная PTY-вкладка — аналог PtyManager с десктопа (src/main/pty-manager.js), но канал
// SSHClient вместо отдельного процесса `ssh`. remoteCommand строит
// RemoteShellHooks.buildRemoteInitCommand() (задача #6) — этот класс НЕ знает про tmux/hooks,
// только исполняет уже готовую remote-команду с PTY (см. таблицу «Замена ControlMaster» и
// спайк S2 в docs/plans/mob/plan.md: execute()+pty подтверждён как эквивалент `ssh -tt`).

import 'dart:async';
import 'dart:typed_data';

import 'package:dartssh2/dartssh2.dart';

import 'package:mobile/transport/ssh_connection.dart';

/// Одна интерактивная PTY-сессия (вкладка терминала) на канале [SshClientSource.client].
/// Жизненный цикл: [ShellSession.start] открывает канал сразу с PTY нужного размера; [write]/
/// [resize] управляют им; [done] завершается при закрытии канала (детач tmux-сессии, обрыв
/// соединения или выход shell) — вызывающая сторона (`TabController`, задача #19) решает по
/// [exitCode]/[exitSignalName], что это значило (штатный выход / перехват сессии другим
/// клиентом / обрыв).
class ShellSession {
  ShellSession._(this._session, this.remoteCommand);

  final SSHSession _session;

  /// Remote-команда, которой был открыт канал — для диагностики (не переисполняется этим
  /// классом; повторное подключение строит новую команду и новый `ShellSession`).
  final String remoteCommand;

  /// Открывает канал с PTY нужного размера и исполняет [remoteCommand] (уже готовая строка от
  /// `RemoteShellHooks.buildRemoteInitCommand`). `type: 'xterm-256color'` — фиксированный тип
  /// терминала, тот же, что явно выставляет `remote-shell-hooks.js`'s `tmux.conf` через
  /// `default-terminal`/`terminal-features RGB` на самой удалённой стороне; здесь это лишь то,
  /// что видит sshd при выделении PTY (`$TERM` внутри).
  static Future<ShellSession> start({
    required SshClientSource clientSource,
    required String remoteCommand,
    required int cols,
    required int rows,
  }) async {
    final session = await clientSource.client.execute(
      remoteCommand,
      pty: SSHPtyConfig(type: 'xterm-256color', width: cols, height: rows),
    );
    return ShellSession._(session, remoteCommand);
  }

  Stream<Uint8List>? _output;

  /// Вывод процесса. При выделенном PTY сервер обычно не использует stderr отдельно (dartssh2:
  /// «may be empty if the remote process is started in pseudo terminal»), но оба потока
  /// объединяются на случай приложений, которые всё же пишут в stderr явно — терминалу всё
  /// равно, откуда пришли байты, лишь бы не потерялись и не переупорядочились относительно
  /// СВОЕГО источника (гарантия merge ниже — только это, не глобальный порядок между потоками).
  Stream<Uint8List> get output => _output ??= _mergeStreams(_session.stdout, _session.stderr);

  /// Пишет ввод пользователя в PTY. Не закрывает stdin — в отличие от `ExecChannel.exec()`,
  /// интерактивная сессия держит stdin открытым всё время жизни вкладки.
  void write(Uint8List data) => _session.write(data);

  /// Сообщает удалённой стороне новый размер терминала (SIGWINCH) — подтверждено спайком S2:
  /// реально долетает до сервера и отражается в `stty size`.
  void resize(int cols, int rows) => _session.resizeTerminal(cols, rows);

  /// Код возврата процесса — `null`, пока сессия не завершилась, либо если удалённая сторона
  /// не сообщила код (завершение сигналом, обрыв соединения). На tmux-вкладке `exitCode == 0`
  /// при `persistence:'tmux'` означает «сессию перехватил другой клиент» (`new-session -A -D`
  /// отцепляет прежнего) — интерпретация на стороне `TabController` (задача #19), не здесь.
  int? get exitCode => _session.exitCode;

  /// Имя сигнала (без `SIG`), которым завершился процесс — `null`, если не сигналом.
  String? get exitSignalName => _session.exitSignal?.signalName;

  /// Завершается при закрытии канала — конец сессии (штатный выход, детач, обрыв соединения).
  Future<void> get done => _session.done;

  /// Закрывает канал. На tmux-вкладке это ДЕТАЧ (сервер держит сессию живой), а не kill —
  /// ровно как закрытие PTY-вкладки на десктопе (см. `docs/plans/mob/plan.md`, REQ-11).
  void close() => _session.close();
}

/// Совмещает два потока байт в один, ничего не переупорядочивая ВНУТРИ каждого исходного
/// потока — закрывается, когда закрылись оба. Не тянет `package:async` ради одной функции.
Stream<Uint8List> _mergeStreams(Stream<Uint8List> a, Stream<Uint8List> b) {
  late final StreamController<Uint8List> controller;
  StreamSubscription<Uint8List>? subA;
  StreamSubscription<Uint8List>? subB;
  var aDone = false;
  var bDone = false;

  void maybeClose() {
    if (aDone && bDone) controller.close();
  }

  controller = StreamController<Uint8List>(
    onListen: () {
      subA = a.listen(
        controller.add,
        onError: controller.addError,
        onDone: () {
          aDone = true;
          maybeClose();
        },
      );
      subB = b.listen(
        controller.add,
        onError: controller.addError,
        onDone: () {
          bDone = true;
          maybeClose();
        },
      );
    },
    onCancel: () async {
      await subA?.cancel();
      await subB?.cancel();
    },
  );
  return controller.stream;
}
