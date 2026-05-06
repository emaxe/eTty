# Задача B1: Рефакторинг прямых вызовов `window.electronAPI` → `ElectronApiAdapter`

## Статус
✅ Завершено — smoke-test пройден

## Цель
Устранить все прямые обращения к `window.electronAPI` в renderer-процессе. Все IPC-вызовы должны идти только через DI-инжектированный `ElectronApiAdapter` (`core/adapters/electron-api.js`).

## Архитектурные инварианты (обязательно)
- **DI:** зависимости — через DI Container (`constructor` injection), не через глобалы. Если компоненту нужен `api` — он приходит из контейнера.
- **Adapter:** не обращаться к `window.electronAPI` напрямую — только через `core/adapters/electron-api.js`.
- **IPC_CHANNELS:** все IPC-каналы — только через `shared/ipc-channels.js`, нет строковых литералов.
- **Не рефакторить логику:** только заменить `window.electronAPI.*` на `this._api.*` / `api.*` / `r('api').*`.
- **Не менять публичный API** компонентов (кроме добавления/исправления методов адаптера).

## Текущее состояние

```bash
$ grep -r "window\.electronAPI" src/renderer/ | wc -l
73
```

Основные нарушители:
- `src/renderer/index.js` — ~35 вызовов
- `src/renderer/file-tree.js` — ~18 вызовов
- `src/renderer/git-panel.js` — ~9 вызовов
- `src/renderer/status-bar.js` — ~3 вызова

## Чего не хватает в адаптере

Перед рефакторингом компонентов — **дополнить `ElectronApiAdapter`** (`src/renderer/core/adapters/electron-api.js`):

### Исправить существующий метод
- `fsWatchDir(path, fn)` → исправить на `fsWatchDir(path)` (invoke) и добавить `onFsDirChanged(fn)` (подписка). Текущая реализация ошибочно смешивает invoke и подписку.

### Добавить отсутствующие методы
- `fsUnwatchDir(path)` — вызов `this._api.fsUnwatchDir(path)`
- `fsMove(srcPaths, destDir)` — вызов `this._api.fsMove(srcPaths, destDir)`
- `gitGetRoot(cwd)` — вызов `this._api.gitGetRoot(cwd)`
- `get nodeVersion()` — getter, возвращает `this._api.nodeVersion` (свойство preload)
- `onFsDirChanged(fn)` — подписка на `fsDirChanged` через `this._on('fsDirChanged', fn)`

## Компоненты для рефакторинга (по порядку)

### 1. `ElectronApiAdapter` (`src/renderer/core/adapters/electron-api.js`)
- [ ] Исправить `fsWatchDir(path)` — убрать параметр `fn`, просто `return this._api.fsWatchDir(path)`
- [ ] Добавить `onFsDirChanged(fn)` — `return this._on('fsDirChanged', fn)`
- [ ] Добавить `fsUnwatchDir(path)`
- [ ] Добавить `fsMove(srcPaths, destDir)`
- [ ] Добавить `gitGetRoot(cwd)`
- [ ] Добавить getter `nodeVersion`

### 2. `FileTree` (`src/renderer/file-tree.js`)
- [ ] Конструктор уже получает `api` в `{ eventBus, api }` — использовать `this._api`
- [ ] Заменить все `window.electronAPI.fsWatchDir(...)` → `this._api.fsWatchDir(...)`
- [ ] Заменить все `window.electronAPI.fsUnwatchDir(...)` → `this._api.fsUnwatchDir(...)`
- [ ] Заменить `window.electronAPI.onFsDirChanged(...)` → `this._api.onFsDirChanged(...)`
- [ ] Заменить `window.electronAPI.fsReadDir(...)` → `this._api.fsReadDir(...)`
- [ ] Заменить `window.electronAPI.fsMove(...)` → `this._api.fsMove(...)`
- [ ] Заменить `window.electronAPI.fsRename(...)` → `this._api.fsRename(...)`
- [ ] Заменить `window.electronAPI.fsCreateFile(...)` → `this._api.fsCreateFile(...)`
- [ ] Заменить `window.electronAPI.fsCreateDir(...)` → `this._api.fsCreateDir(...)`
- [ ] Заменить `window.electronAPI.fsDelete(...)` → `this._api.fsDelete(...)`
- [ ] Заменить `window.electronAPI.fsCopy(...)` → `this._api.fsCopy(...)`
- [ ] Заменить `window.electronAPI.getCwd()` → `this._api.getCwd()`
- [ ] **Важно:** в `init()` подписка `onFsDirChanged` должна сохранять unsubscribe-функцию (уже реализовано в A1 как `this._fsDirChangedUnsub`)

### 3. `GitPanel` (`src/renderer/git-panel.js`)
- [ ] Конструктор получает `{ overlayEl, onClose }` — добавить `api` в параметры: `constructor({ overlayEl, onClose, api })`
- [ ] Заменить все `window.electronAPI.gitCheckout(...)` → `this._api.gitCheckout(...)`
- [ ] Заменить все `window.electronAPI.gitCreateBranch(...)` → `this._api.gitCreateBranch(...)`
- [ ] Заменить все `window.electronAPI.gitDeleteBranch(...)` → `this._api.gitDeleteBranch(...)`
- [ ] Заменить `window.electronAPI.gitGetRoot(...)` → `this._api.gitGetRoot(...)`
- [ ] Заменить `window.electronAPI.gitGetStatus(...)` → `this._api.gitGetStatus(...)`
- [ ] Заменить `window.electronAPI.gitGetBranches(...)` → `this._api.gitGetBranches(...)`
- [ ] Заменить `window.electronAPI.gitGetDiff(...)` → `this._api.gitGetDiff(...)`
- [ ] Заменить `window.electronAPI.gitCommit(...)` → `this._api.gitCommit(...)`
- [ ] Заменить `window.electronAPI.gitPush(...)` → `this._api.gitPush(...)`
- [ ] Заменить `window.electronAPI.gitDiscard(...)` → `this._api.gitDiscard(...)`

### 4. `StatusBar` (`src/renderer/status-bar.js`)
- [ ] Конструктор уже получает множество параметров — добавить `api`: `constructor({ ..., api })`
- [ ] Заменить `window.electronAPI.nodeVersion` → `this._api.nodeVersion`
- [ ] Заменить `window.electronAPI.getHomedir()` → `this._api.getHomedir()`
- [ ] Заменить `window.electronAPI.gitGetStatus(...)` → `this._api.gitGetStatus(...)`

### 5. `index.js` (`src/renderer/index.js`)
- [ ] Убедиться, что `api = container.resolve('api')` получается раньше первого использования
- [ ] Заменить все `window.electronAPI.settingsLoad()` → `api.settingsLoad()`
- [ ] Заменить все `window.electronAPI.ptyCreate(...)` → `api.ptyCreate(...)`
- [ ] Заменить все `window.electronAPI.getCwd()` → `api.getCwd()`
- [ ] Заменить все `window.electronAPI.ptyWrite(...)` → `api.ptyWrite(...)`
- [ ] Заменить все `window.electronAPI.ptyKill(...)` → `api.ptyKill(...)`
- [ ] Заменить все `window.electronAPI.ptyResize(...)` → `api.ptyResize(...)`
- [ ] Заменить `window.electronAPI.fsSetRoot(...)` → `api.fsSetRoot(...)`
- [ ] Заменить `window.electronAPI.agentsGetStatus()` → `api.agentsGetStatus()`
- [ ] Заменить `window.electronAPI.onAgentsSettingsUpdated(...)` → `api.onAgentsSettingsUpdated(...)`
- [ ] Заменить `window.electronAPI.onPtyData(...)` → `api.onPtyData(...)`
- [ ] Заменить `window.electronAPI.onPtyExit(...)` → `api.onPtyExit(...)`
- [ ] Заменить `window.electronAPI.tabsDeleteSavedState()` → `api.tabsDeleteSavedState()`
- [ ] Заменить `window.electronAPI.tabsStateChanged()` → `api.tabsStateChanged()`
- [ ] Заменить `window.electronAPI.tabsHasSavedState()` → `api.tabsHasSavedState()`
- [ ] Заменить `window.electronAPI.tabsLoadSavedState()` → `api.tabsLoadSavedState()`
- [ ] Заменить `window.electronAPI.tabsShowRestoreDialog(...)` → `api.tabsShowRestoreDialog(...)`
- [ ] Заменить `window.electronAPI.onTabsTriggerRestore(...)` → `api.onTabsTriggerRestore(...)`
- [ ] Заменить `window.electronAPI.historyCleanup(...)` → `api.historyCleanup(...)`
- [ ] Заменить `window.electronAPI.onFullscreenChange(...)` → `api.onFullscreenChange(...)`
- [ ] Заменить `window.electronAPI.windowGetPosition()` → `api.windowGetPosition()`
- [ ] Заменить `window.electronAPI.windowMove(...)` → `api.windowMove(...)`

## Обновление DI-регистраций (index.js)

При изменении сигнатур конструкторов (`GitPanel`, `StatusBar`) — обновить вызовы `new GitPanel({...})` и `new StatusBar({...})` в DI-контейнере, добавив `api: r('api')`:

```js
container.register('gitPanel', (r) => new GitPanel({
  overlayEl: document.getElementById('git-overlay'),
  onClose: () => { ... },
  api: r('api'),  // ← добавить
}))

container.register('statusBar', (r) => new StatusBar({
  btnEl: document.getElementById('btn-git-diff'),
  // ...
  api: r('api'),  // ← добавить
}))
```

## Ограничения
- **Не создавать новую ветку git.** Работать в текущей.
- **Не менять логику компонентов.** Только заменить вызовы.
- **Не менять preload.** `window.electronAPI` остаётся как есть — меняем только renderer.
- **Не добавлять try/catch** — это задача C2, будет после B1.

## Критерий приёмки (проверить перед завершением)
- [ ] `grep -r "window\.electronAPI" src/renderer/` возвращает ровно 1 результат: `core/adapters/electron-api.js` (где `this._api = window.electronAPI`)
- [ ] `npm run build` проходит без ошибок
- [ ] Приложение запускается, терминал работает, дерево файлов отображается, Git-панель открывается
- [ ] Все компоненты (`FileTree`, `GitPanel`, `StatusBar`) получают `api` через DI-контейнер

## Порядок выполнения (рекомендуемый)
1. Дополнить `ElectronApiAdapter` — добавить недостающие методы, исправить `fsWatchDir`
2. Рефакторинг `FileTree` — самый многословный (~18 вызовов)
3. Рефакторинг `GitPanel` — добавить `api` в constructor
4. Рефакторинг `StatusBar` — добавить `api` в constructor
5. Рефакторинг `index.js` — ~35 вызовов + обновление DI-регистраций
6. Проверка: `grep` + `npm run build` + ручной smoke-test

## После выполнения
- Обновить `docs/backlog/best/critical-tasks.md` — статус B1 → 🔍 На ревью
- Обновить `docs/backlog/best/checklist.md` — отметить выполненные пункты B1
