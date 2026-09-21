/**
 * Команда установки tmux по обнаруженному менеджеру пакетов (см. `PROBE_SCRIPT` → `parseProbe`
 * → `caps.pkgManager`). Используется только для ПОКАЗА пользователю и последующего ввода в
 * реальный интерактивный терминал вкладки (`api.ptyWrite`) — НЕ выполняется автоматически
 * никаким привилегированным путём в main-процессе: sudo-пароль (если нужен) пользователь вводит
 * сам, видя обычный запрос в своей же SSH-сессии, как и любую другую команду.
 */
const PKG_MANAGER_INSTALL = {
  apt: 'sudo apt-get install -y tmux',
  dnf: 'sudo dnf install -y tmux',
  yum: 'sudo yum install -y tmux',
  apk: 'sudo apk add tmux',
  pacman: 'sudo pacman -S --noconfirm tmux',
  zypper: 'sudo zypper install -y tmux',
  // brew (сервер на macOS) — без sudo, brew не запускается от root
  brew: 'brew install tmux'
}

/** @returns {string|null} команда установки, либо null — менеджер не распознан (см. PROBE_SCRIPT). */
export function buildTmuxInstallCommand(pkgManager) {
  return PKG_MANAGER_INSTALL[pkgManager] || null
}
