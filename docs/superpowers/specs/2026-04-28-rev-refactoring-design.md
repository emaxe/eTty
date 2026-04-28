# Спецификация: Архитектурный рефакторинг eTty (rev.md)

> **Дата:** 2026-04-28  
> **Статус:** Утверждено, готово к планированию  
> **Основание:** `docs/backlog/rev.md`

---

## 1. Проблема

`src/renderer/index.js` (796 строк) — God Object, который создаёт терминалы, управляет вкладками, обрабатывает IPC, настраивает UI. Это нарушает SRP, усложняет тестирование и увеличивает coupling.

Дополнительные проблемы:
- Компоненты напрямую зависят от `window.electronAPI` (нарушение DIP)
- Состояние разбросано по объектам (`TabBar.tabs[]`, `EditorPanel._tabs`, глобальные переменные)
- Дублирование drag-and-drop между `tab-bar.js` и `editor-panel.js`
- Магические числа и строки inline в коде

---

## 2. Цель

Разделить `index.js` на изолированные сервисы и компоненты, внедрить централизованное состояние, DI и UI-kit. Сохранить работоспособность приложения на каждом этапе.

---

## 3. Целевая архитектура

```
src/
├── main/
│   ├── index.js              # Только bootstrap
│   ├── ipc-handlers/         # Регистрация IPC по доменам
│   └── services/             # Бизнес-логика main
├── preload/
│   └── index.js              # API для renderer
├── renderer/
│   ├── index.js              # Только bootstrap + wiring
│   ├── styles.css            # Глобальные стили
│   ├── core/                 # Event Bus, State Store, DI Container, Config
│   ├── components/
│   │   ├── base/            # UI-kit
│   │   ├── layout/          # AppShell, StatusBar, и т.д.
│   │   └── features/        # Terminal, FileTree, Editor, GitPanel, Settings
│   ├── services/            # PtyService, FileService, GitService, ThemeService
│   ├── adapters/            # ElectronAPI адаптер (единая точка)
│   └── utils/               # DOM, path, event helpers
└── shared/
    ├── constants.js
    └── ipc-channels.js       # Константы имён каналов
```

---

## 4. Миграция: гибридный (блоками)

### Блок 1: Фундамент + UI-Kit (Фазы 1–2 + подготовка Фазы 4)

1. **Константы** — `src/renderer/core/config/`
   - `terminal-config.js` (FONT_SIZE, SCROLLBACK, FONT_FAMILY)
   - `app-config.js` (интервалы, debounce ms, размеры панелей)
   - `ui-dimensions.js` (кнопки, отступы)

2. **IPC-каналы** — `src/shared/ipc-channels.js`
   - Все строковые имена каналов (`'pty:data'`, `'fs:readDir'`, и т.д.) → константы

3. **UI-Kit base/**
   - `components/base/button/button.js` + `.css`
   - `components/base/context-menu/` — порт существующего `context-menu.js`
   - `components/base/tabs/` — generic `DraggableTabs` (подготовка к Фазе 4)
   - `components/base/panel/` — resizable panel wrapper

4. **Извлечение `setupTabHandlers`**
   - `features/terminal/terminal-keyboard-handler.js`
   - `features/terminal/terminal-osc-handler.js`

**Критерий завершения:** Новые файлы существуют, старые код работает, никаких регрессий.

---

### Блок 2: Состояние + Event Bus + DraggableTabs (Фазы 3–4)

1. **Event Bus** — `src/renderer/core/event-bus.js`
   - `on(event, handler)`, `off(event, handler)`, `emit(event, payload)`
   - Scoped bus per feature

2. **State Store** — `src/renderer/core/state-store.js`
   - Иммутабельное обновление через `setPath`
   - `subscribe(fn)` → `(state, changedPath)`
   - Подмодели: `ui.*`, `tabs.*`, `editor.*`, `settings.*`

3. **Порт `theme` и `settings` в Store**
   - `currentThemeName`, `sidebarVisible`, `editorVisible` → `state-store`
   - Старые глобальные переменные удаляются после миграции потребителей

4. **Generic `DraggableTabs`**
   - `new DraggableTabs(container, { onReorder, onRenderTab })`
   - `TabBar` и `EditorPanel` переписываются на его основе

**Критерий завершения:** Темы, настройки, видимость панелей управляются через Store. Вкладки терминала и редактора используют `DraggableTabs`. Feature-flag для отката.

---

### Блок 3: DI + Main процесс (Фазы 5–6)

1. **DI-контейнер** — `src/renderer/core/container.js`
   - `register(name, factory)`, `resolve(name)`
   - Синглтоны по умолчанию

2. **Адаптеры** — `src/renderer/adapters/electron-api.js`
   - `ElectronFsAdapter implements FileSystemPort`
   - `ElectronGitAdapter implements GitPort`
   - Все компоненты получают порты через DI, не обращаются к `window.electronAPI`

3. **Сервисы** — `src/renderer/services/`
   - `PtyService`, `FileService`, `GitService`, `ThemeService`, `SettingsService`
   - Принимают адаптеры через конструктор

4. **Main процесс**
   - `src/main/ipc-handlers/pty-handlers.js`, `fs-handlers.js`, `git-handlers.js`
   - `src/main/services/` — PtyManager, FileManager, GitService (бизнес-логика)
   - `src/main/index.js` → только bootstrap и регистрация handlers

**Критерий завершения:** `index.js` (renderer) — bootstrap-only. `index.js` (main) — bootstrap-only. Компоненты не знают про `window.electronAPI`.

---

## 5. Критерии качества для каждого нового файла

- [ ] Единственная ответственность (SRP)
- [ ] Dependency injection (конструктор/options)
- [ ] Нет прямых зависимостей от `window.*`
- [ ] JSDoc для публичных методов
- [ ] Используются константы из `core/config/` вместо литералов
- [ ] Метод `destroy()` для cleanup
- [ ] Не мутирует глобальное состояние напрямую
- [ ] Коммуникация через события / Store

---

## 6. Риски и mitigations

| Риск | Mitigation |
|------|------------|
| Регрессия при миграции состояния | Feature-flag: старая логика рядом, постепенная подмена |
| Конфликты с параллельной разработкой | Короткоживущие ветки (1 блок = 1 ветка), быстрый merge |
| DraggableTabs ломает DnD в TabBar/EditorPanel | Unit-тесты на reorder-логику, ручное тестирование DnD |
| DI усложняет отладку | Container логирует resolve-цепочки (dev mode) |
| Main IPC разделение ломает существующие каналы | IPC-константы сначала, рефакторинг handlers потом |

---

## 7. Зависимости

- Нет внешних библиотек (pure JavaScript, Electron API)
- `xterm.js`, `CodeMirror 6`, `node-pty`, `simple-git` — остаются без изменений

---

## 8. Не в scope

- Переписывание на TypeScript
- Добавление unit-test framework (Jest/Vitest) — рекомендуется, но не блокирует
- Изменение UI/UX (визуальный дизайн остаётся)
- Рефакторинг `themes.js` или `editor-languages.js` — они уже изолированы
