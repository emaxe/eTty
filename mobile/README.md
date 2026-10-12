# eTty Mobile

Flutter-приложение для подключения к удалённым серверам по SSH/tmux — мобильный аналог
десктопного eTty. Полная спецификация и план — [docs/plans/mob/plan.md](../docs/plans/mob/plan.md),
прогресс — [docs/plans/mob/checklist.md](../docs/plans/mob/checklist.md).

**Платформы v1:** iOS, Android (`flutter create --platforms=ios,android`, без web/desktop).
**Bundle id:** `com.etty.mobile`.

## Структура

```
lib/
  core/config/   — константы (порт src/shared/ssh-*-config.js десктопа); ЧИСТЫЙ DART,
                   без импорта package:flutter — эти модули тестируются golden-тестами
  remote/        — «протокол eTty»: порт remote-scripts/remote-parse/remote-shell-hooks
                   из src/main/ssh/*.js; тоже чистый Dart, без сети и без Flutter
  transport/     — слой поверх dartssh2 (замена OpenSSH ControlMaster)
  data/          — хранилища: профили подключений, известные host key, экспорт/импорт
  domain/        — доменные сервисы: вкладки, удалённая ФС, tmux-сессии, OSC-парсинг
  ui/            — экраны и виджеты (terminal/, connections/, files/, editor/, tmux/, settings/)
  app/theme/     — тема (порт палитр из src/renderer/themes.js десктопа)
  platform/      — адаптеры к платформенным API (secure storage, биометрия, lifecycle, фон)
test/
  fixtures/remote/ — golden-фикстуры, сгенерированные из JS-кода десктопа
    (../../scripts/gen-remote-fixtures.mjs) — коммитятся, сверяются в CI
spikes/          — выброшенные прототипы (см. plan.md, Блок S); не мержатся, гитигнорены
```

**Инвариант**: `lib/remote/` и `lib/core/config/` не импортируют `package:flutter` — это порт
серверного протокола десктопа, он должен оставаться тестируемым и переносимым независимо от UI.

## Команды

```bash
flutter pub get          # установить зависимости
flutter run               # запустить на подключённом устройстве/симуляторе
flutter analyze           # статический анализ
flutter test               # unit + golden тесты
flutter test --coverage    # с покрытием
```

Сверка совместимости с десктопным протоколом (из корня репозитория):

```bash
node scripts/gen-remote-fixtures.mjs          # перегенерировать fixtures из JS
node scripts/gen-remote-fixtures.mjs --check  # проверить, что fixtures не разошлись (CI)
```

## Зависимости

| Пакет | Роль |
|---|---|
| `dartssh2` | SSH-транспорт (замена системного `ssh` + ControlMaster на десктопе) |
| `xterm` | Эмуляция терминала |
| `flutter_riverpod` | State management / DI (аналог DI Container + StateStore десктопа) |
| `flutter_secure_storage` | Секреты — Keychain (iOS) / Keystore (Android) |
| `local_auth` | Биометрическая блокировка |
| `re_editor` / `re_highlight` | Просмотр и правка файлов с подсветкой синтаксиса |
| `cryptography` | PBKDF2 + AES-256-GCM для экспорта/импорта профилей (`*.ettyx`) |
| `path_provider` | Пути к app-каталогам |
| `file_picker` | Импорт файла профилей |
| `share_plus` | Экспорт файла профилей / публичного ключа |

## Известные ограничения на момент скаффолда

- `lib/main.dart` и `test/widget_test.dart` — ещё дефолтный шаблон `flutter create`
  (счётчик), заменяются в задачах экрана-оболочки (см. `plan.md`, Блок 4).
- Перед стартом транспортного слоя (Блок 2 плана) должны быть закрыты спайки S1–S4
  (Блок S) — они проверяют непроверенные допущения о `dartssh2`/`xterm.dart`.
