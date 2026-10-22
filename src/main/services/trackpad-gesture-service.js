import { dirname, join } from 'path'
import { app, powerMonitor, screen } from 'electron'
import log from 'electron-log'
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'
import { TapGestureRecognizer, TRACKPAD_TAP_PROFILE } from '../../shared/tap-gesture-recognizer.js'
import { SwipeGestureRecognizer, TRACKPAD_SWIPE_PROFILE } from '../../shared/swipe-gesture-recognizer.js'

const ADDON_RELATIVE_PATH = join('native', 'trackpad', 'dist', 'trackpad.node')

/** Загружает нативный аддон тачпада (только macOS); без него жесты тачпада недоступны. */
function loadAddon() {
  if (process.platform !== 'darwin') return null
  const base = app.isPackaged
    ? join(dirname(app.getAppPath()), 'app.asar.unpacked')
    : app.getAppPath()
  const addonPath = join(base, ADDON_RELATIVE_PATH)
  try {
    const mod = { exports: {} }
    process.dlopen(mod, addonPath)
    return mod.exports
  } catch (e) {
    log.warn(`[Trackpad] аддон не загружен (${addonPath}): ${e.message}. Соберите его: npm run build:native`)
    return null
  }
}

/**
 * Жесты по сырым касаниям тачпада macOS: аддон отдаёт кадры касаний, распознаватели находят
 * «двойной тап N пальцами» и свайпы двумя пальцами и сообщают окну жест вместе с позицией курсора
 * в координатах содержимого. Число пальцев шлётся отдельно (renderer гасит колесо во время свайпа).
 * Независимо от настройки «Касание для имитации нажатия», в отличие от DOM-событий мыши.
 */
export class TrackpadGestureService {
  /** @param {{ getWindow: () => Electron.BrowserWindow | null }} deps */
  constructor({ getWindow }) {
    this._getWindow = getWindow
    this._addon = null
    this._enabled = false
    this._running = false
    this._fingers = 0
    const onGesture = (gesture) => this._emit(gesture)
    this._recognizers = [
      new TapGestureRecognizer({ profile: TRACKPAD_TAP_PROFILE, onGesture }),
      new SwipeGestureRecognizer({ profile: TRACKPAD_SWIPE_PROFILE, onGesture })
    ]
    this._onResume = () => {
      // После сна устройства MultitouchSupport перестают присылать кадры — запускаем заново
      if (this._enabled) {
        this._stop()
        this._start()
      }
    }
    powerMonitor.on('resume', this._onResume)
  }

  setEnabled(enabled) {
    this._enabled = !!enabled
    if (this._enabled) this._start()
    else this._stop()
  }

  dispose() {
    powerMonitor.removeListener('resume', this._onResume)
    this._enabled = false
    this._stop()
  }

  _start() {
    if (this._running) return
    this._addon ??= loadAddon()
    if (!this._addon) return
    this._recognizers.forEach(r => r.reset())
    this._running = this._addon.start((timeSec, contacts) => {
      const frame = contacts.map(([id, x, y]) => ({ id, x, y }))
      this._recognizers.forEach(r => r.update(timeSec * 1000, frame))
      this._reportFingers(frame.length)
    })
    if (!this._running) log.warn('[Trackpad] не найдено устройств мультитач')
  }

  _stop() {
    if (!this._running) return
    this._addon.stop()
    this._running = false
    this._reportFingers(0)
  }

  _reportFingers(count) {
    if (count === this._fingers) return
    this._fingers = count
    const win = this._getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC_CHANNELS.TRACKPAD_TOUCH, { fingers: count })
  }

  _emit(gesture) {
    const win = this._getWindow()
    if (!win || win.isDestroyed() || !win.isFocused()) return
    const cursor = screen.getCursorScreenPoint()
    const content = win.getContentBounds()
    const x = cursor.x - content.x
    const y = cursor.y - content.y
    if (x < 0 || y < 0 || x > content.width || y > content.height) return
    win.webContents.send(IPC_CHANNELS.TRACKPAD_GESTURE, { gesture, x, y })
  }
}
