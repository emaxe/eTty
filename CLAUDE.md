Все правила проекта описаны в [AGENTS.md](AGENTS.md).
Прочитай AGENTS.md перед началом работы.

## Актуальные фичи

- **Git diff highlighting** — подсветка git-изменений в дереве файлов и редакторе (gutter bars). Сервис `GitStatusService`, polling 5 сек.
- **Project search** — диалог поиска по файлам и содержимому (`Cmd+F`, double-tap `Shift`). Компонент `ProjectSearchDialog`, IPC `SEARCH_QUERY` / `SEARCH_CANCEL`.
- **Roboto font** — глобальный шрифт приложения.
- **Хоткей переключения вкладок** — `Cmd+Option+←/→` или `Cmd+Shift+←/→` (по умолчанию выкл.), настройка `terminal.tabSwitchHotkey` в Settings → Терминал. Логика в `TabBar.switchRelative()` (зацикливание), обработка в `index.js` `onKeyDown`.
- **Подтверждение закрытия занятой вкладки** — `tab.close.request` эмитится вместо прямого `tab.close` для пользовательских путей закрытия (× / контекстное меню); если среди закрываемых вкладок есть с активным процессом (`tab.isBusy`), показывается `ConfirmDialog` перед убийством PTY.
