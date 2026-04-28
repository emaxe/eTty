# Чеклист: новый UI-компонент

Выполняй при создании нового компонента в `src/renderer/`.

## Перед созданием

- [ ] Проверить `src/renderer/components/base/` — нет ли похожего компонента
- [ ] Определить место: `base/` (переиспользуемый UI-kit) или конкретная фича (рядом с feature-файлами)

## Структура файла

- [ ] Класс экспортируется: `export class ComponentName { ... }`
- [ ] Зависимости принимаются через constructor (DI pattern):
  ```js
  constructor({ eventBus, stateStore, electronApi }) { ... }
  ```
- [ ] Не обращается к `window.electronAPI` напрямую — только через адаптер `core/adapters/electron-api.js`, полученный из DI Container

## Коммуникация и состояние

- [ ] Коммуникация с другими компонентами — через EventBus (`this._eventBus.emit()` / `this._eventBus.on()`)
- [ ] Shared state — через StateStore (`stateStore.get()` / `stateStore.set()` / `stateStore.subscribe()`)
- [ ] Приватное состояние компонента допустимо в private fields

## Константы

- [ ] Числовые значения (размеры, интервалы, лимиты) — в `src/renderer/core/config/` (`app-config.js`, `ui-dimensions.js`, `terminal-config.js`)
- [ ] Не хардкодить цвета — использовать CSS-переменные из тем (`styles.css :root`)

## Cleanup

- [ ] Метод `destroy()` реализован:
  - Отписка от EventBus (все `.on()` имеют парный `.off()` в destroy)
  - Отписка от StateStore (`.subscribe()` возвращает unsubscribe fn — вызвать)
  - Очистка таймеров (`clearTimeout`, `clearInterval`)
  - Удаление DOM-элементов или слушателей

## Регистрация

- [ ] Компонент зарегистрирован в DI Container (`src/renderer/core/container.js`) если используется другими компонентами
- [ ] Если нужны стили — добавлены в `src/renderer/styles.css` с CSS-переменными
