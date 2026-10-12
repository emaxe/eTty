/// Режим запуска SSH-вкладки (обычная сессия / tmux) — порт `src/shared/ssh-persistence.js`
/// десктопного eTty. Свойство КОНКРЕТНОГО запуска (переключатель SSH/tmux в UI), не свойство
/// сохранённого профиля подключения — `connectionPersistence` остаётся только fallback'ом
/// обратной совместимости (профили/вкладки без явного выбора режима). На мобилке по умолчанию
/// выбирается `'tmux'` уже на уровне UI (REQ-10, `docs/plans/mob/plan.md`) — эта функция сама по
/// себе платформенно нейтральна и портирована без изменений логики.
///
/// [sshOptionsPersistence] — то, что пришло с конкретным запуском вкладки; `null` — источник не
/// указал режим явно. [connectionPersistence] — значение из сохранённого профиля подключения.
String resolveSshPersistence(String? sshOptionsPersistence, String? connectionPersistence) {
  if (sshOptionsPersistence == 'tmux' || sshOptionsPersistence == 'off') {
    return sshOptionsPersistence!;
  }
  return connectionPersistence == 'tmux' ? 'tmux' : 'off';
}
