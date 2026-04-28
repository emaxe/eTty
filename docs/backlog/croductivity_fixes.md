# eTty Performance Fixes — Task List

> Создано после профилирования: main process CPU ~163%, opencode 55% CPU,
> renderer GPU load, 1.1 GB RSS. Причины диагностированы, фиксы реализованы.
>
> **Статус:** Все P0/P1 фиксы выполнены и влиты в `main`. Сборка проходит.

---

## 1. Batching + debounce в node-pty `onData` (КРИТИЧНО) — ✅ ВЫПОЛНЕНО

**Проблема:** `ptyProcess.onData()` отправляет каждый chunk данных через IPC
немедленно, без буферизации. При запущенном TUI (Copilot CLI) — сотни
`webContents.send('pty:data', ...)` в секунду. Main process 100% занят
сериализацией V8-строк и IPC.

**Где:** `src/main/pty-manager.js`, метод `create()` (batching код ~строки 99–123)

**Что сделано:**
- Буферизация данных в массив `string[]`
- Flush каждые **8 мс** через `setTimeout(..., PTY_DATA_BATCH_MS)`
- Формат IPC: склеенная строка из всех накопленных chunks

**Ожидаемый эффект:** снижение CPU main process с ~160% до <20% при TUI.

**Конфигурация:** `APP_CONFIG.PTY_DATA_BATCH_MS = 8` (см. `src/renderer/core/config/app-config.js`)

---

## 2. Убрать/заменить CSS `filter` анимацию glow (ВЫСОКИЙ) — ✅ ВЫПОЛНЕНО

**Проблема:** `@keyframes focus-glow-shimmer` с `filter: hue-rotate() brightness()`
на `::before` overlay (`inset: 0`, `z-index: 999`) заставляет Chromium
перекомпоновывать весь терминальный canvas 60 FPS. Это одна из самых
дорогих CSS-операций.

**Где:** `src/renderer/styles.css` (glow-анимация убрана/заменена)

**Что сделано:**
- Убрана анимация `hue-rotate` + `brightness`
- Заменена на статичный glow или `box-shadow` transition

**Ожидаемый эффект:** снижение GPU/Renderer load, меньше dropped frames.

---

## 3. Debounce на ResizeObserver + fitAddon.fit() (СРЕДНИЙ) — ✅ ВЫПОЛНЕНО

**Проблема:** `ResizeObserver` вызывает `fitAddon.fit()` на каждый resize-event
без throttling. При sidebar resize, fullscreen toggle, анимации — лишние
`term.resize()` → `pty:resize` → лишняя нагрузка на PTY + IPC.

**Где:** `src/renderer/index.js`, debounce helper + ResizeObserver (~строка 916)

**Что сделано:**
```js
const debouncedFit = debounce(() => tabBar.getActive()?.fitAddon.fit(), 150)
new ResizeObserver(debouncedFit).observe(terminalContainerEl)
```

**Конфигурация:** `APP_CONFIG.RESIZE_OBSERVER_DEBOUNCE_MS = 150`

**Ожидаемый эффект:** меньше resize-циклов, меньше flicker.

---

## 4. Ограничить `scrollback` xterm.js (СРЕДНИЙ) — ✅ ВЫПОЛНЕНО

**Проблема:** `scrollback: 10000` на каждую вкладку. При нескольких вкладках
с активным выводом — десятки тысяч строк в DOM + буфер. Утечка памяти
в renderer при долгой работе.

**Где:** `src/renderer/core/config/terminal-config.js`

**Что сделано:**
- Уменьшено до `SCROLLBACK: 2500`
- Константа вынесена в `TERMINAL_CONFIG.SCROLLBACK`

**Конфигурация:** `TERMINAL_CONFIG.SCROLLBACK = 2500`

**Ожидаемый эффект:** снижение RSS на ~100–300 МБ при 3–5 вкладках.

---

## 5. Debounce на `fs.watch` → `fs:dir-changed` events (СРЕДНИЙ) — ✅ ВЫПОЛНЕНО

**Проблема:** `fs.watch` на директориях (FileManager) генерирует множество
событий при массовых операциях (npm install, git checkout). Renderer
получает лавину `fs:dir-changed` и перерендеривает дерево файлов.

**Где:** `src/main/file-manager.js`, `watchDir()` (debounce на строке ~205)

**Что сделано:**
- Debounce увеличен с 300 мс до **500 мс**
- Константа вынесена в `APP_CONFIG.FS_WATCH_DEBOUNCE_MS`
- Убраны `console.log` в hot path

**Конфигурация:** `APP_CONFIG.FS_WATCH_DEBOUNCE_MS = 500`

**Ожидаемый эффект:** меньше перерендеров дерева, плавнее UI.

---

## 6. Cleanup detached CodeMirror views при переключении вкладок (НИЗКИЙ) — ✅ ВЫПОЛНЕНО

**Проблема:** `suspendState()` detaches CodeMirror DOM, но не вызывает
`view.destroy()`. При многих переключениях вкладок — накапливаются
orphaned DOM nodes и CodeMirror internal state.

**Где:** `src/renderer/index.js`, обработчики `tab.switch` и `tab.close`

**Что сделано:**
- При `tab.switch` — `view.destroy()` для всех `_detachedTabs` предыдущей вкладки
- При `tab.close` — аналогичный cleanup перед `removeTab()`

**Ожидаемый эффект:** стабильный RSS при частом switching между вкладками.

---

## 7. (Инфра) Performance benchmark скрипт (НИЗКИЙ) — ✅ ВЫПОЛНЕНО

**Что сделано:**
- Скрипт `scripts/profile.sh` — запускает `sample` + `top` на N секунд
  и сохраняет отчёт в `/tmp/etty-sample.txt`

---

## Приоритеты (все выполнены)

| # | Задача | Влияние | Сложность | Приоритет | Статус |
|---|--------|---------|-----------|-----------|--------|
| 1 | Batching `onData` | Огромное | Низкая | **P0 — критично** | ✅ |
| 2 | Убрать CSS `filter` | Большое | Низкая | **P0 — высоко** | ✅ |
| 3 | Debounce ResizeObserver | Среднее | Низкая | P1 | ✅ |
| 4 | Ограничить scrollback | Среднее | Низкая | P1 | ✅ |
| 5 | Debounce fs.watch | Среднее | Средняя | P1 | ✅ |
| 6 | Cleanup detached views | Малое | Средняя | P2 | ✅ |
| 7 | Performance benchmark | Инфра | Низкая | P2 | ✅ |

---

## Конфигурационные константы (вынесены в `src/renderer/core/config/`)

| Константа | Значение | Файл |
|-----------|----------|------|
| `PTY_DATA_BATCH_MS` | 8 | `app-config.js` |
| `RESIZE_OBSERVER_DEBOUNCE_MS` | 150 | `app-config.js` |
| `FS_WATCH_DEBOUNCE_MS` | 500 | `app-config.js` |
| `SCROLLBACK` | 2500 | `terminal-config.js` |

---

## Как проверять

```bash
# 1. Запустить eTty
# 2. Открыть 2–3 вкладки, в одной запустить copilot / opencode
# 3. Подождать 30 секунд
# 4. Снять sample:
sample $(pgrep -f "eTty.app/Contents/MacOS/eTty") 5 > /tmp/etty-sample.txt
# 5. Проверить CPU:
ps aux | grep -i etty | grep -v grep
# Ожидаемо: main < 30%, renderer < 10%, GPU < 5%
```
