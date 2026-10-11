# Чеклист реализации: Выбор tmux-сессий, папка запуска и скрытые файлы (mobile)

## Подготовка
- [ ] Прочитать spec.md и plan.md
- [ ] Работа без отдельной ветки (см. README.md)

## Задачи
- [ ] Задача #1: `buildRemoteInitCommand(startDir)` + тесты (`test/remote/remote_shell_hooks_start_dir_test.dart`), golden и `gen-remote-fixtures --check` без изменений
- [ ] Задача #2: `TabController(startDir)` + тесты (после #1)
- [ ] Задача #3: настройка `showHiddenFiles` в `AppSettingsStore` + `showHiddenFilesProvider` + тесты
- [ ] Задача #4: `FileTreeController.showHidden` + фильтр видимых узлов + тесты
- [ ] Задача #5: UI дерева — переключатель «глаз», пункт «Запустить tmux-сессию здесь», `Navigator.pop(path)` + тесты (после #3, #4)
- [ ] Задача #6: `TmuxSessionsSheet` — `onSelect`, подсветка, диалог перехвата, неподдерживаемые имена + тесты
- [ ] Задача #7: `TerminalPage` — кнопка «Сессии», `_openSession`, приём пути из дерева, `initialSessionName` (после #2, #5, #6)
- [ ] Задача #8: `ConnectionsScreen` + `main.dart` — выбор сессии из списка подключений (после #7)
- [ ] Задача #9: финальная проверка (`flutter analyze`, `flutter test`, `gen-remote-fixtures --check`, APK, ручной прогон на телефоне)

## Финализация
- [ ] Все проверки пройдены
- [ ] Код закоммичен (без упоминаний Claude/Anthropic; правки `AndroidManifest.xml` и `scripts/run.sh` — отдельными коммитами)
- [ ] Статус в README.md обновлён на `Done`
