# Спецификация: Конфиг (Внешний конфиг + темы)

## Контекст

Сейчас настройки eTty хранятся в одном JSON-файле (`settings.json` в `userData`), а темы — жёстко захардкожены в `src/renderer/themes.js` (715 строк, 10 тем). Пользователь хочет:
1. Вынести **все** настройки в редактируемый внешний JSON-конфиг.
2. Вынести темы в отдельные `.json` файлы в подпапке `themes/`.
3. Приложение должно подхватывать внешние конфиг и темы при старте.
4. Валидация с предупреждением об ошибках и graceful fallback на стандартные значения.
5. 2 темы (dark/light) остаются вшитыми в приложение — fallback на случай, если внешние темы недоступны.

## Требования

### Config

**REQ-1** Основной конфиг хранится в `userData/eTty/config.json` (единый путь, OS-specific через `app.getPath('userData')`).

**REQ-2** Структура `config.json` — объект с секциями: `version`, `fileTree`, `appearance`, `terminal`, `agents`. Поля совпадают с текущими defaults из `settings-store.js`.

**REQ-3** При старте приложения `config-loader.js` читает `config.json`. При отсутствии файла — создаёт из defaults с alert.

**REQ-4** Валидация `config.json`:
- **Критическая ошибка** (invalid JSON, отсутствует `version`, `version` несовместим): `dialog.showErrorBox` с описанием + полный fallback на hardcoded defaults.
- **Мелкая ошибка** (отсутствует/неверен тип поля): log warning, подставить default для этого поля, остальной config загрузить.

**REQ-5** `settings-store.js` становится оркестратором: вызывает `config-loader.js` + `theme-loader.js`, агрегирует результат.

### Themes

**REQ-6** Темы хранятся в `userData/eTty/themes/*.json`. Каждая тема — отдельный файл.

**REQ-7** Формат файла темы:
```json
{
  "id": "unique-id",
  "name": "Display Name",
  "ui": { "bg": "#...", "text": "#...", ... },
  "terminal": { "background": "#...", ... },
  "editor": { "bg": "#...", ... }
}
```

**REQ-8** Имя файла произвольное; `id` берётся из содержимого JSON.

**REQ-9** `theme-loader.js` сканирует папку `themes/`, парсит все `.json`, валидирует каждый файл.

**REQ-10** Валидация отдельной темы:
- Обязательные поля: `id` (string), `name` (string), `ui` (object), `terminal` (object), `editor` (object).
- Обязательные под-поля `ui`: `bg`, `surface`, `border`, `muted`, `text`, `subtext`, `accent`, `green`, `red`, `hover`.
- Обязательные под-поля `terminal`: `background`, `foreground`, `cursor`, `selectionBackground`, `black`..`brightWhite` (16 ANSI colors).
- Обязательные под-поля `editor`: `bg`, `text`, `gutterBg`, `lineNumber`, `activeLine`, `selection`, `cursor`, `keyword`, `string`, `number`, `comment`, `function`, `type`, `variable`, `operator`, `property`, `tag`, `attribute`, `bracket`.

**REQ-11** При невалидной теме (parse error, отсутствует обязательное поле): skip файл, `electron-log.warn()` с именем файла и причиной.

**REQ-12** При дублирующемся `id`: skip поздний файл, warning.

**REQ-13** Если ни одна внешняя тема не загрузилась — fallback на вшитые темы `dark` и `light`.

**REQ-14** При старте приложения: если папка `themes/` пуста (или отсутствует), скопировать все текущие темы из `src/renderer/themes.js` как `.json` файлы в `themes/` (инициализация).

**REQ-15** В `config.json` поле `appearance.theme` хранит `id` темы (строка). Если указанная тема не найдена среди загруженных — fallback на `dark`, log warning.

**REQ-16** Редактирование тем только через ручное изменение `.json` файлов. UI для создания/редактирования тем — out of scope.

### IPC

**REQ-17** `settings:load` возвращает объект `{ config, themes, warnings }`:
- `config` — merged config
- `themes` — массив всех доступных тем (внешние + вшитые dark/light), каждая с полями `id`, `name`
- `warnings` — массив строк с предупреждениями валидации

**REQ-18** `settings:save(config)` записывает только `config.json` (без `themes`).

**REQ-19** Renderer при старте получает `themes` и рендерит dropdown в settings-page. `warnings` — вывод в `console.warn()`.

### Fallback темы

**REQ-20** В `src/renderer/themes.js` остаются только 2 темы: `dark` и `light` (каждая с полным набором полей `ui`, `terminal`, `editor`).

**REQ-21** Все остальные текущие темы (catppuccin-mocha, monokai, dracula, one-dark, nord, solarized-dark, gruvbox-dark, catppuccin-latte, github-light, solarized-light, tokyo-night, night-owl) — при первом запуске записываются как `.json` в `userData/eTty/themes/` (инициализация папки).

## Ограничения

- Hot reload конфига/тем без перезапуска — out of scope (только при старте).
- UI для создания/редактирования тем — out of scope.
- Миграция формата config (version bump) — в будущих фичах, сейчас только `version === 1`.
- JSON Schema валидация через сторонние библиотеки — не используем, ручная проверка для контроля сообщений.

## Макеты и референсы

не применимо

## Кодстайл и конвенции

- Следовать стилю существующих файлов `src/main/`: async/await, `fs/promises`, `electron-log`.
- Имена файлов в kebab-case.
- Константы defaults — экспортируемые функции `getDefaults()`.
- Логирование через `electron-log` (info/warn/error).

## Переиспользуемые решения

- `settings-store.js` — рефакторинг существующего модуля. Логика deep merge и load/save JSON — взять за основу.
- `src/renderer/themes.js` — останется только с 2-мя fallback темами.
- `preload/index.js` — расширить `settings:load`/`settings:save` для нового формата ответа.
- `src/renderer/settings-page.js` — адаптировать dropdown тем: теперь themes приходят динамически, не hardcoded.

## Критерии приёмки

- [ ] `config.json` создаётся автоматически при первом запуске (если отсутствует).
- [ ] Папка `themes/` инициализируется 12 JSON-файлами при первом запуске.
- [ ] Вшитые темы `dark`/`light` присутствуют всегда, даже если `themes/` пуста.
- [ ] Невалидный `config.json` → alert + fallback defaults, приложение стартует.
- [ ] Невалидная тема → skip + log warning, остальные темы грузятся.
- [ ] Дубли `id` → skip позднего + warning.
- [ ] Settings-page показывает все доступные темы (внешние + вшитые) в dropdown.
- [ ] При смене темы в settings-page она применяется сразу (как сейчас).
- [ ] `npm run dev` стартует без ошибок.

## Затронутые файлы

### Создать
- `src/main/config-loader.js`
- `src/main/theme-loader.js`

### Изменить
- `src/main/settings-store.js` — рефакторинг в оркестратор
- `src/renderer/themes.js` — оставить только dark/light
- `src/preload/index.js` — обновить `settings:load`/`settings:save`
- `src/renderer/settings-page.js` — адаптировать dropdown тем
- `src/renderer/index.js` — возможно, обновить инициализацию themes

### Не трогать
- `src/renderer/styles.css` — CSS переменные остаются, переключение через JS как сейчас
- `src/main/index.js` — не меняем логику окна
