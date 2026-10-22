import { TapGestureRecognizer, TRACKPAD_TAP_PROFILE, TAP_GESTURES } from '../../shared/tap-gesture-recognizer.js'

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
  const r = new TapGestureRecognizer({ profile: TRACKPAD_TAP_PROFILE, onGesture: (g) => got.push(g) })
  return { r, got }
}

const fingers = (n, dx = 0, dy = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, x: 0.4 + i * 0.1 + dx, y: 0.5 + dy }))

/** Тап n пальцами: касание в t0, отпускание через dur мс. */
function tap(r, t0, n, { dur = 90, move = 0, id0 = 0 } = {}) {
  const base = fingers(n).map(f => ({ ...f, id: f.id + id0 }))
  r.update(t0, base)
  if (move) r.update(t0 + dur / 2, base.map(f => ({ ...f, x: f.x + move })))
  r.update(t0 + dur, [])
}

check('двойной тап двумя пальцами', () => {
  const { r, got } = make()
  tap(r, 0, 2)
  tap(r, 200, 2)
  assertEq(got, [TAP_GESTURES.TWO_FINGER_DOUBLE_TAP])
})

check('двойной тап тремя пальцами', () => {
  const { r, got } = make()
  tap(r, 0, 3)
  tap(r, 200, 3)
  assertEq(got, [TAP_GESTURES.THREE_FINGER_DOUBLE_TAP])
})

check('одиночный тап жеста не даёт', () => {
  const { r, got } = make()
  tap(r, 0, 2)
  assertEq(got, [])
})

check('тройное касание не склеивается в два жеста подряд', () => {
  const { r, got } = make()
  tap(r, 0, 2)
  tap(r, 200, 2)
  tap(r, 400, 2)
  assertEq(got.length, 1)
})

check('тапы разным числом пальцев — не двойной тап', () => {
  const { r, got } = make()
  tap(r, 0, 2)
  tap(r, 200, 3)
  assertEq(got, [])
})

check('пауза больше окна — не двойной тап', () => {
  const { r, got } = make()
  tap(r, 0, 2)
  tap(r, 90 + 600, 2)
  assertEq(got, [])
})

check('долгое касание (скролл/удержание) — не тап и сбрасывает цепочку', () => {
  const { r, got } = make()
  tap(r, 0, 2)
  tap(r, 200, 2, { dur: 600 })
  tap(r, 900, 2)
  assertEq(got, [])
})

check('скролл двумя пальцами со сдвигом — не тап', () => {
  const { r, got } = make()
  tap(r, 0, 2)
  tap(r, 200, 2, { move: 0.2 })
  assertEq(got, [])
})

check('поздно опущенный второй палец — не тап двумя пальцами', () => {
  const { r, got } = make()
  tap(r, 0, 2)
  r.update(200, [fingers(2)[0]])
  r.update(200 + 200, fingers(2))
  r.update(200 + 250, [])
  assertEq(got, [])
})

check('четыре пальца — не жест', () => {
  const { r, got } = make()
  tap(r, 0, 2)
  tap(r, 200, 4)
  assertEq(got, [])
})

check('одиночный палец между тапами сбрасывает цепочку', () => {
  const { r, got } = make()
  tap(r, 0, 2)
  tap(r, 120, 1)
  tap(r, 240, 2)
  assertEq(got, [])
})

check('reset() сбрасывает состояние', () => {
  const { r, got } = make()
  tap(r, 0, 2)
  r.reset()
  tap(r, 200, 2)
  assertEq(got, [])
})

if (failed) process.exit(1)
