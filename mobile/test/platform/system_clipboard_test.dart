import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/platform/system_clipboard.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final calls = <MethodCall>[];

  void mockPlatform(Future<Object?> Function(MethodCall call) handler) {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) {
      calls.add(call);
      return handler(call);
    });
  }

  setUp(calls.clear);
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null);
  });

  test('readSystemClipboard возвращает текст из платформенного канала', () async {
    mockPlatform((call) async => {'text': 'hello'});
    expect(await readSystemClipboard(), 'hello');
    expect(calls.single.method, 'Clipboard.getData');
  });

  test('readSystemClipboard: пустой ответ платформы — null', () async {
    mockPlatform((call) async => null);
    expect(await readSystemClipboard(), isNull);
  });

  test('writeSystemClipboard пишет текст через Clipboard.setData', () async {
    mockPlatform((call) async => null);
    await writeSystemClipboard('bye');
    expect(calls.single.method, 'Clipboard.setData');
    expect(calls.single.arguments, {'text': 'bye'});
  });

  test('writeSystemClipboard: PlatformException не пробрасывается', () async {
    mockPlatform((call) async => throw PlatformException(code: 'boom'));
    await expectLater(writeSystemClipboard('x'), completes);
  });

  test('writeSystemClipboard возвращает true при успешной записи', () async {
    mockPlatform((call) async => null);
    expect(await writeSystemClipboard('x'), isTrue);
  });

  test('writeSystemClipboard возвращает false при ошибке платформы и пишет лог', () async {
    final logs = <String>[];
    final original = debugPrint;
    debugPrint = (message, {wrapWidth}) => logs.add(message ?? '');
    addTearDown(() => debugPrint = original);
    mockPlatform((call) async => throw PlatformException(code: 'boom'));

    expect(await writeSystemClipboard('x'), isFalse);
    expect(logs.single, contains('буфер'));
  });

  test('readSystemClipboard: PlatformException — null', () async {
    mockPlatform((call) async => throw PlatformException(code: 'boom'));
    expect(await readSystemClipboard(), isNull);
  });
}
