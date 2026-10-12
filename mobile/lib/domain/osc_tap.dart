import 'dart:convert';
import 'dart:typed_data';

const int _esc = 0x1B;
const int _bel = 0x07;
const int _backslash = 0x5C; // '\'
const int _oscOpener = 0x5D; // ']'

enum _RawMode { ground, matchingPrefix, dcsBody, dcsBodyEsc }

enum _OscMode { ground, groundEsc, oscBody, oscBodyEsc }

/// Перехватывает вывод SSH-сессии ДО `terminal.write()`: разворачивает DCS-обёртку
/// tmux-passthrough (`\x1bPtmux;\x1b\x1b<payload>\x1b\\`, включаемую `allow-passthrough on` —
/// см. `RemoteShellHooks._emitFn`/tmux.conf) и вынимает OSC 7 (cwd), OSC 133 (busy) и OSC 52
/// (clipboard). Обязательная часть архитектуры (не защитный дефолт) — спайком S1
/// (`docs/plans/mob/plan.md`) подтверждено, что `xterm.dart` не поддерживает DCS-passthrough
/// вообще: неизвестный esc-код уходит в no-op, а байты payload печатаются на экран как обычный
/// текст при каждом промпте в tmux-режиме.
///
/// OSC 7/133/52 перехватываются в ОБОИХ случаях, которые эмитит `RemoteShellHooks._emitFn`:
/// обёрнутые в DCS (`persistence: 'tmux'`, REQ-10) и «голые» (обычный SSH-режим, `$TMUX` пуст).
/// Любой другой OSC (например 0/1/2 — заголовок окна, которые `xterm.dart` и так умеет
/// показывать нативно, см. S1) forward'ится в выход без изменений, ЕСЛИ он пришёл не изнутри
/// DCS-обёртки — содержимое DCS предполагается состоящим только из наших/tmux'овых
/// passthrough-последовательностей, случайный прочий OSC внутри нёё отбрасывается, а не
/// печатается как есть (иначе вернулась бы та же проблема видимого мусора, от которой класс
/// защищает).
///
/// Реализация — единый инкрементальный байтовый автомат (два слоя: раскрытие DCS и извлечение
/// OSC), переживающий разрыв любой последовательности на границе сетевых чанков — состояние
/// хранится в полях экземпляра между вызовами [feed].
///
/// REQ-13.
class OscTap {
  OscTap({this.onCwdChange, this.onBusyChange, this.onClipboardWrite});

  /// Новый рабочий каталог (`OSC 7`), уже без `file://<host>` и без хвостового `/`.
  final void Function(String path)? onCwdChange;

  /// Смена busy-состояния (`OSC 133`: `C` — команда стартовала, `A` — промпт снова готов).
  /// Вызывается только по фронту изменения, как `TerminalOscHandler` на десктопе.
  final void Function(bool busy)? onBusyChange;

  /// Текст из `OSC 52` (clipboard), уже декодированный из `<spec>;<base64>`. Запрос чтения
  /// локального клипборда (`Pt == '?'`) игнорируется — как на десктопе, содержимое буфера
  /// устройства наружу не отдаётся.
  final void Function(String text)? onClipboardWrite;

  // --- Слой A: раскрытие DCS-обёртки tmux (сырые байты -> логические байты) ---

  static const List<int> _dcsPrefix = [
    0x1B,
    0x50,
    0x74,
    0x6D,
    0x75,
    0x78,
    0x3B,
  ]; // ESC P tmux;

  _RawMode _rawMode = _RawMode.ground;
  int _matchIndex = 0;

  // --- Слой B: извлечение OSC 7/133/52 из логического потока байт ---

  _OscMode _oscMode = _OscMode.ground;
  bool _groundEscInsideDcs = false;
  bool _oscInsideDcs = false;
  final List<int> _oscBuffer = [];
  bool _wasBusy = false;

  late BytesBuilder _out;

  /// Пропускает один чанк вывода через оба слоя, возвращает байты для `terminal.write()`
  /// (может быть пустым, если чанк целиком — служебные последовательности). Побочные эффекты
  /// ([onCwdChange]/[onBusyChange]/[onClipboardWrite]) вызываются синхронно по ходу разбора.
  Uint8List feed(Uint8List chunk) {
    _out = BytesBuilder(copy: false);
    for (final b in chunk) {
      _consumeRaw(b);
    }
    return _out.toBytes();
  }

  /// Оборачивает поток вывода `ShellSession.output` — использовать перед `terminal.write()`.
  Stream<Uint8List> attach(Stream<Uint8List> source) => source.map(feed);

  void _consumeRaw(int b) {
    switch (_rawMode) {
      case _RawMode.ground:
        if (b == _dcsPrefix[0]) {
          _matchIndex = 1;
          _rawMode = _RawMode.matchingPrefix;
        } else {
          _feedLogical(b, insideDcs: false);
        }
        break;

      case _RawMode.matchingPrefix:
        if (b == _dcsPrefix[_matchIndex]) {
          _matchIndex++;
          if (_matchIndex == _dcsPrefix.length) {
            _rawMode = _RawMode.dcsBody;
          }
        } else if (b == _dcsPrefix[0]) {
          // Не наш DCS, но текущий байт сам ESC — сбрасываем накопленное как обычный вывод и
          // начинаем сопоставление заново с этого ESC (иначе потеряли бы реальную границу).
          for (var i = 0; i < _matchIndex; i++) {
            _feedLogical(_dcsPrefix[i], insideDcs: false);
          }
          _matchIndex = 1;
        } else {
          for (var i = 0; i < _matchIndex; i++) {
            _feedLogical(_dcsPrefix[i], insideDcs: false);
          }
          _feedLogical(b, insideDcs: false);
          _rawMode = _RawMode.ground;
        }
        break;

      case _RawMode.dcsBody:
        if (b == _esc) {
          _rawMode = _RawMode.dcsBodyEsc;
        } else {
          _feedLogical(b, insideDcs: true);
        }
        break;

      case _RawMode.dcsBodyEsc:
        if (b == _esc) {
          // Удвоенный ESC — экранирование одного литерального ESC внутри payload.
          _feedLogical(_esc, insideDcs: true);
          _rawMode = _RawMode.dcsBody;
        } else if (b == _backslash) {
          // ST — конец DCS-обёртки; сам терминатор в логический поток не идёт.
          _rawMode = _RawMode.ground;
        } else {
          // Ни удвоение, ни терминатор — считаем предыдущий ESC буквальным (защитный разбор
          // на случай испорченного потока) и обрабатываем текущий байт как обычный payload.
          _feedLogical(_esc, insideDcs: true);
          _feedLogical(b, insideDcs: true);
          _rawMode = _RawMode.dcsBody;
        }
        break;
    }
  }

  void _feedLogical(int b, {required bool insideDcs}) {
    switch (_oscMode) {
      case _OscMode.ground:
        if (b == _esc) {
          _groundEscInsideDcs = insideDcs;
          _oscMode = _OscMode.groundEsc;
        } else if (!insideDcs) {
          _out.addByte(b);
        }
        // insideDcs && b != ESC — байт вне OSC внутри DCS-обёртки не ожидается, отбрасывается.
        break;

      case _OscMode.groundEsc:
        if (b == _oscOpener) {
          _oscBuffer.clear();
          _oscInsideDcs = _groundEscInsideDcs;
          _oscMode = _OscMode.oscBody;
        } else {
          if (!_groundEscInsideDcs) {
            _out.addByte(_esc);
            _out.addByte(b);
          }
          _oscMode = _OscMode.ground;
        }
        break;

      case _OscMode.oscBody:
        if (b == _bel) {
          _finishOsc(const [_bel]);
        } else if (b == _esc) {
          _oscMode = _OscMode.oscBodyEsc;
        } else {
          _oscBuffer.add(b);
        }
        break;

      case _OscMode.oscBodyEsc:
        if (b == _backslash) {
          _finishOsc(const [_esc, _backslash]);
        } else {
          // Не ST — обрываем незавершённый OSC без диспатча (данные битые/неполные) и
          // обрабатываем текущий байт заново с чистого состояния.
          _oscBuffer.clear();
          _oscMode = _OscMode.ground;
          _feedLogical(b, insideDcs: insideDcs);
        }
        break;
    }
  }

  void _finishOsc(List<int> terminator) {
    final content = utf8.decode(_oscBuffer, allowMalformed: true);
    final sep = content.indexOf(';');
    final ps = sep == -1 ? content : content.substring(0, sep);
    final pt = sep == -1 ? '' : content.substring(sep + 1);
    switch (ps) {
      case '7':
        _handleCwd(pt);
        break;
      case '133':
        _handleBusy(pt);
        break;
      case '52':
        _handleClipboard(pt);
        break;
      default:
        if (!_oscInsideDcs) {
          _out.addByte(_esc);
          _out.addByte(_oscOpener);
          _out.add(_oscBuffer);
          _out.add(terminator);
        }
    }
    _oscBuffer.clear();
    _oscMode = _OscMode.ground;
  }

  /// `Pt` вида `file://<host><path>` (`RemoteShellHooks`: `host` всегда пуст — `printf
  /// "]7;file://%s" "$PWD"`, но десктопный формат допускает и непустой, поэтому парсер, как и
  /// `terminal-osc-handler.js`, хост игнорирует и берёт всё после него).
  void _handleCwd(String pt) {
    final match = RegExp(r'^file://[^/]*(.+)$').firstMatch(pt);
    if (match == null) return;
    var path = match.group(1)!;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.substring(0, path.length - 1);
    }
    onCwdChange?.call(path);
  }

  void _handleBusy(String pt) {
    final isBusy = pt.startsWith('C');
    final isDone = pt.startsWith('A');
    if (!isBusy && !isDone) return;
    if (_wasBusy != isBusy) {
      _wasBusy = isBusy;
      onBusyChange?.call(isBusy);
    }
  }

  /// `Pt` вида `<clipboard-spec>;<base64>` — формат OSC 52. Некорректный base64/UTF-8
  /// игнорируется молча, как в `terminal-osc-handler.js` (try/catch без пробрасывания).
  void _handleClipboard(String pt) {
    final sep = pt.indexOf(';');
    if (sep == -1) return;
    final b64 = pt.substring(sep + 1);
    if (b64 == '?') return;
    if (b64.isEmpty) {
      onClipboardWrite?.call('');
      return;
    }
    try {
      final text = utf8.decode(base64.decode(b64));
      onClipboardWrite?.call(text);
    } catch (_) {
      // Некорректный base64/UTF-8 — молча игнорируем.
    }
  }
}
