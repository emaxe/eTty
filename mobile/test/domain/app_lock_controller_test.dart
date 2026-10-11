import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/data/biometric_gate.dart';
import 'package:mobile/domain/app_lock_controller.dart';

class _FakeBiometricGate implements BiometricGate {
  bool available = true;
  bool nextResult = true;
  int authenticateCalls = 0;

  @override
  Future<bool> get isAvailable async => available;

  @override
  Future<bool> authenticate() async {
    authenticateCalls++;
    return nextResult;
  }
}

void main() {
  group('AppLockController — relock()', () {
    test('выключенная блокировка: relock() не переводит в locked', () {
      final controller = AppLockController(gate: _FakeBiometricGate());

      controller.relock();

      expect(controller.state, AppLockState.unlocked);
    });

    test('включённая блокировка: relock() переводит unlocked -> locked', () {
      final controller = AppLockController(
        gate: _FakeBiometricGate(),
        enabled: true,
      );

      controller.relock();

      expect(controller.state, AppLockState.locked);
    });

    test('setEnabled(false) отключает эффект последующих relock()', () {
      final controller = AppLockController(
        gate: _FakeBiometricGate(),
        enabled: true,
      )..setEnabled(false);

      controller.relock();

      expect(controller.state, AppLockState.unlocked);
    });
  });

  group('AppLockController — tryUnlock()', () {
    test('не заблокирован — успех без обращения к gate', () async {
      final gate = _FakeBiometricGate();
      final controller = AppLockController(gate: gate);

      final result = await controller.tryUnlock();

      expect(result, isTrue);
      expect(gate.authenticateCalls, 0);
    });

    test('заблокирован, gate подтверждает — locked -> unlocked', () async {
      final gate = _FakeBiometricGate()..nextResult = true;
      final controller = AppLockController(gate: gate, enabled: true)
        ..relock();

      final result = await controller.tryUnlock();

      expect(result, isTrue);
      expect(controller.state, AppLockState.unlocked);
      expect(gate.authenticateCalls, 1);
    });

    test('заблокирован, gate отказывает — остаётся locked', () async {
      final gate = _FakeBiometricGate()..nextResult = false;
      final controller = AppLockController(gate: gate, enabled: true)
        ..relock();

      final result = await controller.tryUnlock();

      expect(result, isFalse);
      expect(controller.state, AppLockState.locked);
    });

    test('во время authenticate() состояние — authenticating', () async {
      final gate = _FakeBiometricGate();
      final controller = AppLockController(gate: gate, enabled: true)
        ..relock();

      final future = controller.tryUnlock();
      expect(controller.state, AppLockState.authenticating);
      await future;
    });
  });

  group('AppLockController — onStateChanged', () {
    test('публикует каждый переход состояния', () async {
      final gate = _FakeBiometricGate()..nextResult = true;
      final controller = AppLockController(gate: gate, enabled: true);
      final states = <AppLockState>[];
      controller.onStateChanged.listen(states.add);

      controller.relock();
      await controller.tryUnlock();
      await Future<void>.delayed(Duration.zero);

      expect(states, [
        AppLockState.locked,
        AppLockState.authenticating,
        AppLockState.unlocked,
      ]);
      controller.dispose();
    });
  });
}
