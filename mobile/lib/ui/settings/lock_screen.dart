import 'package:flutter/material.dart';

import 'package:mobile/domain/app_lock_controller.dart';

/// Полноэкранная блокировка (REQ-18) — показывается `_RootShell` (`main.dart`), пока
/// [AppLockController.state] не [AppLockState.unlocked]. Сам не трогает `local_auth`/провайдеры —
/// только зовёт [AppLockController.tryUnlock].
class LockScreen extends StatelessWidget {
  const LockScreen({super.key, required this.controller});

  final AppLockController controller;

  @override
  Widget build(BuildContext context) {
    final authenticating = controller.state == AppLockState.authenticating;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.lock_outline,
                  size: 64,
                  color: Theme.of(context).colorScheme.primary,
                ),
                const SizedBox(height: 16),
                const Text('eTty заблокирован'),
                const SizedBox(height: 24),
                if (authenticating)
                  const CircularProgressIndicator()
                else
                  FilledButton.icon(
                    onPressed: controller.tryUnlock,
                    icon: const Icon(Icons.fingerprint),
                    label: const Text('Разблокировать'),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
