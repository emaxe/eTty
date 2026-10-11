import 'package:dartssh2/dartssh2.dart'
    show SSHUserInfoRequest, SSHUserInfoPrompt;
import 'package:flutter/material.dart';

import 'package:mobile/data/connection_store.dart';
import 'package:mobile/data/known_hosts_store.dart';
import 'package:mobile/transport/host_keys.dart';
import 'package:mobile/transport/ssh_connection.dart';

/// Общая логика установления [SshConnection] для профиля — маппинг credentials, TOFU-диалог
/// host key (REQ-8), keyboard-interactive-диалог (REQ-7). Используется везде, где нужно живое
/// подключение к профилю: экраном терминала (задача #22), панелью сессий сервера (#25), деревом
/// удалённых файлов (#26) — раньше жила только внутри `TerminalPage`, вынесена сюда, чтобы не
/// плодить три чуть разные копии одного и того же диалога.
SshCredentials sshCredentialsFor(
  BuildContext context,
  SshAuthType authType,
  ConnectionSecrets secrets,
) {
  switch (authType) {
    case SshAuthType.password:
      return SshCredentials(password: secrets.password);
    case SshAuthType.privateKey:
      return SshCredentials(
        privateKeyPem: secrets.privateKeyPem,
        privateKeyPassphrase: secrets.passphrase,
      );
    case SshAuthType.keyboardInteractive:
      return SshCredentials(
        keyboardInteractivePrompt: (request) =>
            promptKeyboardInteractiveDialog(context, request),
      );
  }
}

/// TOFU-диалог (REQ-8): показывает отпечаток НОВОГО ключа, ждёт решения пользователя. `false`,
/// если экран уже закрыт (ушли со страницы, пока ждали ответа) — как явный отказ.
Future<bool> confirmNewHostKeyDialog(
  BuildContext context,
  HostKeyCheckResult result,
) async {
  if (!context.mounted) return false;
  final trusted = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (context) => AlertDialog(
      title: const Text('Неизвестный host key'),
      content: Text(
        '${result.host}:${result.port} (${result.keyType})\n\n'
        '${result.fingerprint}\n\n'
        'Доверять этому ключу и запомнить его?',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Отмена'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('Доверять'),
        ),
      ],
    ),
  );
  return trusted ?? false;
}

/// Keyboard-interactive-диалог (REQ-7) — `null`, если экран уже закрыт, что `SshCredentials`
/// трактует как «пропустить этот метод аутентификации» (см. докстринг
/// `SshConnection.KeyboardInteractivePrompt`).
Future<List<String>?> promptKeyboardInteractiveDialog(
  BuildContext context,
  SSHUserInfoRequest request,
) async {
  if (!context.mounted) return null;
  return showDialog<List<String>>(
    context: context,
    barrierDismissible: false,
    builder: (context) => KeyboardInteractiveDialog(request: request),
  );
}

/// Устанавливает [SshConnection] для [profile]: собирает credentials из [secrets] (никогда не
/// хранится дольше вызова — REQ-18), подключается через [knownHosts] с TOFU-подтверждением через
/// диалоги поверх [context]. Бросает [SshConnectException] при неудаче (см. `SshConnection.connect`) —
/// вызывающая сторона решает, как показать ошибку.
Future<SshConnection> connectForProfile({
  required BuildContext context,
  required ConnectionProfile profile,
  required ConnectionSecrets secrets,
  required KnownHostsStore knownHosts,
}) async {
  final connection = SshConnection(
    host: profile.host,
    port: profile.port,
    username: profile.username,
    credentials: sshCredentialsFor(context, profile.authType, secrets),
    knownHostsStore: knownHosts,
    onNewHostKey: (result) => confirmNewHostKeyDialog(context, result),
  );
  await connection.connect();
  return connection;
}

/// Диалог keyboard-interactive аутентификации (REQ-7) — по одному текстовому полю на каждый
/// [SSHUserInfoPrompt], `obscureText` при `echo == false` (пароль/2FA-код).
class KeyboardInteractiveDialog extends StatefulWidget {
  const KeyboardInteractiveDialog({super.key, required this.request});

  final SSHUserInfoRequest request;

  @override
  State<KeyboardInteractiveDialog> createState() =>
      _KeyboardInteractiveDialogState();
}

class _KeyboardInteractiveDialogState extends State<KeyboardInteractiveDialog> {
  late final List<TextEditingController> _controllers = [
    for (final _ in widget.request.prompts) TextEditingController(),
  ];

  @override
  void dispose() {
    for (final c in _controllers) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(
        widget.request.name.isNotEmpty ? widget.request.name : 'Аутентификация',
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (widget.request.instruction.isNotEmpty)
            Text(widget.request.instruction),
          for (var i = 0; i < widget.request.prompts.length; i++)
            TextField(
              controller: _controllers[i],
              obscureText: !widget.request.prompts[i].echo,
              autofocus: i == 0,
              decoration: InputDecoration(
                labelText: widget.request.prompts[i].promptText,
              ),
            ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(null),
          child: const Text('Отмена'),
        ),
        FilledButton(
          onPressed: () =>
              Navigator.of(context).pop([for (final c in _controllers) c.text]),
          child: const Text('Отправить'),
        ),
      ],
    );
  }
}
