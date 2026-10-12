import 'dart:async';

import 'package:dartssh2/dartssh2.dart'
    show SSHUserInfoRequest, SSHUserInfoPrompt;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/ssh_connector.dart';
import 'package:mobile/data/connection_store.dart';
import 'package:mobile/transport/host_keys.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  group('sshCredentialsFor', () {
    testWidgets('password: переносит пароль как есть', (tester) async {
      late BuildContext ctx;
      await tester.pumpWidget(
        _wrap(
          Builder(
            builder: (context) {
              ctx = context;
              return const SizedBox();
            },
          ),
        ),
      );

      final creds = sshCredentialsFor(
        ctx,
        SshAuthType.password,
        const ConnectionSecrets(password: 'pw'),
      );

      expect(creds.password, 'pw');
      expect(creds.privateKeyPem, isNull);
      expect(creds.keyboardInteractivePrompt, isNull);
    });

    testWidgets('privateKey: переносит PEM и passphrase', (tester) async {
      late BuildContext ctx;
      await tester.pumpWidget(
        _wrap(
          Builder(
            builder: (context) {
              ctx = context;
              return const SizedBox();
            },
          ),
        ),
      );

      final creds = sshCredentialsFor(
        ctx,
        SshAuthType.privateKey,
        const ConnectionSecrets(privateKeyPem: 'PEM', passphrase: 'pass'),
      );

      expect(creds.privateKeyPem, 'PEM');
      expect(creds.privateKeyPassphrase, 'pass');
      expect(creds.password, isNull);
    });

    testWidgets('keyboardInteractive: даёт непустой prompt-колбэк', (
      tester,
    ) async {
      late BuildContext ctx;
      await tester.pumpWidget(
        _wrap(
          Builder(
            builder: (context) {
              ctx = context;
              return const SizedBox();
            },
          ),
        ),
      );

      final creds = sshCredentialsFor(
        ctx,
        SshAuthType.keyboardInteractive,
        ConnectionSecrets.empty,
      );

      expect(creds.keyboardInteractivePrompt, isNotNull);
      expect(creds.password, isNull);
      expect(creds.privateKeyPem, isNull);
    });
  });

  group('confirmNewHostKeyDialog', () {
    HostKeyCheckResult result() => const HostKeyCheckResult(
      verdict: HostKeyVerdict.newHost,
      host: 'example.com',
      port: 22,
      keyType: 'ssh-ed25519',
      fingerprint: 'SHA256:abc123',
    );

    testWidgets('показывает host/port/keyType/fingerprint', (tester) async {
      late BuildContext ctx;
      await tester.pumpWidget(
        _wrap(
          Builder(
            builder: (context) {
              ctx = context;
              return const SizedBox();
            },
          ),
        ),
      );

      unawaited(confirmNewHostKeyDialog(ctx, result()));
      await tester.pumpAndSettle();

      expect(find.textContaining('example.com:22'), findsOneWidget);
      expect(find.textContaining('ssh-ed25519'), findsOneWidget);
      expect(find.textContaining('SHA256:abc123'), findsOneWidget);
    });

    testWidgets('"Доверять" возвращает true', (tester) async {
      late BuildContext ctx;
      await tester.pumpWidget(
        _wrap(
          Builder(
            builder: (context) {
              ctx = context;
              return const SizedBox();
            },
          ),
        ),
      );

      final future = confirmNewHostKeyDialog(ctx, result());
      await tester.pumpAndSettle();
      await tester.tap(find.text('Доверять'));
      await tester.pumpAndSettle();

      expect(await future, isTrue);
    });

    testWidgets('"Отмена" возвращает false', (tester) async {
      late BuildContext ctx;
      await tester.pumpWidget(
        _wrap(
          Builder(
            builder: (context) {
              ctx = context;
              return const SizedBox();
            },
          ),
        ),
      );

      final future = confirmNewHostKeyDialog(ctx, result());
      await tester.pumpAndSettle();
      await tester.tap(find.text('Отмена'));
      await tester.pumpAndSettle();

      expect(await future, isFalse);
    });
  });

  group('promptKeyboardInteractiveDialog', () {
    testWidgets(
      'по одному полю на промпт, "Отправить" возвращает введённый текст',
      (tester) async {
        late BuildContext ctx;
        await tester.pumpWidget(
          _wrap(
            Builder(
              builder: (context) {
                ctx = context;
                return const SizedBox();
              },
            ),
          ),
        );

        final request = SSHUserInfoRequest(
          'Password Expired',
          'Введите новый пароль',
          [SSHUserInfoPrompt('Password:', false)],
        );

        final future = promptKeyboardInteractiveDialog(ctx, request);
        await tester.pumpAndSettle();

        expect(find.text('Password Expired'), findsOneWidget);
        expect(find.text('Введите новый пароль'), findsOneWidget);

        await tester.enterText(find.byType(TextField).first, 'new-secret');
        await tester.tap(find.text('Отправить'));
        await tester.pumpAndSettle();

        expect(await future, ['new-secret']);
      },
    );

    testWidgets('"Отмена" возвращает null', (tester) async {
      late BuildContext ctx;
      await tester.pumpWidget(
        _wrap(
          Builder(
            builder: (context) {
              ctx = context;
              return const SizedBox();
            },
          ),
        ),
      );

      final request = SSHUserInfoRequest('', '', [
        SSHUserInfoPrompt('Code:', true),
      ]);

      final future = promptKeyboardInteractiveDialog(ctx, request);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Отмена'));
      await tester.pumpAndSettle();

      expect(await future, isNull);
    });
  });
}
