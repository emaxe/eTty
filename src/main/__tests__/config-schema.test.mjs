import test from 'node:test'
import assert from 'node:assert/strict'
import { getConfigDefaults, mergeConfigWithDefaults } from '../config-schema.js'

test('config-schema: defaults allow manual agent enable without changing auto-detection', () => {
  const defaults = getConfigDefaults()
  assert.deepEqual(defaults.agents.forceEnabled, {})
  assert.equal(defaults.agents.forceDisabled.codex, false)
})

test('config-schema: legacy config without forceEnabled loads as empty manual map', () => {
  const legacy = {
    version: 1,
    agents: {
      forceDisabled: { codex: true },
      launchCommands: { codex: 'codex --profile work' },
      custom: []
    }
  }
  const warnings = []
  const config = mergeConfigWithDefaults(legacy, warnings)
  assert.deepEqual(config.agents.forceEnabled, {})
  assert.equal(config.agents.forceDisabled.codex, true, 'legacy disable must survive')
  assert.equal(config.agents.launchCommands.codex, 'codex --profile work')
  assert.equal(warnings.some(w => w.includes('Unknown field ignored: agents.forceEnabled')), false)
})

test('config-schema: manual enable round-trips for built-in and custom agents', () => {
  const saved = {
    version: 1,
    agents: {
      forceEnabled: { codex: true, 'custom-1': true },
      forceDisabled: { codex: false }
    }
  }
  const warnings = []
  const config = mergeConfigWithDefaults(saved, warnings)
  assert.deepEqual(config.agents.forceEnabled, { codex: true, 'custom-1': true })
  assert.equal(warnings.some(w => w.includes('Unknown field ignored: agents.forceEnabled.codex')), false)

  const reloaded = mergeConfigWithDefaults(JSON.parse(JSON.stringify(config)), [])
  assert.deepEqual(reloaded.agents.forceEnabled, config.agents.forceEnabled)
})

test('config-schema: invalid forceEnabled container falls back to empty map', () => {
  const warnings = []
  const config = mergeConfigWithDefaults({ version: 1, agents: { forceEnabled: ['codex'] } }, warnings)
  assert.deepEqual(config.agents.forceEnabled, {})
  assert.ok(warnings.some(w => w.includes('agents.forceEnabled')))
})
