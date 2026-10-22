import { TAP_GESTURES } from '../../../shared/tap-gesture-recognizer.js'

/**
 * Радиальное меню быстрых команд на терминале (features/radial-menu/).
 * Жесты — настоящие касания: сырые касания тачпада macOS (нативный аддон, main-процесс)
 * и сенсорный экран (Pointer Events). Клики мыши и тачпада жестами не считаются.
 */

export const RADIAL_MENU_CONFIG = Object.freeze({
  DEFAULT_ENABLED: true,
  DEFAULT_GESTURE: TAP_GESTURES.TWO_FINGER_DOUBLE_TAP,

  // Подписи жестов для настроек
  GESTURE_OPTIONS: Object.freeze([
    { key: TAP_GESTURES.TWO_FINGER_DOUBLE_TAP, name: 'Двойной тап двумя пальцами' },
    { key: TAP_GESTURES.THREE_FINGER_DOUBLE_TAP, name: 'Двойной тап тремя пальцами' }
  ]),

  // Геометрия кольца (px)
  RADIUS_PX: 150,
  DEAD_ZONE_PX: 34,
  EDGE_MARGIN_PX: 8,
  MAX_LABEL_CHARS: 16,

  EMPTY_TOAST_MS: 2500
})
