import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  contrastRatio, ensureContrast, mix, inkOn, parseHex, toHex
} from '../../renderer/core/color-utils.js'
import {
  deriveUiTokens, TEXT_CONTRAST, UI_CONTRAST, UI_ROLE_OVERRIDES
} from '../../renderer/core/theme-tokens.js'
import { THEMES } from '../../renderer/themes.js'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Темы из main/theme-loader.js: файл импортирует electron, поэтому в node:test его не загрузить.
 * Блоки `ui: { ... }` вынимаются из исходника — тестируются реальные значения, а не копия.
 */
function loadLoaderThemeUis() {
  const src = readFileSync(join(here, '../theme-loader.js'), 'utf8')
  const result = {}
  const re = /id: '([a-z0-9-]+)',\s*name: '[^']*',\s*ui: \{([^}]*)\}/g
  let m
  while ((m = re.exec(src))) {
    const ui = {}
    for (const [, key, value] of m[2].matchAll(/(\w+): '([^']*)'/g)) ui[key] = value
    result[m[1]] = ui
  }
  return result
}

const allUis = {
  ...Object.fromEntries(Object.entries(THEMES).map(([id, t]) => [id, t.ui])),
  ...loadLoaderThemeUis()
}

test('color-utils: parseHex/toHex round-trip', () => {
  assert.deepEqual(parseHex('#fff'), [255, 255, 255])
  assert.equal(toHex([30, 30, 46]), '#1e1e2e')
  assert.equal(parseHex('rgba(0,0,0,.5)'), null)
})

test('color-utils: contrastRatio', () => {
  assert.equal(Math.round(contrastRatio('#000', '#fff')), 21)
  assert.equal(contrastRatio('#777', '#777'), 1)
})

test('color-utils: mix и неразобранный цвет', () => {
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080')
  assert.equal(mix('nope', '#fff', 0.5), 'nope')
})

test('color-utils: ensureContrast не трогает достаточный контраст и чинит недостаточный', () => {
  assert.equal(ensureContrast('#ffffff', '#000000'), '#ffffff')
  const fixed = ensureContrast('#555555', '#1e1e1e', 4.5)
  assert.notEqual(fixed, '#555555')
  assert.ok(contrastRatio(fixed, '#1e1e1e') >= 4.5)
  const onLight = ensureContrast('#bbbbbb', '#ffffff', 4.5)
  assert.ok(contrastRatio(onLight, '#ffffff') >= 4.5)
})

test('color-utils: ensureContrast учитывает все фоны сразу', () => {
  const bgs = ['#1e1e1e', '#3a3a3a']
  const fixed = ensureContrast('#777777', bgs, 4.5)
  for (const bg of bgs) assert.ok(contrastRatio(fixed, bg) >= 4.5, bg)
})

test('color-utils: inkOn выбирает читаемую надпись', () => {
  assert.equal(inkOn('#ffffff'), '#000000')
  assert.equal(inkOn('#101010'), '#ffffff')
})

test('themes: набор для проверки включает все темы', () => {
  // dark/light из renderer + 12 из theme-loader (INITIAL_THEMES) + 2 встроенных в loader (дубли dark/light)
  assert.ok(Object.keys(allUis).length >= 14, `найдено тем: ${Object.keys(allUis).length}`)
  for (const [id, ui] of Object.entries(allUis)) {
    for (const key of ['bg', 'surface', 'border', 'muted', 'text', 'subtext', 'accent', 'green', 'red', 'hover']) {
      assert.ok(parseHex(ui[key]), `${id}.ui.${key} не hex: ${ui[key]}`)
    }
  }
})

for (const [id, ui] of Object.entries(allUis)) {
  test(`deriveUiTokens(${id}): текст читается (≥ ${TEXT_CONTRAST}:1) на ground и surface`, () => {
    const t = deriveUiTokens(ui)
    for (const bg of [t['--ground'], t['--surface']]) {
      for (const role of ['--text', '--text-secondary', '--text-tertiary', '--positive', '--negative', '--warning']) {
        const ratio = contrastRatio(t[role], bg)
        assert.ok(ratio >= TEXT_CONTRAST - 0.01, `${id}: ${role} ${t[role]} на ${bg} = ${ratio.toFixed(2)}`)
      }
    }
  })

  test(`deriveUiTokens(${id}): плашки статусов и фокус`, () => {
    const t = deriveUiTokens(ui)
    for (const kind of ['positive', 'negative', 'warning', 'neutral']) {
      const ratio = contrastRatio(t[`--pill-${kind}-ink`], t[`--pill-${kind}-bg`])
      assert.ok(ratio >= TEXT_CONTRAST - 0.01, `${id}: pill-${kind} = ${ratio.toFixed(2)}`)
    }
    assert.ok(contrastRatio(t['--focus'], t['--ground']) >= UI_CONTRAST - 0.01, `${id}: focus`)
    assert.ok(contrastRatio(t['--accent-ink'], t['--accent']) >= TEXT_CONTRAST - 0.01, `${id}: accent-ink`)
  })
}

test('deriveUiTokens: детерминирована', () => {
  const ui = THEMES.dark.ui
  assert.deepEqual(deriveUiTokens(ui), deriveUiTokens({ ...ui }))
})

test('deriveUiTokens: старые имена — алиасы новых ролей', () => {
  const t = deriveUiTokens(THEMES.dark.ui)
  assert.equal(t['--bg'], t['--ground'])
  assert.equal(t['--subtext'], t['--text-secondary'])
  assert.equal(t['--muted'], t['--text-tertiary'])
  assert.equal(t['--green'], t['--positive'])
  assert.equal(t['--red'], t['--negative'])
  assert.equal(t['--hover'], t['--active'])
})

test('deriveUiTokens: тема может переопределить роль', () => {
  const ui = { ...THEMES.dark.ui, raised: '#123456', scrim: 'rgba(1,2,3,.5)', accentInk: '#abcdef' }
  const t = deriveUiTokens(ui)
  assert.equal(t['--raised'], '#123456')
  assert.equal(t['--scrim'], 'rgba(1,2,3,.5)')
  assert.equal(t['--accent-ink'], '#abcdef')
})

test('deriveUiTokens: все override-переменные существуют в выводе', () => {
  const t = deriveUiTokens(THEMES.dark.ui)
  for (const cssVar of Object.values(UI_ROLE_OVERRIDES)) {
    assert.ok(cssVar in t, `${cssVar} не выводится`)
  }
})

// --- Режим темы -------------------------------------------------------------

import { resolveThemeName } from '../../renderer/core/theme-mode.js'
import { ETTY_THEMES } from '../../shared/etty-themes.js'

test('etty-themes: id совпадает с ключом, тёмная тёмная, светлая светлая', async () => {
  const { isLightColor } = await import('../../renderer/core/color-utils.js')
  for (const [key, theme] of Object.entries(ETTY_THEMES)) assert.equal(theme.id, key)
  assert.equal(isLightColor(ETTY_THEMES['etty-dark'].ui.bg), false)
  assert.equal(isLightColor(ETTY_THEMES['etty-light'].ui.bg), true)
})

test('etty-themes: есть в наборе для проверки контраста', () => {
  assert.ok(allUis['etty-dark'] && allUis['etty-light'])
})

test('resolveThemeName: manual использует appearance.theme', () => {
  const themes = { dark: {}, nord: {}, 'etty-dark': {}, 'etty-light': {} }
  const a = { theme: 'nord', themeMode: 'manual', themeDark: 'etty-dark', themeLight: 'etty-light' }
  assert.equal(resolveThemeName(a, true, themes), 'nord')
  assert.equal(resolveThemeName(a, false, themes), 'nord')
})

test('resolveThemeName: auto выбирает по системной схеме', () => {
  const themes = { dark: {}, nord: {}, 'etty-dark': {}, 'etty-light': {} }
  const a = { theme: 'nord', themeMode: 'auto', themeDark: 'etty-dark', themeLight: 'etty-light' }
  assert.equal(resolveThemeName(a, true, themes), 'etty-dark')
  assert.equal(resolveThemeName(a, false, themes), 'etty-light')
})

test('resolveThemeName: отсутствующая тема → appearance.theme → dark', () => {
  const a = { theme: 'nord', themeMode: 'auto', themeDark: 'gone', themeLight: 'gone' }
  assert.equal(resolveThemeName(a, true, { dark: {}, nord: {} }), 'nord')
  assert.equal(resolveThemeName(a, true, { dark: {} }), 'dark')
  assert.equal(resolveThemeName(undefined, false, { dark: {} }), 'dark')
})
