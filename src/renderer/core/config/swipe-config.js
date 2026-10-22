/**
 * Свайпы двумя пальцами по терминалу (тачпад macOS, см. features/terminal/terminal-swipe.js).
 */

export const SWIPE_CONFIG = Object.freeze({
  DEFAULT_MODE: 'off',

  VERTICAL_OPTIONS: Object.freeze([
    { key: 'off', name: 'Выключено' },
    { key: 'arrows', name: 'Стрелки клавиатуры вверх/вниз' }
  ]),

  HORIZONTAL_OPTIONS: Object.freeze([
    { key: 'off', name: 'Выключено' },
    { key: 'arrows', name: 'Стрелки клавиатуры влево/вправо' },
    { key: 'tabs', name: 'Переключение между вкладками браузера' }
  ]),

  // Модификатор, который нужно держать при вертикальном свайпе, чтобы он не мешал прокрутке.
  // primary — Cmd на macOS, Ctrl на остальных платформах.
  DEFAULT_MODIFIER: 'none',
  MODIFIER_OPTIONS: Object.freeze([
    { key: 'none', name: 'Не требуется' },
    { key: 'shift', name: 'Shift' },
    { key: 'alt', name: 'Option' },
    { key: 'primary', name: 'Cmd/Ctrl' }
  ]),

  // Сколько после отпускания двух пальцев гасим инерцию колеса, чтобы терминал не «доезжал» прокруткой
  WHEEL_MOMENTUM_MS: 900,

  // Вспышка стрелки при свайпе
  FLASH_MS: 450,
  FLASH_TRAVEL_PX: 24
})
