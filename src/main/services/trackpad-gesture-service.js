import { dirname, join } from 'path'
import { IPC_CHANNELS } from '../../shared/ipc-channels.js'
import { TapGestureRecognizer, TRACKPAD_TAP_PROFILE } from '../../shared/tap-gesture-recognizer.js'
import { SwipeGestureRecognizer, TRACKPAD_SWIPE_PROFILE } from '../../shared/swipe-gesture-recognizer.js'
import { TRACKPAD_SERVICE_CONFIG } from '../../shared/trackpad-service-config.js'

const ADDON_RELATIVE_PATH = join('native', 'trackpad', 'dist', 'trackpad.node')

/** Загружает нативный аддон тачпада (только macOS); без него жесты тачпада недоступны. */
function loadAddon({ app, log }) {
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
 *
 * Поток кадров может тихо замолкнуть (устройство пересоздано после сна/крышки/переподключения):
 * `start()` при этом уже вернул true и ошибок нет. Хуже — сразу после пробуждения
 * `MTDeviceCreateList` бывает пуст, и `start()` возвращает false. Поэтому:
 *  - после сна/разблокировки поток перезапускается с паузой и ещё дважды страховочно;
 *  - пока устройств нет, повторы идут с растущей паузой (до RETRY_MAX_ATTEMPTS);
 *  - поток перезапускается также при смене настройки, фокусе окна, смене дисплеев и
 *    «залипших» касаниях.
 */
export class TrackpadGestureService {
  /**
   * @param {object} deps
   * @param {() => Electron.BrowserWindow | null} deps.getWindow
   * @param {Pick<Electron.App, 'isPackaged' | 'getAppPath' | 'on' | 'removeListener'>} deps.app
   * @param {Electron.PowerMonitor} deps.powerMonitor
   * @param {Electron.Screen} deps.screen
   * @param {{ info: Function, warn: Function }} deps.log
   * @param {() => object | null} [deps.addonLoader] — по умолчанию грузит native/trackpad
   */
  constructor({ getWindow, app, powerMonitor, screen, log, addonLoader }) {
    this._getWindow = getWindow
    this._app = app
    this._powerMonitor = powerMonitor
    this._screen = screen
    this._log = log
    this._addonLoader = addonLoader ?? (() => loadAddon({ app, log }))
    this._addon = null
    this._enabled = false
    this._running = false
    this._fingers = 0
    this._lastFocusRestart = 0
    this._stuckTimer = null
    this._retryTimer = null
    this._retryAttempts = 0
    this._delayedTimers = new Set()
    const onGesture = (gesture) => this._emit(gesture)
    this._recognizers = [
      new TapGestureRecognizer({ profile: TRACKPAD_TAP_PROFILE, onGesture }),
      new SwipeGestureRecognizer({ profile: TRACKPAD_SWIPE_PROFILE, onGesture })
    ]

    this._onWake = () => this._recover('wake')
    this._onUnlock = () => this._recover('unlock')
    this._onFocus = () => {
      const now = Date.now()
      if (now - this._lastFocusRestart < TRACKPAD_SERVICE_CONFIG.FOCUS_RESTART_MIN_MS) return
      this._lastFocusRestart = now
      this._restart('focus')
    }
    this._onDisplays = () => this._restart('displays')

    powerMonitor.on('resume', this._onWake)
    powerMonitor.on('unlock-screen', this._onUnlock)
    app.on('browser-window-focus', this._onFocus)
    screen.on('display-added', this._onDisplays)
    screen.on('display-removed', this._onDisplays)
  }

  setEnabled(enabled) {
    this._enabled = !!enabled
    if (!this._enabled) {
      this._stop()
      this._cancelScheduled()
      this._retryAttempts = 0
      return
    }
    // Повторное включение при уже идущем потоке — ручной способ вылечить замолкший поток
    this._retryAttempts = 0
    if (this._running) this._restart('settings')
    else if (!this._start()) this._scheduleRetry('settings')
  }

  dispose() {
    this._powerMonitor.removeListener('resume', this._onWake)
    this._powerMonitor.removeListener('unlock-screen', this._onUnlock)
    this._app.removeListener('browser-window-focus', this._onFocus)
    this._screen.removeListener('display-added', this._onDisplays)
    this._screen.removeListener('display-removed', this._onDisplays)
    this._enabled = false
    this._stop()
    this._cancelScheduled()
    this._retryAttempts = 0
  }

  _start() {
    if (this._running) return true
    this._addon ??= this._addonLoader()
    if (!this._addon) {
      // Аддон не собрать повтором: без него жестов не будет вообще
      this._log.warn('[Trackpad] нативный аддон недоступен — жесты тачпада выключены')
      return false
    }
    this._recognizers.forEach(r => r.reset())
    this._running = !!this._addon.start((timeSec, contacts) => {
      const frame = contacts.map(([id, x, y]) => ({ id, x, y }))
      this._recognizers.forEach(r => r.update(timeSec * 1000, frame))
      this._reportFingers(frame.length)
      this._watchStuck(frame.length > 0)
    })
    if (this._running) {
      this._retryAttempts = 0
      this._log.info('[Trackpad] поток касаний запущен')
    } else {
      this._retryAttempts++
      this._log.warn(`[Trackpad] не найдено устройств мультитач (попытка ${this._retryAttempts})`)
    }
    return this._running
  }

  _stop() {
    this._clearStuckTimer()
    this._cancelRetry()
    if (!this._running) return
    this._addon.stop()
    this._running = false
    this._reportFingers(0)
  }

  /**
   * Перезапуск потока. После пробуждения/разблокировки — с паузой и страховочными повторами:
   * драйвер мультитача встаёт не мгновенно, а «удачный» старт может не давать кадров.
   */
  _recover(reason) {
    if (!this._enabled) return
    this._cancelScheduled()
    this._retryAttempts = 0
    this._delay(TRACKPAD_SERVICE_CONFIG.RESUME_RESTART_DELAY_MS, () => this._restart(reason))
    for (const ms of TRACKPAD_SERVICE_CONFIG.REARM_DELAYS_MS) {
      this._delay(ms, () => this._restart(`${reason}+${ms}ms`))
    }
  }

  _restart(reason) {
    if (!this._enabled) return
    this._cancelRetry()
    this._stop()
    const started = this._start()
    this._log.info(
      `[Trackpad] перезапуск (${reason}), работает=${started}, устройств=${this._deviceCount() ?? 'н/д'}`
    )
    if (!started) this._scheduleRetry(reason)
  }

  /** Устройств ещё нет (или поток не поднялся) — повтор с растущей паузой. */
  _scheduleRetry(reason) {
    if (!this._enabled || this._retryTimer || this._running) return
    if (!this._addon) return
    if (this._retryAttempts > TRACKPAD_SERVICE_CONFIG.RETRY_MAX_ATTEMPTS) {
      this._log.warn(`[Trackpad] поток не поднялся за ${this._retryAttempts - 1} повторов (${reason})`)
      return
    }
    const delays = TRACKPAD_SERVICE_CONFIG.RETRY_DELAYS_MS
    const delay = delays[Math.max(0, Math.min(this._retryAttempts - 1, delays.length - 1))]
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null
      if (!this._enabled || this._running) return
      const started = this._start()
      this._log.info(
        `[Trackpad] повтор (${reason}), работает=${started}, устройств=${this._deviceCount() ?? 'н/д'}`
      )
      if (!started) this._scheduleRetry(reason)
    }, delay)
  }

  _cancelRetry() {
    if (this._retryTimer) clearTimeout(this._retryTimer)
    this._retryTimer = null
  }

  _delay(ms, fn) {
    const timer = setTimeout(() => {
      this._delayedTimers.delete(timer)
      fn()
    }, ms)
    this._delayedTimers.add(timer)
  }

  _cancelScheduled() {
    this._delayedTimers.forEach(clearTimeout)
    this._delayedTimers.clear()
  }

  /** Касания есть, а кадров больше нет — поток замолк (или «0 пальцев» потерян): перезапуск. */
  _watchStuck(touching) {
    this._clearStuckTimer()
    if (!touching) return
    this._stuckTimer = setTimeout(() => {
      this._stuckTimer = null
      this._restart('залипшие касания')
    }, TRACKPAD_SERVICE_CONFIG.STUCK_CONTACT_MS)
  }

  _clearStuckTimer() {
    if (this._stuckTimer) clearTimeout(this._stuckTimer)
    this._stuckTimer = null
  }

  /** Сколько мультитач-устройств видит система (для диагностики в main.log). */
  _deviceCount() {
    try {
      return this._addon?.deviceCount?.() ?? null
    } catch {
      return null
    }
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
    const cursor = this._screen.getCursorScreenPoint()
    const content = win.getContentBounds()
    const x = cursor.x - content.x
    const y = cursor.y - content.y
    if (x < 0 || y < 0 || x > content.width || y > content.height) return
    win.webContents.send(IPC_CHANNELS.TRACKPAD_GESTURE, { gesture, x, y })
  }
}
