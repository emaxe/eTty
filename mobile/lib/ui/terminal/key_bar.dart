import 'package:flutter/material.dart';

import 'package:mobile/ui/terminal/input_handler.dart';

/// Панель модификаторов над софт-клавиатурой (REQ-16) — Esc/Tab/Ctrl(залипающий)/Alt(залипающий)/
/// стрелки/PgUp/PgDn/`|-~/`/быстрые Ctrl+C/Ctrl+D/Ctrl+Z. [onSend] шлёт готовую
/// последовательность НАПРЯМУЮ в канал (`TabController.write`), минуя `terminal.onOutput` — эти
/// нажатия не «печатаемый пользователем текст», а прямая инъекция байт, как и на десктопе клавиши
/// со спецсимволами не идут через обычный ввод буфера.
class KeyBar extends StatelessWidget {
  const KeyBar({super.key, required this.sticky, required this.onSend});

  final StickyModifierController sticky;
  final void Function(String data) onSend;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<StickyModifier>(
      valueListenable: sticky,
      builder: (context, modifier, _) {
        return ColoredBox(
          color: Theme.of(context).colorScheme.surfaceContainerHighest,
          child: SizedBox(
            height: 44,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 4),
              children: [
                _KeyButton(label: 'Esc', onTap: () => onSend('\x1b')),
                _KeyButton(label: 'Tab', onTap: () => onSend('\t')),
                _KeyButton(
                  label: 'Ctrl',
                  active: modifier == StickyModifier.ctrl,
                  onTap: sticky.toggleCtrl,
                ),
                _KeyButton(
                  label: 'Alt',
                  active: modifier == StickyModifier.alt,
                  onTap: sticky.toggleAlt,
                ),
                _KeyButton(label: '↑', onTap: () => onSend('\x1b[A')),
                _KeyButton(label: '↓', onTap: () => onSend('\x1b[B')),
                _KeyButton(label: '←', onTap: () => onSend('\x1b[D')),
                _KeyButton(label: '→', onTap: () => onSend('\x1b[C')),
                _KeyButton(label: 'PgUp', onTap: () => onSend('\x1b[5~')),
                _KeyButton(label: 'PgDn', onTap: () => onSend('\x1b[6~')),
                _KeyButton(label: '|', onTap: () => onSend('|')),
                _KeyButton(label: '-', onTap: () => onSend('-')),
                _KeyButton(label: '~', onTap: () => onSend('~')),
                _KeyButton(label: '/', onTap: () => onSend('/')),
                _KeyButton(label: '^C', onTap: () => onSend('\x03')),
                _KeyButton(label: '^D', onTap: () => onSend('\x04')),
                _KeyButton(label: '^Z', onTap: () => onSend('\x1a')),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _KeyButton extends StatelessWidget {
  const _KeyButton({
    required this.label,
    required this.onTap,
    this.active = false,
  });

  final String label;
  final VoidCallback onTap;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 4),
      child: Material(
        color: active ? colorScheme.primary : colorScheme.surface,
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          borderRadius: BorderRadius.circular(6),
          onTap: onTap,
          child: Container(
            alignment: Alignment.center,
            constraints: const BoxConstraints(minWidth: 44),
            padding: const EdgeInsets.symmetric(horizontal: 10),
            child: Text(
              label,
              style: TextStyle(
                color: active ? colorScheme.onPrimary : colorScheme.onSurface,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
