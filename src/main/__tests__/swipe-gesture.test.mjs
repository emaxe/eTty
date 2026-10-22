import { SwipeGestureRecognizer, TRACKPAD_SWIPE_PROFILE, SWIPE_GESTURES } from '../../shared/swipe-gesture-recognizer.js'
import { normalizeSwipeSettings, swipeAction, shouldSuppressWheel } from '../../renderer/features/terminal/terminal-swipe.js'

let failed = false

function check(label, fn) {
  try {
    fn()
    console.log(`✅ ${label}`)
  } catch (e) {
    console.error(`❌ ${label}: ${e.message}`)
    failed = true
  }
}

function assertEq(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`ожидалось ${JSON.stringify(expected)}, получено ${JSON.stringify(actual)}`)
  }
}

function make() {
  const got = []
  const r = new SwipeGestureRecognizer({ profile: TRACKPAD_SWIPE_PROFILE, onGesture: (g) => got.push(g) })
  return { r, got }
}

const two = (dx = 0, dy = 0) => [
  { id: 1, x: 0.4 + dx, y: 0.5 + dy },
  { id: 2, x: 0.5 + dx, y: 0.5 + dy }
]

/** Двигает два пальца шагами до (dx, dy) и отпускает. */
function swipe(r, dx, dy, t0 = 0) {
  r.update(t0, two())
  for (let i = 1; i <= 10; i++) r.update(t0 + i * 10, two((dx * i) / 10, (dy * i) / 10))
  r.update(t0 + 200, [])
}

check('движение пальцев влево/вправо', () => {
  let { r, got } = make()
  swipe(r, -0.3, 0)
  assertEq(got, [SWIPE_GESTURES.LEFT])
  ;({ r, got } = make())
  swipe(r, 0.3, 0)
  assertEq(got, [SWIPE_GESTURES.RIGHT])
})

check('ось Y тачпада направлена вверх: dy>0 — свайп вверх', () => {
  let { r, got } = make()
  swipe(r, 0, 0.3)
  assertEq(got, [SWIPE_GESTURES.UP])
  ;({ r, got } = make())
  swipe(r, 0, -0.3)
  assertEq(got, [SWIPE_GESTURES.DOWN])
})

check('один свайп на жест, следующий — после отпускания', () => {
  const { r, got } = make()
  swipe(r, -0.5, 0)
  swipe(r, 0.5, 0, 1000)
  assertEq(got, [SWIPE_GESTURES.LEFT, SWIPE_GESTURES.RIGHT])
})

check('короткое движение ниже порога — не свайп', () => {
  const { r, got } = make()
  swipe(r, 0.05, 0.03)
  assertEq(got, [])
})

check('одним пальцем — не свайп', () => {
  const { r, got } = make()
  r.update(0, [{ id: 1, x: 0.2, y: 0.5 }])
  r.update(50, [{ id: 1, x: 0.8, y: 0.5 }])
  assertEq(got, [])
})

check('три пальца — не свайп', () => {
  const { r, got } = make()
  r.update(0, [...two(), { id: 3, x: 0.6, y: 0.5 }])
  r.update(50, [...two(-0.4), { id: 3, x: 0.2, y: 0.5 }])
  assertEq(got, [])
})

check('третий палец посреди жеста отменяет его', () => {
  const { r, got } = make()
  r.update(0, two())
  r.update(20, [...two(0.05), { id: 3, x: 0.6, y: 0.5 }])
  r.update(60, two(0.4))
  assertEq(got, [])
})

check('поздно опущенный второй палец — не свайп', () => {
  const { r, got } = make()
  r.update(0, [two()[0]])
  r.update(300, two())
  r.update(340, two(-0.4))
  assertEq(got, [])
})

check('настройки: неизвестное значение → выключено', () => {
  assertEq(normalizeSwipeSettings({ swipeVertical: 'tabs', swipeHorizontal: 'tabs' }), { vertical: 'off', horizontal: 'tabs' })
  assertEq(normalizeSwipeSettings(null), { vertical: 'off', horizontal: 'off' })
})

check('действия: стрелки (обычный и application режим)', () => {
  const s = { vertical: 'arrows', horizontal: 'arrows' }
  assertEq(swipeAction(SWIPE_GESTURES.UP, s), { kind: 'arrow', seq: '\x1b[A' })
  assertEq(swipeAction(SWIPE_GESTURES.LEFT, s, { appCursor: true }), { kind: 'arrow', seq: '\x1bOD' })
  assertEq(swipeAction(SWIPE_GESTURES.RIGHT, s), { kind: 'arrow', seq: '\x1b[C' })
  assertEq(swipeAction(SWIPE_GESTURES.DOWN, s), { kind: 'arrow', seq: '\x1b[B' })
})

check('действия: вкладки только по горизонтали, выключено → null', () => {
  const s = { vertical: 'off', horizontal: 'tabs' }
  assertEq(swipeAction(SWIPE_GESTURES.LEFT, s), { kind: 'tab', delta: 1 })
  assertEq(swipeAction(SWIPE_GESTURES.RIGHT, s), { kind: 'tab', delta: -1 })
  assertEq(swipeAction(SWIPE_GESTURES.UP, s), null)
})

check('колесо гасится только по включённой оси и во время жеста', () => {
  const s = { vertical: 'arrows', horizontal: 'off' }
  const busy = { twoFingers: true, momentumUntil: 0, now: 100 }
  assertEq(shouldSuppressWheel({ deltaX: 0, deltaY: 10 }, s, busy), true)
  assertEq(shouldSuppressWheel({ deltaX: 10, deltaY: 1 }, s, busy), false)
  assertEq(shouldSuppressWheel({ deltaX: 0, deltaY: 10 }, s, { twoFingers: false, momentumUntil: 500, now: 100 }), true)
  assertEq(shouldSuppressWheel({ deltaX: 0, deltaY: 10 }, s, { twoFingers: false, momentumUntil: 50, now: 100 }), false)
  assertEq(shouldSuppressWheel({ deltaX: 0, deltaY: 10, ctrlKey: true }, s, busy), false)
})

if (failed) process.exit(1)
