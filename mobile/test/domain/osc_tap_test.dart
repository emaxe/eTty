import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/domain/osc_tap.dart';

const _esc = 0x1B;
const _bel = 0x07;

/// Голая (без tmux) OSC-последовательность: `ESC ] Ps;Pt BEL`.
Uint8List _bareOsc(String psPt) =>
    Uint8List.fromList([_esc, 0x5D, ...utf8.encode(psPt), _bel]);

/// DCS-обёртка tmux-passthrough вокруг той же последовательности — ровно формат
/// `RemoteShellHooks._emitFn`: `ESC P tmux ; ESC ESC ] Ps;Pt BEL ESC \`.
Uint8List _dcsWrapped(String psPt) => Uint8List.fromList([
  _esc, 0x50, 0x74, 0x6D, 0x75, 0x78, 0x3B, // ESC P tmux;
  _esc, _esc, // экранированный литеральный ESC перед ']'
  0x5D, ...utf8.encode(psPt), _bel,
  _esc, 0x5C, // ST — конец DCS
]);

void main() {
  group('OscTap — обычный текст', () {
    test('пропускает вывод без escape-последовательностей без изменений', () {
      final tap = OscTap();
      final input = Uint8List.fromList(utf8.encode('hello\r\n\$ '));
      expect(tap.feed(input), equals(input));
    });
  });

  group('OscTap — OSC 7 (cwd)', () {
    test(
      'голый OSC 7 полностью проглатывается, путь без host и хвостового /',
      () {
        final events = <String>[];
        final tap = OscTap(onCwdChange: (p) => events.add(p));
        final input = _bareOsc('7;file:///home/user/');
        expect(tap.feed(input), isEmpty);
        expect(events, equals(['/home/user']));
      },
    );

    test('корневой путь остаётся "/"', () {
      final events = <String>[];
      final tap = OscTap(onCwdChange: (p) => events.add(p));
      tap.feed(_bareOsc('7;file:///'));
      expect(events, equals(['/']));
    });

    test('DCS-обёрнутый OSC 7 разворачивается и проглатывается', () {
      final events = <String>[];
      final tap = OscTap(onCwdChange: (p) => events.add(p));
      final input = _dcsWrapped('7;file:///srv/app');
      expect(tap.feed(input), isEmpty);
      expect(events, equals(['/srv/app']));
    });

    test('кириллица и пробелы в пути декодируются как UTF-8', () {
      final events = <String>[];
      final tap = OscTap(onCwdChange: (p) => events.add(p));
      tap.feed(_bareOsc('7;file:///home/пользователь/мои файлы'));
      expect(events, equals(['/home/пользователь/мои файлы']));
    });
  });

  group('OscTap — OSC 133 (busy)', () {
    test('C -> busy=true, A -> busy=false, повтор того же состояния не дублируется', () {
      final events = <bool>[];
      final tap = OscTap(onBusyChange: (b) => events.add(b));
      tap.feed(_bareOsc('133;C'));
      tap.feed(
        _bareOsc('133;C'),
      ); // повторный C — не фронт, не должен дать новый вызов
      tap.feed(_bareOsc('133;A'));
      tap.feed(_bareOsc('133;A'));
      expect(events, equals([true, false]));
    });

    test('DCS-обёрнутый OSC 133 работает так же, как голый', () {
      final events = <bool>[];
      final tap = OscTap(onBusyChange: (b) => events.add(b));
      tap.feed(_dcsWrapped('133;C'));
      tap.feed(_dcsWrapped('133;A'));
      expect(events, equals([true, false]));
    });
  });

  group('OscTap — OSC 52 (clipboard)', () {
    test('декодирует base64 в UTF-8 текст', () {
      final events = <String>[];
      final tap = OscTap(onClipboardWrite: (t) => events.add(t));
      final payload = base64.encode(utf8.encode('скопированный текст'));
      tap.feed(_bareOsc('52;c;$payload'));
      expect(events, equals(['скопированный текст']));
    });

    test(
      'запрос "?" игнорируется — содержимое буфера устройства не отдаётся',
      () {
        final events = <String>[];
        final tap = OscTap(onClipboardWrite: (t) => events.add(t));
        tap.feed(_bareOsc('52;c;?'));
        expect(events, isEmpty);
      },
    );

    test('пустой payload очищает буфер (пустая строка)', () {
      final events = <String>[];
      final tap = OscTap(onClipboardWrite: (t) => events.add(t));
      tap.feed(_bareOsc('52;c;'));
      expect(events, equals(['']));
    });

    test('битый base64 молча игнорируется, не бросает исключение', () {
      final events = <String>[];
      final tap = OscTap(onClipboardWrite: (t) => events.add(t));
      expect(() => tap.feed(_bareOsc('52;c;не-base64!!!')), returnsNormally);
      expect(events, isEmpty);
    });

    test('DCS-обёрнутый OSC 52 декодируется так же, как голый', () {
      final events = <String>[];
      final tap = OscTap(onClipboardWrite: (t) => events.add(t));
      final payload = base64.encode(utf8.encode('clip'));
      tap.feed(_dcsWrapped('52;c;$payload'));
      expect(events, equals(['clip']));
    });
  });

  group('OscTap — прочие OSC', () {
    test('неизвестный голый OSC (например 0 — заголовок окна) форвардится как есть', () {
      final tap = OscTap();
      final input = _bareOsc('0;my title');
      expect(tap.feed(input), equals(input));
    });

    test('неизвестный OSC внутри DCS-обёртки отбрасывается целиком (не мусорит на экран)', () {
      final tap = OscTap();
      final input = _dcsWrapped('4;1;rgb:ff/00/00');
      expect(tap.feed(input), isEmpty);
    });
  });

  group('OscTap — смешанный поток', () {
    test('обычный текст вокруг OSC остаётся, сам OSC вырезается', () {
      final events = <String>[];
      final tap = OscTap(onCwdChange: (p) => events.add(p));
      final builder = BytesBuilder()
        ..add(utf8.encode('before '))
        ..add(_bareOsc('7;file:///a'))
        ..add(utf8.encode(' after'));
      final out = tap.feed(builder.toBytes());
      expect(utf8.decode(out), equals('before  after'));
      expect(events, equals(['/a']));
    });

    test('tmux-сценарий: prompt, busy, вывод команды, снова готов', () {
      final busy = <bool>[];
      final tap = OscTap(onBusyChange: (b) => busy.add(b));
      final builder = BytesBuilder()
        ..add(_dcsWrapped('133;C'))
        ..add(utf8.encode('ls\r\nfile.txt\r\n'))
        ..add(_dcsWrapped('133;A'));
      final out = tap.feed(builder.toBytes());
      expect(utf8.decode(out), equals('ls\r\nfile.txt\r\n'));
      expect(busy, equals([true, false]));
    });
  });

  group('OscTap — склейка по границам чанков', () {
    test(
      'DCS-обёрнутый OSC 7 распознаётся при разбиении на любые два чанка',
      () {
        final full = _dcsWrapped('7;file:///split/me');
        for (var split = 0; split <= full.length; split++) {
          final events = <String>[];
          final tap = OscTap(onCwdChange: (p) => events.add(p));
          final out = BytesBuilder()
            ..add(tap.feed(full.sublist(0, split)))
            ..add(tap.feed(full.sublist(split)));
          expect(out.toBytes(), isEmpty, reason: 'split at byte $split');
          expect(events, equals(['/split/me']), reason: 'split at byte $split');
        }
      },
    );

    test('текст + голый OSC 133 + текст распознаётся при разбиении на любые два чанка', () {
      final builder = BytesBuilder()
        ..add(utf8.encode('pre-'))
        ..add(_bareOsc('133;C'))
        ..add(utf8.encode('-post'));
      final full = builder.toBytes();
      for (var split = 0; split <= full.length; split++) {
        final busy = <bool>[];
        final tap = OscTap(onBusyChange: (b) => busy.add(b));
        final out = BytesBuilder()
          ..add(tap.feed(full.sublist(0, split)))
          ..add(tap.feed(full.sublist(split)));
        expect(
          utf8.decode(out.toBytes()),
          equals('pre--post'),
          reason: 'split at byte $split',
        );
        expect(busy, equals([true]), reason: 'split at byte $split');
      }
    });

    test('поток, разбитый по одному байту за раз, даёт тот же результат, что и целиком', () {
      final builder = BytesBuilder()
        ..add(utf8.encode('start '))
        ..add(_dcsWrapped('7;file:///one'))
        ..add(utf8.encode(' mid '))
        ..add(_bareOsc('52;c;${base64.encode(utf8.encode('x'))}'))
        ..add(utf8.encode(' end'));
      final full = builder.toBytes();

      final wholeEvents = <String>[];
      final wholeTap = OscTap(
        onCwdChange: (p) => wholeEvents.add('cwd:$p'),
        onClipboardWrite: (t) => wholeEvents.add('clip:$t'),
      );
      final wholeOut = wholeTap.feed(full);

      final byteEvents = <String>[];
      final byteTap = OscTap(
        onCwdChange: (p) => byteEvents.add('cwd:$p'),
        onClipboardWrite: (t) => byteEvents.add('clip:$t'),
      );
      final byteOut = BytesBuilder();
      for (final b in full) {
        byteOut.add(byteTap.feed(Uint8List.fromList([b])));
      }

      expect(byteOut.toBytes(), equals(wholeOut));
      expect(byteEvents, equals(wholeEvents));
      expect(utf8.decode(wholeOut), equals('start  mid  end'));
      expect(wholeEvents, equals(['cwd:/one', 'clip:x']));
    });
  });

  group('OscTap — не наш DCS', () {
    test('ESC P без "tmux;" форвардится как обычный вывод (не наш DCS)', () {
      final tap = OscTap();
      final input = Uint8List.fromList([
        _esc,
        0x50,
        ...utf8.encode('other'),
        _esc,
        0x5C,
      ]);
      expect(tap.feed(input), equals(input));
    });
  });
}
