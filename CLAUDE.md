Все правила проекта описаны в [AGENTS.md](AGENTS.md).
Прочитай AGENTS.md перед началом работы.

## Актуальные фичи

- **Git diff highlighting** — подсветка git-изменений в дереве файлов и редакторе (gutter bars слева от номеров строк, включая маркер удалённых строк). Сервис `GitStatusService`, polling 5 сек.
- **Git panel** — двухпанельная master/detail панель (`Cmd+Shift+G` или клик по статус-бару): слева список файлов по группам Staged/Changes/Untracked/Ignored с фильтром и staging, справа unified diff с номерами строк, подсветкой синтаксиса и word-diff. Компоненты в `src/renderer/features/git/` (`git-panel.js`, `git-file-list.js`, `git-diff-view.js`).
- **Project search** — диалог поиска по файлам и содержимому (`Cmd+F`, double-tap `Shift`). Компонент `ProjectSearchDialog`, IPC `SEARCH_QUERY` / `SEARCH_CANCEL`.
- **Roboto font** — глобальный шрифт приложения.
- **Хоткей переключения вкладок** — `Cmd+Option+←/→` или `Cmd+Shift+←/→` (по умолчанию выкл.), настройка `terminal.tabSwitchHotkey` в Settings → Терминал. Логика в `TabBar.switchRelative()` (зацикливание), обработка в `index.js` `onKeyDown`.
- **Подтверждение закрытия занятой вкладки** — `tab.close.request` эмитится вместо прямого `tab.close` для пользовательских путей закрытия (× / контекстное меню); если среди закрываемых вкладок есть с активным процессом (`tab.isBusy`), показывается `ConfirmDialog` перед убийством PTY.
