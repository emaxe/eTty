import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { TrackpadGestureService } from '../services/trackpad-gesture-service.js'
import { TRACKPAD_SERVICE_CONFIG } from '../../shared/trackpad-service-config.js'

function setup({ startOk = true, withAddon = true } = {}) {
  const calls = { start: 0, stop: 0 }
  const state = { startOk }
  let frameCb = null
  const addon = {
    start: (cb) => { calls.start++; frameCb = cb; return state.startOk },
    stop: () => { calls.stop++ },
    deviceCount: () => (state.startOk ? 1 : 0)
  }
  const app = Object.assign(new EventEmitter(), { isPackaged: false, getAppPath: () => '/' })
  const powerMonitor = new EventEmitter()
  const screen = Object.assign(new EventEmitter(), { getCursorScreenPoint: () => ({ x: 0, y: 0 }) })
  const win = { isDestroyed: () => false, webContents: { send() {} } }
  const log = { info() {}, warn() {} }
  const svc = new TrackpadGestureService({
    getWindow: () => win, app, powerMonitor, screen, log, addonLoader: () => (withAddon ? addon : null)
  })
  return { svc, calls, state, app, powerMonitor, screen, frame: (contacts) => frameCb(1, contacts) }
}

const { RESUME_RESTART_DELAY_MS, REARM_DELAYS_MS, RETRY_DELAYS_MS, RETRY_MAX_ATTEMPTS } = TRACKPAD_SERVICE_CONFIG
const [REARM_1, REARM_2] = REARM_DELAYS_MS

test('setEnabled(true) при идущем потоке перезапускает его', () => {
  const { svc, calls } = setup()
  svc.setEnabled(true)
  assert.deepEqual(calls, { start: 1, stop: 0 })
  svc.setEnabled(true)
  assert.deepEqual(calls, { start: 2, stop: 1 })
  svc.dispose()
})

test('выключенный сервис не перезапускается событиями', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { svc, calls, powerMonitor, app } = setup()
  powerMonitor.emit('resume')
  app.emit('browser-window-focus')
  t.mock.timers.tick(60000)
  assert.equal(calls.start, 0)
  svc.dispose()
})

test('resume: перезапуск после паузы и страховочные повторы', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { svc, calls, powerMonitor } = setup()
  svc.setEnabled(true)
  powerMonitor.emit('resume')
  assert.equal(calls.start, 1, 'сразу после пробуждения не дёргаем драйвер')
  t.mock.timers.tick(RESUME_RESTART_DELAY_MS)
  assert.equal(calls.start, 2)
  t.mock.timers.tick(REARM_1 - RESUME_RESTART_DELAY_MS)
  assert.equal(calls.start, 3)
  t.mock.timers.tick(REARM_2 - REARM_1)
  assert.equal(calls.start, 4)
  svc.dispose()
})

test('unlock-screen тоже перезапускает поток', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { svc, calls, powerMonitor } = setup()
  svc.setEnabled(true)
  powerMonitor.emit('unlock-screen')
  t.mock.timers.tick(RESUME_RESTART_DELAY_MS)
  assert.equal(calls.start, 2)
  svc.dispose()
})

test('нет устройств: повторы с растущей паузой, успех прекращает ретраи', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { svc, calls, state } = setup({ startOk: false })
  svc.setEnabled(true)
  assert.equal(calls.start, 1)

  t.mock.timers.tick(RETRY_DELAYS_MS[0])
  assert.equal(calls.start, 2)
  t.mock.timers.tick(RETRY_DELAYS_MS[1] - 1)
  assert.equal(calls.start, 2, 'пауза растёт')
  t.mock.timers.tick(1)
  assert.equal(calls.start, 3)

  state.startOk = true
  t.mock.timers.tick(RETRY_DELAYS_MS[2])
  assert.equal(calls.start, 4)

  t.mock.timers.tick(60000)
  assert.equal(calls.start, 4, 'после успеха ретраев больше нет')
  svc.dispose()
})

test('ретраи прекращаются после RETRY_MAX_ATTEMPTS', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { svc, calls } = setup({ startOk: false })
  svc.setEnabled(true)
  for (let i = 0; i < RETRY_MAX_ATTEMPTS; i++) {
    t.mock.timers.tick(RETRY_DELAYS_MS[Math.min(i, RETRY_DELAYS_MS.length - 1)])
  }
  assert.equal(calls.start, RETRY_MAX_ATTEMPTS + 1)
  t.mock.timers.tick(600000)
  assert.equal(calls.start, RETRY_MAX_ATTEMPTS + 1)
  svc.dispose()
})

test('выключение и dispose отменяют запланированные ретраи', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { svc, calls } = setup({ startOk: false })
  svc.setEnabled(true)
  svc.setEnabled(false)
  t.mock.timers.tick(600000)
  assert.equal(calls.start, 1)
  svc.dispose()
})

test('без нативного аддона повторов нет — жестов не будет вообще', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { svc, calls } = setup({ withAddon: false })
  svc.setEnabled(true)
  t.mock.timers.tick(600000)
  assert.equal(calls.start, 0)
  svc.dispose()
})

test('фокус окна дебаунсится', () => {
  const { svc, calls, app } = setup()
  svc.setEnabled(true)
  app.emit('browser-window-focus')
  app.emit('browser-window-focus')
  assert.equal(calls.start, 2)
  svc.dispose()
})

test('смена дисплеев перезапускает поток', () => {
  const { svc, calls, screen } = setup()
  svc.setEnabled(true)
  screen.emit('display-added')
  screen.emit('display-removed')
  assert.equal(calls.start, 3)
  svc.dispose()
})

test('касания без новых кадров дольше порога → перезапуск', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { svc, calls, frame } = setup()
  svc.setEnabled(true)
  frame([[1, 0.5, 0.5]])
  t.mock.timers.tick(TRACKPAD_SERVICE_CONFIG.STUCK_CONTACT_MS - 1)
  assert.equal(calls.start, 1)
  t.mock.timers.tick(1)
  assert.equal(calls.start, 2)
  svc.dispose()
})

test('кадр «0 пальцев» снимает сторожа залипших касаний', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { svc, calls, frame } = setup()
  svc.setEnabled(true)
  frame([[1, 0.5, 0.5]])
  frame([])
  t.mock.timers.tick(TRACKPAD_SERVICE_CONFIG.STUCK_CONTACT_MS * 2)
  assert.equal(calls.start, 1)
  svc.dispose()
})

test('dispose снимает слушателей и все таймеры', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { svc, calls, app, powerMonitor, screen } = setup({ startOk: false })
  svc.setEnabled(true)
  powerMonitor.emit('resume')
  svc.dispose()
  assert.equal(powerMonitor.listenerCount('resume'), 0)
  assert.equal(powerMonitor.listenerCount('unlock-screen'), 0)
  assert.equal(app.listenerCount('browser-window-focus'), 0)
  assert.equal(screen.listenerCount('display-added'), 0)
  assert.equal(screen.listenerCount('display-removed'), 0)
  const started = calls.start
  t.mock.timers.tick(600000)
  assert.equal(calls.start, started)
})
