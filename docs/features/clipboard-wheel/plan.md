# Буфер обмена в колесе команд (mobile) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вставка из системного буфера и копирование выделения в колесе своих команд (двойной тап двумя пальцами), плюс попадание `OSC 52` из TUI-приложений в системный буфер.

**Architecture:** Системный буфер прячется за двумя хелперами в `lib/platform/system_clipboard.dart` (без SSH и домена). Домен `QuickCommand` получает `kind` (текст/вставка/копирование), встроенная константная группа «Буфер» подставляется первым сектором через `QuickCommandsDefaults.withClipboard`, а `TerminalGestureLayer` разводит выбор команды по `kind`. `OSC 52` уже разбирается в `OscTap`; не хватает только передачи `onClipboardWrite` из `TerminalPage._addTab`.

**Tech Stack:** Flutter, `xterm` 4.x, `flutter_riverpod`, `flutter_test` (+ `TestDefaultBinaryMessengerBinding` для мока `Clipboard`).

**Spec:** `docs/features/clipboard-wheel/spec.md`

## Global Constraints

- Тексты в UI ровно такие: группа `Буфер` (`id: 'g-clipboard'`), команды `📋 Вставить` и `⧉ Копировать`.
- Снеки ровно такие: `Буфер обмена пуст`, `Нет выделения: выделите текст long-press`, `Скопировано: N симв.`
- `quickCommands` в `AppSettingsStore` не меняется; `kind` в JSON не пишется и не читается; миграции нет.
- Новых зависимостей нет: `Clipboard`/`PlatformException` — из `package:flutter/services.dart`.
- Не трогаем `KeyBar`, колесо быстрых действий, `CustomTextEdit`, `QuickActionsConfig.maxGroups`/`maxCommandsPerGroup`.
- `OSC 52` только пишет в буфер: `Pt == '?'` — игнор, чтение буфера устройства наружу не отдаётся.
- Все публичные типы/функции — с doc-комментарием на русском в стиле окружающего кода; зависимости — через конструктор (инвариант DI).
- Проверка после каждой задачи: `cd mobile && flutter analyze` без новых замечаний.
- Коммит на задачу, сообщение без трейлеров об авторстве инструмента.

## Review Focus

- Текст из буфера с `\r`, `\r\n` и хвостовым переводом строки должен уходить в канал байт-в-байт (переводы строк не нормализуем) — тест в Task 3.
- Большой буфер (десятки КБ) не обрезается — тест в Task 3.
- Многострочное выделение копируется с переводами строк, а не склеивается — тест в Task 3.
- `OSC 52` с битым base64/non-UTF8 и с `?` не пишет в буфер, не читает его и не рвёт вкладку — тесты в Task 4 (плюс существующие `test/domain/osc_tap_test.dart`).
- `OSC 52` от фоновой/неактивной вкладки всё равно обновляет буфер и не трогает UI (колбэк пер-вкладочный, снеков нет) — тест в Task 4.

---

### Task 1: Хелперы системного буфера

**Files:**
- Create: `mobile/lib/platform/system_clipboard.dart`
- Test: `mobile/test/platform/system_clipboard_test.dart`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `Future<String?> readSystemClipboard()` — текст или `null` (пусто/не текст/ошибка платформы).
  - `Future<void> writeSystemClipboard(String text)` — пишет `kTextPlain`, ошибки платформы не пробрасывает. Совместим с `void Function(String)` (используется как колбэк `onClipboardWrite`).

- [ ] **Step 1: Написать падающий тест**

`mobile/test/platform/system_clipboard_test.dart`:

```dart
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/platform/system_clipboard.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final calls = <MethodCall>[];

  void mockPlatform(Future<Object?> Function(MethodCall call) handler) {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) {
      calls.add(call);
      return handler(call);
    });
  }

  setUp(calls.clear);
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null);
  });

  test('readSystemClipboard возвращает текст из платформенного канала', () async {
    mockPlatform((call) async => {'text': 'hello'});
    expect(await readSystemClipboard(), 'hello');
    expect(calls.single.method, 'Clipboard.getData');
  });

  test('readSystemClipboard: пустой ответ платформы — null', () async {
    mockPlatform((call) async => null);
    expect(await readSystemClipboard(), isNull);
  });

  test('writeSystemClipboard пишет текст через Clipboard.setData', () async {
    mockPlatform((call) async => null);
    await writeSystemClipboard('bye');
    expect(calls.single.method, 'Clipboard.setData');
    expect(calls.single.arguments, {'text': 'bye'});
  });

  test('writeSystemClipboard: PlatformException не пробрасывается', () async {
    mockPlatform((call) async => throw PlatformException(code: 'boom'));
    await expectLater(writeSystemClipboard('x'), completes);
  });

  test('readSystemClipboard: PlatformException — null', () async {
    mockPlatform((call) async => throw PlatformException(code: 'boom'));
    expect(await readSystemClipboard(), isNull);
  });
}
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd mobile && flutter test test/platform/system_clipboard_test.dart`
Expected: FAIL — `Error: Couldn't resolve the package 'mobile' ... system_clipboard.dart` (файла нет).

- [ ] **Step 3: Реализовать `mobile/lib/platform/system_clipboard.dart`**

```dart
import 'package:flutter/services.dart';

Future<String?> readSystemClipboard() async { ... }

Future<void> writeSystemClipboard(String text) async { ... }
```

Тела: `Clipboard.getData(Clipboard.kTextPlain)` → `data?.text`; `Clipboard.setData(ClipboardData(text: text))`; обе обёрнуты в `try/on PlatformException` (`null` / тихий игнор). Doc-комментарий: хелперы сознательно не бросают — буфер обмена это побочный эффект, из-за него не должны падать терминал и разбор `OSC 52`.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `cd mobile && flutter test test/platform/system_clipboard_test.dart`
Expected: PASS (5 тестов).

- [ ] **Step 5: Коммит**

```bash
git add mobile/lib/platform/system_clipboard.dart mobile/test/platform/system_clipboard_test.dart
git commit -m "feat(mobile): хелперы системного буфера обмена"
```

---

### Task 2: Домен — вид команды и встроенная группа «Буфер»

**Files:**
- Modify: `mobile/lib/domain/quick_commands.dart`
- Test: `mobile/test/domain/quick_commands_test.dart` (дописать тесты)

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `enum QuickCommandKind { text, copy, paste }` (в `quick_commands.dart`).
  - `QuickCommand({required String id, required String label, required String text, QuickCommandKind kind = QuickCommandKind.text})`.
  - `static const QuickCommandGroup QuickCommandsDefaults.clipboardGroup`.
  - `static List<QuickCommandGroup> QuickCommandsDefaults.withClipboard(List<QuickCommandGroup> groups)` → `[clipboardGroup, ...groups]`.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `mobile/test/domain/quick_commands_test.dart`:

```dart
test('withClipboard ставит «Буфер» первым сектором и не теряет группы', () {
  final composed = QuickCommandsDefaults.withClipboard(QuickCommandsDefaults.groups);
  expect(composed.first.id, 'g-clipboard');
  expect(composed.first.label, 'Буфер');
  expect(composed.length, QuickCommandsDefaults.groups.length + 1);
  expect(composed.sublist(1), QuickCommandsDefaults.groups);
});

test('«Буфер»: подписи и действия paste/copy', () {
  final commands = QuickCommandsDefaults.clipboardGroup.commands;
  expect(commands.map((c) => c.label), ['📋 Вставить', '⧉ Копировать']);
  expect(commands.map((c) => c.kind), [QuickCommandKind.paste, QuickCommandKind.copy]);
});

test('copyWith сохраняет kind', () {
  const c = QuickCommand(id: 'x', label: 'A', text: '', kind: QuickCommandKind.copy);
  expect(c.copyWith(label: 'B').kind, QuickCommandKind.copy);
});

test('kind не попадает в JSON и читается как text', () {
  final json = encodeQuickCommands(QuickCommandsDefaults.withClipboard(const []));
  expect(json.contains('"kind"'), isFalse);
  final decoded = decodeQuickCommands(json)!;
  expect(decoded.single.commands.first.kind, QuickCommandKind.text);
});
```

И в `mobile/test/ui/settings/quick_commands_screen_test.dart` — «Буфер» не попадает в редактор:

```dart
testWidgets('встроенная группа «Буфер» в настройках не показывается', (tester) async {
  await pump(tester);
  expect(find.text('Буфер'), findsNothing);
  expect(find.text('📋 Вставить'), findsNothing);
});
```

(сигнатура `pump` — как в существующих тестах файла, провайдер переопределяется на `store`).

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd mobile && flutter test test/domain/quick_commands_test.dart`
Expected: FAIL — нет `QuickCommandKind`, `clipboardGroup`, `withClipboard`.

- [ ] **Step 3: Реализовать**

В `mobile/lib/domain/quick_commands.dart`: добавить `enum QuickCommandKind { text, copy, paste }` с doc-комментарием (действие, объявляемое кодом; в JSON не сохраняется); поле `kind` в `QuickCommand` (по умолчанию `text`, `copyWith` пробрасывает), `clipboardGroup` и `withClipboard` в `QuickCommandsDefaults` (doc: «системная группа, не редактируется в настройках и не хранится в `AppSettingsStore`»). `toJson`/`decodeQuickCommands` не трогать.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `cd mobile && flutter test test/domain/quick_commands_test.dart test/ui/settings/quick_commands_screen_test.dart`
Expected: PASS (новые тесты домена и «Буфер» не виден в редакторе).

- [ ] **Step 5: Коммит**

```bash
git add mobile/lib/domain/quick_commands.dart mobile/test/domain/quick_commands_test.dart mobile/test/ui/settings/quick_commands_screen_test.dart
git commit -m "feat(mobile): вид команды колеса и встроенная группа «Буфер»"
```

---

### Task 3: Вставка и копирование в колесе команд

**Files:**
- Modify: `mobile/lib/ui/terminal/terminal_gestures.dart`
- Modify: `mobile/README.md` (раздел про колёса)
- Test: `mobile/test/ui/terminal/terminal_gestures_test.dart`

**Interfaces:**
- Consumes: `readSystemClipboard()`/`writeSystemClipboard()` (Task 1), `QuickCommandKind`, `QuickCommandsDefaults.withClipboard` (Task 2).
- Produces: поведение `TerminalGestureLayer` — выбор команды `paste`/`copy` в колесе команд; `_onTwoFingerDoubleTap` больше не сбрасывает выделение.

- [ ] **Step 1: Подготовить тестовую обвязку (без ассертов)**

В `mobile/test/ui/terminal/terminal_gestures_test.dart`, в группе `TerminalGestureLayer`:
- объявить на уровне группы `late xterm.TerminalController controller;` и в `pump` убрать локальное объявление (`controller = xterm.TerminalController()`), чтобы тесты могли ставить выделение;
- добавить хелперы и мок платформенного канала:

```dart
String? clipboardText;
late List<String> clipboardWrites;

void mockClipboard() {
  clipboardText = null;
  clipboardWrites = [];
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(SystemChannels.platform, (call) async {
    switch (call.method) {
      case 'Clipboard.getData':
        return clipboardText == null ? null : {'text': clipboardText};
      case 'Clipboard.setData':
        clipboardWrites.add((call.arguments as Map)['text'] as String);
        return null;
    }
    return null;
  });
}
```

Вызвать `mockClipboard()` в `setUp` группы и снять мок в `tearDown` (`setMockMethodCallHandler(SystemChannels.platform, null)`), добавить нужные импорты (`package:flutter/services.dart`, `package:mobile/domain/quick_commands.dart` уже есть).

- [ ] **Step 2: Написать падающие тесты**

```dart
testWidgets('«Вставить» шлёт текст из буфера в канал', (tester) async {
  await pump(tester, isTmux: false, groups: QuickCommandsDefaults.withClipboard(const []));
  clipboardText = 'ls -la';
  await openCommands(tester); // одна группа → колесо сразу на уровне команд
  await tester.tapAt(const Offset(400, 225)); // «Вставить» — сектор 0 из 2
  await tester.pumpAndSettle();
  expect(out, ['ls -la']);
});

testWidgets('пустой буфер — снек и ничего в канал', (tester) async {
  await pump(tester, isTmux: false, groups: QuickCommandsDefaults.withClipboard(const []));
  await openCommands(tester);
  await tester.tapAt(const Offset(400, 225));
  await tester.pumpAndSettle();
  expect(out, isEmpty);
  expect(find.text('Буфер обмена пуст'), findsOneWidget);
});

testWidgets('«Копировать» пишет выделение в буфер и снимает его', (tester) async {
  await pump(tester, isTmux: false, groups: QuickCommandsDefaults.withClipboard(const []));
  terminal.write('hello world');
  controller.setSelection(
    terminal.buffer.createAnchor(0, 0),
    terminal.buffer.createAnchor(11, 0),
  );
  await openCommands(tester);
  await tester.tapAt(const Offset(400, 375)); // «Копировать» — сектор 1 из 2
  await tester.pumpAndSettle();
  expect(clipboardWrites.single, contains('hello world'));
  expect(controller.selection, isNull);
  expect(out, isEmpty);
});

testWidgets('многострочное выделение копируется с переводами строк', (tester) async {
  await pump(tester, isTmux: false, groups: QuickCommandsDefaults.withClipboard(const []));
  terminal.write('one\r\ntwo');
  controller.setSelection(
    terminal.buffer.createAnchor(0, 0),
    terminal.buffer.createAnchor(3, 1),
  );
  await openCommands(tester);
  await tester.tapAt(const Offset(400, 375));
  await tester.pumpAndSettle();
  expect(clipboardWrites.single, contains('\n'));
  expect(clipboardWrites.single, contains('one'));
  expect(clipboardWrites.single, contains('two'));
});

testWidgets('нет выделения — снек, буфер не тронут', (tester) async {
  await pump(tester, isTmux: false, groups: QuickCommandsDefaults.withClipboard(const []));
  await openCommands(tester);
  await tester.tapAt(const Offset(400, 375));
  await tester.pumpAndSettle();
  expect(clipboardWrites, isEmpty);
  expect(find.text('Нет выделения: выделите текст long-press'), findsOneWidget);
});

testWidgets('«Буфер» — первый сектор корня при пользовательских группах', (tester) async {
  await pump(
    tester,
    isTmux: false,
    groups: QuickCommandsDefaults.withClipboard(QuickCommandsDefaults.groups),
  );
  clipboardText = 'pwd';
  await openCommands(tester);
  await tester.tapAt(const Offset(400, 225)); // сектор 0 из 4 — «Буфер»
  await tester.pumpAndSettle();
  await tester.tapAt(const Offset(400, 225)); // «Вставить» внутри группы
  await tester.pumpAndSettle();
  expect(out, ['pwd']);
});

testWidgets('открытие колеса команд не сбрасывает выделение', (tester) async {
  await pump(tester, isTmux: false, groups: QuickCommandsDefaults.withClipboard(const []));
  terminal.write('hello world');
  controller.setSelection(
    terminal.buffer.createAnchor(0, 0),
    terminal.buffer.createAnchor(11, 0),
  );
  await openCommands(tester);
  expect(controller.selection, isNotNull);
});

testWidgets('вставка сохраняет \\r\\n и не режет большой текст', (tester) async {
  final big = '${'x' * 10000}\r\nsecond line\r\n';
  await pump(tester, isTmux: false, groups: QuickCommandsDefaults.withClipboard(const []));
  clipboardText = big;
  await openCommands(tester);
  await tester.tapAt(const Offset(400, 225));
  await tester.pumpAndSettle();
  expect(out, [big]);
});

testWidgets('вставка оборачивается в bracketed paste, если режим включён', (tester) async {
  await pump(tester, isTmux: false, groups: QuickCommandsDefaults.withClipboard(const []));
  terminal.write('\x1b[?2004h');
  clipboardText = 'a\rb';
  await openCommands(tester);
  await tester.tapAt(const Offset(400, 225));
  await tester.pumpAndSettle();
  expect(out, ['\x1b[200~a\rb\x1b[201~']);
});
```

Существующий тест «без команд двойной тап показывает подсказку, а не колесо» **оставить без изменений**: он проходит пустой список групп напрямую и остаётся стражем программной ошибки (REQ-5).

- [ ] **Step 3: Убедиться, что новые тесты падают**

Run: `cd mobile && flutter test test/ui/terminal/terminal_gestures_test.dart`
Expected: FAIL — `'ls -la'` не уходит в канал (команда `paste` встраивается как текст `''`), `clipboardWrites` пуст, выделение сбрасывается при открытии колеса.

- [ ] **Step 4: Реализовать в `terminal_gestures.dart`**

1. Импорты: `package:mobile/platform/system_clipboard.dart`.
2. В `_onTwoFingerDoubleTap` удалить ветку `if (widget.controller.selection != null) widget.controller.clearSelection();` (в `_onThreeFingerTap` — оставить).
3. В `_onCommandsWheelTap` заменить прямой `widget.terminal.paste(text)` на развод по виду:

```dart
final command = widget.commandGroups[group].commands[sector];
_closeWheel();
switch (command.kind) {
  case QuickCommandKind.text:
    widget.terminal.paste(command.text);
  case QuickCommandKind.paste:
    unawaited(_pasteFromClipboard());
  case QuickCommandKind.copy:
    unawaited(_copySelectionToClipboard());
}
```

(порядок с `HapticFeedback.lightImpact()` — как сейчас: вибрация, закрытие колеса, действие).

4. Добавить приватные методы слоя:

```dart
Future<void> _pasteFromClipboard() async { ... }
Future<void> _copySelectionToClipboard() async { ... }
```

`_pasteFromClipboard`: `final text = await readSystemClipboard();` → `if (!mounted) return;` → `null`/пусто → `_snack('Буфер обмена пуст')` и выход; иначе `widget.terminal.paste(text)`.
`_copySelectionToClipboard`: `final selection = widget.controller.selection;` → `null` или пустой текст из `widget.terminal.buffer.getText(selection)` → `_snack('Нет выделения: выделите текст long-press')`; иначе `await writeSystemClipboard(text)`, `if (!mounted) return;`, `widget.controller.clearSelection()`, `_snack('Скопировано: ${text.length} симв.')`.

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `cd mobile && flutter test test/ui/terminal/terminal_gestures_test.dart`
Expected: PASS (все, включая старые тесты колеса и жестов).

- [ ] **Step 6: README**

В `mobile/README.md` в пункте «Колесо своих команд» дописать: первым сектором — «Буфер» (`📋 Вставить` — из системного буфера с bracketed paste; `⧉ Копировать` — выделение, сделанное long-press, в системный буфер).

- [ ] **Step 7: Коммит**

```bash
git add mobile/lib/ui/terminal/terminal_gestures.dart mobile/test/ui/terminal/terminal_gestures_test.dart mobile/README.md
git commit -m "feat(mobile): вставка и копирование в колесе команд"
```

---

### Task 4: `OSC 52` из TUI — в системный буфер

**Files:**
- Modify: `mobile/lib/ui/terminal/terminal_page.dart`
- Modify: `mobile/README.md` (пункт про буфер)
- Modify: `docs/plans/mob/plan.md` (новый REQ-24)
- Test: `mobile/test/domain/tab_controller_test.dart` (дописать группу)

**Interfaces:**
- Consumes: `writeSystemClipboard` (Task 1); `QuickCommandsDefaults.withClipboard` (Task 2).
- Produces: `TerminalPage` передаёт `onClipboardWrite: writeSystemClipboard` в `domain.TabController` и `commandGroups: QuickCommandsDefaults.withClipboard(commandGroups)` в `TerminalGestureLayer`.

- [ ] **Step 1: Написать тесты контракта `TabController` для `OSC 52`**

Дописать в `mobile/test/domain/tab_controller_test.dart` (группа рядом с «вывод через OscTap», по его образцу с `StreamController<Uint8List>`):

```dart
test('OSC 52 из вывода вызывает onClipboardWrite и не попадает в output', () async { ... });
// payload: base64.encode(utf8.encode('copy me')) → ожидание clipboard == ['copy me'],
// utf8.decode(outputBytes) == 'ab' для входа 'a\x1b]52;c;<b64>\x07b'

test('OSC 52 с пустым payload очищает буфер (колбэк с пустой строкой)', () async { ... });
// вход: '\x1b]52;c;\x07' → clipboard == ['']

test('OSC 52 с запросом чтения (?) колбэк не вызывает', () async { ... });
// вход: '\x1b]52;c;?\x07' → clipboard isEmpty

test('OSC 52 с битым base64 игнорируется', () async { ... });
// вход: 'a\x1b]52;c;%%%\x07b' → clipboard isEmpty, utf8.decode(outputBytes) == 'ab'
```

Это характеризационные тесты (домен уже прокидывает колбэк в `OscTap`): они зелёные сразу и фиксируют контракт, на который опирается `TerminalPage`. Шаги «убедиться, что падает» для них нет — не выдавайте их за TDD-цикл.

- [ ] **Step 2: Прогнать тесты**

Run: `cd mobile && flutter test test/domain/tab_controller_test.dart`
Expected: PASS (4 новых теста). Если падает — сначала разобраться с `OscTap`/`TabController`, не менять ожидания.

- [ ] **Step 3: Подключить колбэк в `TerminalPage`**

В `mobile/lib/ui/terminal/terminal_page.dart`:
- импорт `package:mobile/platform/system_clipboard.dart`;
- в `_addTab` при создании `domain.TabController` добавить `onClipboardWrite: writeSystemClipboard,`;
- в `build` заменить `commandGroups: commandGroups` на `commandGroups: QuickCommandsDefaults.withClipboard(commandGroups)`.

- [ ] **Step 4: Проверить анализ и тесты**

Run: `cd mobile && flutter analyze && flutter test`
Expected: анализ чистый (нет новых замечаний), все тесты PASS.

- [ ] **Step 5: Документация**

`mobile/README.md` — в пункте про буфер дописать: копирование, инициированное самим приложением (`tmux` copy-mode, `vim` с `clipboard=unnamed`, любой `OSC 52`), попадает в системный буфер; запрос чтения (`OSC 52 ... ?`) игнорируется.
`docs/plans/mob/plan.md` — новый пункт:

```markdown
- **REQ-24.** Буфер обмена: в колесе своих команд — встроенная группа «Буфер» (вставка из
  системного буфера с bracketed paste, копирование выделения), `OSC 52` из TUI-приложений пишется
  в системный буфер (`docs/features/clipboard-wheel/spec.md`).
```

- [ ] **Step 6: Коммит**

```bash
git add mobile/lib/ui/terminal/terminal_page.dart mobile/test/domain/tab_controller_test.dart mobile/README.md docs/plans/mob/plan.md
git commit -m "feat(mobile): OSC 52 пишет в системный буфер обмена"
```

---

### Task 5: Финальная проверка

**Files:**
- Modify: (только если проверка нашла проблемы)

- [ ] **Step 1: Полный прогон**

Run: `cd mobile && flutter analyze && flutter test`
Expected: без замечаний анализа, все тесты PASS.

- [ ] **Step 2: Проверить, что не осталось мёртвых путей**

Run: `cd mobile && grep -rn "clearSelection" lib/ui/terminal/terminal_gestures.dart`
Expected: сброс остаётся в `_onTap` и в `_onThreeFingerTap`, в `_onTwoFingerDoubleTap` его нет.

- [ ] **Step 3: Ручная проверка на устройстве/симуляторе (`flutter run`)**

- Двойной тап двумя пальцами → «Буфер» → «Вставить»: текст из буфера телефона появляется в терминале.
- В `claude`/`vim` (bracketed paste) многострочная вставка не выполняет строки по одной.
- Long-press по слову → двойной тап → «Буфер» → «Копировать» → вставить в заметки: слово на месте.
- Без выделения «Копировать» даёт снек, буфер не меняется.
- tmux copy-mode (выделить и `Enter`) → вставить в заметки: текст на месте (это и есть `OSC 52`).

- [ ] **Step 4: Коммит правок, если они были**

```bash
git add -A mobile docs/plans/mob/plan.md
git commit -m "fix(mobile): правки по итогам проверки буфера обмена"
```
