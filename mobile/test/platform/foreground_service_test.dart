import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/platform/foreground_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('com.etty.mobile/foreground_service');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  tearDown(() {
    messenger.setMockMethodCallHandler(channel, null);
  });

  group('ForegroundService — платформа не поддерживается', () {
    test('start()/stop() не трогают канал', () async {
      final calls = <String>[];
      messenger.setMockMethodCallHandler(channel, (call) async {
        calls.add(call.method);
        return null;
      });
      final service = ForegroundService(supported: false);

      await service.start();
      await service.stop();

      expect(calls, isEmpty);
    });
  });

  group('ForegroundService — платформа поддерживается', () {
    test('start() зовёт метод "start" канала', () async {
      final calls = <String>[];
      messenger.setMockMethodCallHandler(channel, (call) async {
        calls.add(call.method);
        return null;
      });
      final service = ForegroundService(supported: true);

      await service.start();

      expect(calls, ['start']);
    });

    test('stop() зовёт метод "stop" канала', () async {
      final calls = <String>[];
      messenger.setMockMethodCallHandler(channel, (call) async {
        calls.add(call.method);
        return null;
      });
      final service = ForegroundService(supported: true);

      await service.stop();

      expect(calls, ['stop']);
    });

    test('ошибка канала не пробрасывается наружу (best-effort)', () async {
      messenger.setMockMethodCallHandler(channel, (call) async {
        throw PlatformException(code: 'boom');
      });
      final service = ForegroundService(supported: true);

      await expectLater(service.start(), completes);
    });
  });
}
