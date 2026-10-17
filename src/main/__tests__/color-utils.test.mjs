import test from 'node:test'
import assert from 'node:assert/strict'
import { isLightColor } from '../../renderer/core/color-utils.js'
import { THEMES } from '../../renderer/themes.js'

test('isLightColor: базовые цвета', () => {
  assert.equal(isLightColor('#fff'), true)
  assert.equal(isLightColor('#FFFFFF'), true)
  assert.equal(isLightColor('#1e1e1e'), false)
  assert.equal(isLightColor('#000'), false)
})

test('isLightColor: нераспознанное значение — тёмный', () => {
  assert.equal(isLightColor('rgb(255,255,255)'), false)
  assert.equal(isLightColor(undefined), false)
})

test('isLightColor: встроенные темы', () => {
  assert.equal(isLightColor(THEMES.dark.ui.bg), false)
  assert.equal(isLightColor(THEMES.light.ui.bg), true)
})
