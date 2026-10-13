import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/config/ssh_fs_config.dart';
import 'package:mobile/core/config/ssh_session_config.dart';

import '_fixtures.dart';

/// Сверяет [SshSessionConfig]/[SshFsConfig] с `config.json`, сгенерированным из
/// `src/shared/ssh-session-config.js`/`src/shared/ssh-fs-config.js` десктопа — ловит класс
/// дрейфа «поправили таймаут/интервал на десктопе, забыли на мобилке» (риск R10,
/// `docs/plans/mob/plan.md`).
void main() {
  final fixture = loadFixtureJson('config.json') as Map<String, dynamic>;

  group('SshSessionConfig — golden против ssh-session-config.js', () {
    final expected = fixture['SSH_SESSION_CONFIG'] as Map<String, dynamic>;

    test('SESSION_NAME_RE — тот же исходный паттерн', () {
      final re = expected['SESSION_NAME_RE'] as Map<String, dynamic>;
      expect(SshSessionConfig.sessionNameRe.pattern, re[r'$regexSource']);
    });

    test('строковые и числовые константы', () {
      expect(SshSessionConfig.defaultSocket, expected['DEFAULT_SOCKET']);
      expect(SshSessionConfig.hookDir, expected['HOOK_DIR']);
      expect(SshSessionConfig.tmuxMinVersion, expected['TMUX_MIN_VERSION']);
      expect(SshSessionConfig.tmuxPassthroughMinVersion, expected['TMUX_PASSTHROUGH_MIN_VERSION']);
      expect(SshSessionConfig.statePollMs, expected['STATE_POLL_MS']);
      expect(SshSessionConfig.sessionsPollMs, expected['SESSIONS_POLL_MS']);
      expect(SshSessionConfig.sessionsRefreshDelayMs, expected['SESSIONS_REFRESH_DELAY_MS']);
      expect(SshSessionConfig.masterConnectTimeoutMs, expected['MASTER_CONNECT_TIMEOUT_MS']);
      expect(SshSessionConfig.masterIdleDisposeMs, expected['MASTER_IDLE_DISPOSE_MS']);
      expect(SshSessionConfig.masterFailureCooldownMs, expected['MASTER_FAILURE_COOLDOWN_MS']);
      expect(SshSessionConfig.masterControlPersist, expected['MASTER_CONTROL_PERSIST']);
      expect(SshSessionConfig.sessionsOpTimeoutMs, expected['SESSIONS_OP_TIMEOUT_MS']);
    });

    test('wheel scroll escape-последовательности', () {
      expect(SshSessionConfig.wheelScrollUpSeq, expected['WHEEL_SCROLL_UP_SEQ']);
      expect(SshSessionConfig.wheelScrollDownSeq, expected['WHEEL_SCROLL_DOWN_SEQ']);
    });
  });

  group('SshFsConfig — golden против ssh-fs-config.js', () {
    final expected = fixture['SSH_FS_CONFIG'] as Map<String, dynamic>;

    test('таймауты и интервалы', () {
      expect(SshFsConfig.masterCheckIntervalMs, expected['MASTER_CHECK_INTERVAL_MS']);
      expect(SshFsConfig.masterWaitMaxMs, expected['MASTER_WAIT_MAX_MS']);
      expect(SshFsConfig.masterAliveCacheMs, expected['MASTER_ALIVE_CACHE_MS']);
      expect(SshFsConfig.maxConcurrentExec, expected['MAX_CONCURRENT_EXEC']);
      expect(SshFsConfig.opTimeoutMs, expected['OP_TIMEOUT_MS']);
      expect(SshFsConfig.ioTimeoutMs, expected['IO_TIMEOUT_MS']);
      expect(SshFsConfig.probeTimeoutMs, expected['PROBE_TIMEOUT_MS']);
      expect(SshFsConfig.maxExecBufferBytes, expected['MAX_EXEC_BUFFER_BYTES']);
      expect(SshFsConfig.pollIntervalMs, expected['POLL_INTERVAL_MS']);
      expect(SshFsConfig.pollMaxDirs, expected['POLL_MAX_DIRS']);
    });

    test('batchSize — дублирует ssh-fs-provider.js:BATCH_SIZE (не экспортируется десктопом)', () {
      expect(SshFsConfig.batchSize, fixture['SSH_FS_BATCH_SIZE']);
    });
  });
}
