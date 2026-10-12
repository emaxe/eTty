import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/remote/remote_scripts.dart';

import '_fixtures.dart';

/// Сверяет [RemoteScripts] побайтово с `scripts.json`, сгенерированным из всех именованных
/// экспортов `src/main/ssh/remote-scripts.js`. Побайтовое совпадение — прямое требование REQ-3
/// (`docs/plans/mob/plan.md`): один и тот же текст скрипта должен уходить на сервер что с
/// десктопа, что с телефона.
void main() {
  final expected = loadFixtureJson('scripts.json') as Map<String, dynamic>;

  // Имя JS-экспорта → значение Dart-порта. Ключи должны 1:1 совпадать с scripts.json.
  final actual = <String, String>{
    'PROBE_SCRIPT': RemoteScripts.probeScript,
    'READ_DIR_SCRIPT': RemoteScripts.readDirScript,
    'READ_DIR_FALLBACK_SCRIPT': RemoteScripts.readDirFallbackScript,
    'REALPATH_SCRIPT': RemoteScripts.realpathScript,
    'CREATE_FILE_SCRIPT': RemoteScripts.createFileScript,
    'CREATE_DIR_SCRIPT': RemoteScripts.createDirScript,
    'RENAME_SCRIPT': RemoteScripts.renameScript,
    'DELETE_MANY_SCRIPT': RemoteScripts.deleteManyScript,
    'COPY_SCRIPT': RemoteScripts.copyScript,
    'MOVE_SCRIPT': RemoteScripts.moveScript,
    'COPY_MANY_SCRIPT': RemoteScripts.copyManyScript,
    'READ_FILE_SCRIPT': RemoteScripts.readFileScript,
    'WRITE_FILE_SCRIPT': RemoteScripts.writeFileScript,
    'UPLOAD_PASTE_IMAGE_SCRIPT': RemoteScripts.uploadPasteImageScript,
    'STAT_FILE_GNU_SCRIPT': RemoteScripts.statFileGnuScript,
    'STAT_FILE_BSD_SCRIPT': RemoteScripts.statFileBsdScript,
    'POLL_MTIME_GNU_SCRIPT': RemoteScripts.pollMtimeGnuScript,
    'POLL_MTIME_BSD_SCRIPT': RemoteScripts.pollMtimeBsdScript,
    'TMUX_SESSION_STATE_SCRIPT': RemoteScripts.tmuxSessionStateScript,
    'TMUX_LIST_SESSIONS_SCRIPT': RemoteScripts.tmuxListSessionsScript,
    'TMUX_KILL_SESSION_SCRIPT': RemoteScripts.tmuxKillSessionScript,
    'TMUX_RENAME_SESSION_SCRIPT': RemoteScripts.tmuxRenameSessionScript,
  };

  test('набор ключей совпадает с scripts.json (ничего не забыто/не лишнее)', () {
    expect(actual.keys.toSet(), expected.keys.toSet());
  });

  for (final name in actual.keys) {
    test('$name — побайтовое совпадение', () {
      expect(actual[name], expected[name]);
    });
  }
}
