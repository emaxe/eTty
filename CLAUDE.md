Все правила проекта описаны в [AGENTS.md](AGENTS.md).
Прочитай AGENTS.md перед началом работы.

## Актуальные фичи

- **Git diff highlighting** — подсветка git-изменений в дереве файлов и редакторе (gutter bars). Сервис `GitStatusService`, polling 5 сек.
- **Project search** — диалог поиска по файлам и содержимому (`Cmd+F`, double-tap `Shift`). Компонент `ProjectSearchDialog`, IPC `SEARCH_QUERY` / `SEARCH_CANCEL`.
- **Roboto font** — глобальный шрифт приложения.
