/**
 * Константы персистентных удалённых сессий (tmux) по SSH. Отдельно от `ssh-fs-config.js`
 * (тот — про транспорт удалённой ФС), но по тому же мотиву: main не видит `renderer/core/config/`.
 */

export const SSH_SESSION_CONFIG = Object.freeze({
  // Имя сессии tmux — только буквы/цифры/`_`/`-`: tmux запрещает `.` и `:` в именах, а сама
  // строка попадает как единственная интерполяция в текст remote-команды (см. remote-shell-hooks.js) —
  // валидируем ДО подстановки, это часть инварианта assertL0Safe.
  SESSION_NAME_RE: /^[A-Za-z0-9_-]{1,64}$/,

  // Отдельный сокет tmux-сервера eTty (см. `-L <socket>`) — не трогает сокет/сессии пользователя
  // по умолчанию. Пустая строка в connection.tmuxSocket означает «сокет по умолчанию» (режим
  // совместимости — см. remote-shell-hooks.js).
  DEFAULT_SOCKET: 'etty',

  // Стабильный каталог хуков на сервере — НЕ $TMPDIR (может быть per-login на systemd, PrivateTmp).
  HOOK_DIR: '.cache/etty',

  // Минимальные версии tmux (см. план, Этап 1 — таблица версий).
  TMUX_MIN_VERSION: '1.8',
  TMUX_PASSTHROUGH_MIN_VERSION: '3.3',

  // Опрос состояния сессии (cwd/busy) через display-message, когда OSC не проходит наружу
  // (tmux < 3.3 или passthrough недоступен) — см. Этап 2.
  STATE_POLL_MS: 4000,

  // Панель SSH/tmux-сессий (SshConnectionMaster, ssh/ssh-connection-master.js) — отдельный от
  // per-PTY ControlMaster служебный канал на connectionId, только для листинга/kill/rename сессий.
  SESSIONS_POLL_MS: 15000,
  // Внеочередное обновление списка после открытия/закрытия/обрыва tmux-вкладки (событие
  // `ssh.session.activity`): в момент самого события клиент на сервере ещё не (от)цеплен —
  // короткая пауза, иначе запрос вернул бы старое состояние и индикатор ждал бы до SESSIONS_POLL_MS.
  SESSIONS_REFRESH_DELAY_MS: 800,
  MASTER_CONNECT_TIMEOUT_MS: 20000,
  MASTER_IDLE_DISPOSE_MS: 60000,
  MASTER_FAILURE_COOLDOWN_MS: 30000,
  MASTER_CONTROL_PERSIST: '5m',
  SESSIONS_OP_TIMEOUT_MS: 15000,

  // Колесо мыши в tmux-вкладке: tmux работает с `mouse off` (см. remote-shell-hooks.js —
  // выделение отдано нативному xterm.js), поэтому обычное wheel-событие tmux не видит.
  // TerminalWheelHandler транслирует его в CSI-u последовательность несуществующей комбинации
  // клавиш (Ctrl+Alt+Shift+Up/Down), которую распознают биндинги `bind-key -n C-M-S-Up/Down`
  // в generated tmux.conf (remote-shell-hooks.js) — они входят в copy-mode и скроллят реальную
  // историю. Общие для main (текст биндинга) и renderer (байты, которые шлём в PTY).
  WHEEL_SCROLL_UP_SEQ: '\x1b[1;8A',
  WHEEL_SCROLL_DOWN_SEQ: '\x1b[1;8B',
})
