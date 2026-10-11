import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:mobile/app/providers/connection_providers.dart';
import 'package:mobile/data/connection_store.dart';

/// Форма добавления/редактирования профиля (задача #21). `initial == null` — режим добавления,
/// новый `id` генерируется здесь же; иначе — редактирование существующего профиля.
///
/// Секретные поля (пароль/ключ/passphrase) при редактировании намеренно не предзаполняются
/// значением из secure storage — плейсхолдер «оставить как есть» вместо этого, а `saveSecrets`
/// вызывается только если пользователь реально что-то ввёл (REQ-18: не гонять секрет в открытом
/// виде туда-сюда без необходимости).
class ConnectionFormScreen extends ConsumerStatefulWidget {
  const ConnectionFormScreen({super.key, this.initial});

  final ConnectionProfile? initial;

  @override
  ConsumerState<ConnectionFormScreen> createState() =>
      _ConnectionFormScreenState();
}

class _ConnectionFormScreenState extends ConsumerState<ConnectionFormScreen> {
  final _formKey = GlobalKey<FormState>();

  late final String _id;
  late final TextEditingController _labelController;
  late final TextEditingController _hostController;
  late final TextEditingController _portController;
  late final TextEditingController _usernameController;
  final _passwordController = TextEditingController();
  final _privateKeyController = TextEditingController();
  final _passphraseController = TextEditingController();

  late SshAuthType _authType;
  late String _persistence;
  late bool _hooksEnabled;

  bool get _isEditing => widget.initial != null;

  @override
  void initState() {
    super.initState();
    final initial = widget.initial;
    _id = initial?.id ?? DateTime.now().microsecondsSinceEpoch.toString();
    _labelController = TextEditingController(text: initial?.label ?? '');
    _hostController = TextEditingController(text: initial?.host ?? '');
    _portController = TextEditingController(
      text: (initial?.port ?? 22).toString(),
    );
    _usernameController = TextEditingController(text: initial?.username ?? '');
    _authType = initial?.authType ?? SshAuthType.password;
    _persistence = initial?.persistence ?? 'tmux';
    _hooksEnabled = initial?.hooksEnabled ?? true;
  }

  @override
  void dispose() {
    _labelController.dispose();
    _hostController.dispose();
    _portController.dispose();
    _usernameController.dispose();
    _passwordController.dispose();
    _privateKeyController.dispose();
    _passphraseController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    final profile = ConnectionProfile(
      id: _id,
      label: _labelController.text.trim(),
      host: _hostController.text.trim(),
      username: _usernameController.text.trim(),
      port: int.tryParse(_portController.text.trim()) ?? 22,
      authType: _authType,
      persistence: _persistence,
      hooksEnabled: _hooksEnabled,
    );

    final notifier = ref.read(connectionsProvider.notifier);
    await notifier.upsert(profile);

    final password = _passwordController.text;
    final privateKeyPem = _privateKeyController.text;
    final passphrase = _passphraseController.text;
    final secretsChanged = switch (_authType) {
      SshAuthType.password => password.isNotEmpty,
      SshAuthType.privateKey =>
        privateKeyPem.isNotEmpty || passphrase.isNotEmpty,
      SshAuthType.keyboardInteractive => false,
    };
    if (secretsChanged) {
      await notifier.saveSecrets(
        _id,
        ConnectionSecrets(
          password: _authType == SshAuthType.password && password.isNotEmpty
              ? password
              : null,
          privateKeyPem:
              _authType == SshAuthType.privateKey && privateKeyPem.isNotEmpty
              ? privateKeyPem
              : null,
          passphrase:
              _authType == SshAuthType.privateKey && passphrase.isNotEmpty
              ? passphrase
              : null,
        ),
      );
    }

    if (mounted) Navigator.of(context).pop();
  }

  String? _requiredValidator(String? value) {
    if (value == null || value.trim().isEmpty) return 'Обязательное поле';
    return null;
  }

  List<Widget> _secretFields(ConnectionSecrets? existingSecrets) {
    switch (_authType) {
      case SshAuthType.password:
        return [
          TextFormField(
            key: const Key('connection_form_password'),
            controller: _passwordController,
            obscureText: true,
            decoration: InputDecoration(
              labelText: 'Пароль',
              hintText: existingSecrets?.password != null
                  ? 'оставить как есть'
                  : null,
            ),
          ),
        ];
      case SshAuthType.privateKey:
        return [
          TextFormField(
            key: const Key('connection_form_private_key'),
            controller: _privateKeyController,
            maxLines: 6,
            decoration: InputDecoration(
              labelText: 'Приватный ключ (PEM)',
              alignLabelWithHint: true,
              hintText: existingSecrets?.privateKeyPem != null
                  ? 'оставить как есть'
                  : null,
            ),
          ),
          const SizedBox(height: 12),
          TextFormField(
            key: const Key('connection_form_passphrase'),
            controller: _passphraseController,
            obscureText: true,
            decoration: InputDecoration(
              labelText: 'Passphrase (опционально)',
              hintText: existingSecrets?.passphrase != null
                  ? 'оставить как есть'
                  : null,
            ),
          ),
        ];
      case SshAuthType.keyboardInteractive:
        return const [];
    }
  }

  @override
  Widget build(BuildContext context) {
    final existingSecrets = _isEditing
        ? ref.watch(connectionSecretsProvider(_id)).value
        : null;

    return Scaffold(
      appBar: AppBar(
        title: Text(_isEditing ? 'Редактирование' : 'Новое подключение'),
        actions: [
          IconButton(
            icon: const Icon(Icons.check),
            tooltip: 'Сохранить',
            onPressed: _save,
          ),
        ],
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              key: const Key('connection_form_label'),
              controller: _labelController,
              decoration: const InputDecoration(labelText: 'Название'),
              validator: _requiredValidator,
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('connection_form_host'),
              controller: _hostController,
              decoration: const InputDecoration(labelText: 'Хост'),
              validator: _requiredValidator,
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('connection_form_port'),
              controller: _portController,
              decoration: const InputDecoration(labelText: 'Порт'),
              keyboardType: TextInputType.number,
              validator: (value) {
                final port = int.tryParse((value ?? '').trim());
                if (port == null || port < 1 || port > 65535) {
                  return 'Порт от 1 до 65535';
                }
                return null;
              },
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('connection_form_username'),
              controller: _usernameController,
              decoration: const InputDecoration(labelText: 'Пользователь'),
              validator: _requiredValidator,
            ),
            const SizedBox(height: 20),
            Text(
              'Аутентификация',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 8),
            SegmentedButton<SshAuthType>(
              segments: const [
                ButtonSegment(
                  value: SshAuthType.password,
                  label: Text('Пароль'),
                ),
                ButtonSegment(
                  value: SshAuthType.privateKey,
                  label: Text('Ключ'),
                ),
                ButtonSegment(
                  value: SshAuthType.keyboardInteractive,
                  label: Text('Interactive'),
                ),
              ],
              selected: {_authType},
              onSelectionChanged: (selection) =>
                  setState(() => _authType = selection.first),
            ),
            const SizedBox(height: 12),
            ..._secretFields(existingSecrets),
            const SizedBox(height: 20),
            Text('Режим сессии', style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 8),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(
                  value: 'tmux',
                  label: Text('tmux'),
                  icon: Icon(Icons.all_inclusive),
                ),
                ButtonSegment(
                  value: 'off',
                  label: Text('SSH'),
                  icon: Icon(Icons.bolt),
                ),
              ],
              selected: {_persistence},
              onSelectionChanged: (selection) =>
                  setState(() => _persistence = selection.first),
            ),
            SwitchListTile(
              key: const Key('connection_form_hooks'),
              contentPadding: EdgeInsets.zero,
              title: const Text('Отслеживать cwd/busy'),
              subtitle: const Text('Хуки удалённого шелла (OSC 7/133)'),
              value: _hooksEnabled,
              onChanged: (value) => setState(() => _hooksEnabled = value),
            ),
          ],
        ),
      ),
    );
  }
}
