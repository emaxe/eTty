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

  // Сколько после отпускания двух пальцев гасим инерцию колеса, чтобы терминал не «доезжал» прокруткой
  WHEEL_MOMENTUM_MS: 900,

  // Вспышка стрелки при свайпе
  FLASH_MS: 450,
  FLASH_TRAVEL_PX: 24
})
