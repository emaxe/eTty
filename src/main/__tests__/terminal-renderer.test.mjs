import test from 'node:test'
import assert from 'node:assert/strict'

// Polyfill self for Node.js test environment before loading @xterm addons
if (typeof self === 'undefined') {
  globalThis.self = globalThis
}

const { TerminalRendererService } = await import('../../renderer/features/terminal/terminal-renderer.js')
const { TERMINAL_CONFIG } = await import('../../renderer/core/config/terminal-config.js')

class MockEventBus {
  constructor() {
    this.events = []
  }
  emit(name, payload) {
    this.events.push({ name, payload })
  }
}

class MockAddon {
  constructor(name) {
    this.name = name
    this.disposed = false
    this.atlasCleared = 0
    this._listeners = new Map()
  }

  activate(terminal) {
    this.terminal = terminal
  }

  dispose() {
    this.disposed = true
  }

  clearTextureAtlas() {
    this.atlasCleared++
  }

  onContextLoss(cb) {
    this._contextLossCb = cb
    return {
      dispose: () => { this._contextLossCb = null }
    }
  }

  onAddTextureAtlasCanvas(cb) {
    this._addAtlasCb = cb
    return {
      dispose: () => { this._addAtlasCb = null }
    }
  }

  triggerContextLoss() {
    if (this._contextLossCb) this._contextLossCb()
  }

  triggerAddAtlas() {
    if (this._addAtlasCb) this._addAtlasCb()
  }
}

function createMockTab(id = 'tab-1') {
  return {
    tabId: id,
    term: {
      rows: 24,
      cols: 80,
      loadedAddons: [],
      refreshed: [],
      loadAddon(addon) {
        this.loadedAddons.push(addon)
        addon.activate(this)
      },
      refresh(start, end) {
        this.refreshed.push({ start, end })
      }
    },
    fitAddon: {
      fit() {}
    }
  }
}

test('TerminalRendererService: defaults to canvas renderer and attaches CanvasAddon', () => {
  let createdCanvas = 0
  const service = new TerminalRendererService({
    createCanvasAddon: () => {
      createdCanvas++
      return new MockAddon('canvas')
    }
  })

  const tab = createMockTab()
  service.attach(tab)

  assert.equal(tab._rendererType, TERMINAL_CONFIG.RENDERERS.CANVAS)
  assert.equal(createdCanvas, 1)
  assert.equal(tab.term.loadedAddons[0].name, 'canvas')
  assert.equal(typeof tab.recoverRenderer, 'function')
})

test('TerminalRendererService: attaches WebglAddon when renderer is webgl', () => {
  let createdWebgl = 0
  const service = new TerminalRendererService({
    createWebglAddon: () => {
      createdWebgl++
      return new MockAddon('webgl')
    }
  })

  const tab = createMockTab()
  service.attach(tab, 'webgl')

  assert.equal(tab._rendererType, TERMINAL_CONFIG.RENDERERS.WEBGL)
  assert.equal(createdWebgl, 1)
  assert.equal(tab.term.loadedAddons[0].name, 'webgl')
})

test('TerminalRendererService: WebGL init failure falls back to Canvas', () => {
  const bus = new MockEventBus()
  const service = new TerminalRendererService({
    eventBus: bus,
    createWebglAddon: () => {
      throw new Error('WebGL disabled by GPU blacklist')
    },
    createCanvasAddon: () => new MockAddon('canvas')
  })

  const tab = createMockTab()
  service.attach(tab, 'webgl')

  assert.equal(tab._rendererType, TERMINAL_CONFIG.RENDERERS.CANVAS)
  assert.equal(tab.term.loadedAddons[0].name, 'canvas')
  const fallbackEv = bus.events.find(e => e.name === 'terminal.renderer.fallback')
  assert.ok(fallbackEv)
  assert.equal(fallbackEv.payload.reason, 'init-failed')
})

test('TerminalRendererService: WebGL context loss triggers auto-fallback to Canvas', () => {
  const bus = new MockEventBus()
  let webglAddon = null
  const service = new TerminalRendererService({
    eventBus: bus,
    createWebglAddon: () => {
      webglAddon = new MockAddon('webgl')
      return webglAddon
    },
    createCanvasAddon: () => new MockAddon('canvas')
  })

  const tab = createMockTab()
  service.attach(tab, 'webgl')

  assert.equal(tab._rendererType, TERMINAL_CONFIG.RENDERERS.WEBGL)
  assert.equal(webglAddon.disposed, false)

  // Симулируем потерю WebGL контекста (например, сон/пробуждение или GPU reset)
  webglAddon.triggerContextLoss()

  assert.equal(tab._rendererType, TERMINAL_CONFIG.RENDERERS.CANVAS)
  assert.equal(webglAddon.disposed, true)
  assert.equal(tab.term.loadedAddons.length, 2)
  assert.equal(tab.term.loadedAddons[1].name, 'canvas')

  const fallbackEv = bus.events.find(e => e.name === 'terminal.renderer.fallback')
  assert.ok(fallbackEv)
  assert.equal(fallbackEv.payload.reason, 'context-loss')
})

test('TerminalRendererService: recover() clears texture atlas and refreshes viewport', () => {
  const bus = new MockEventBus()
  let webglAddon = null
  const service = new TerminalRendererService({
    eventBus: bus,
    createWebglAddon: () => {
      webglAddon = new MockAddon('webgl')
      return webglAddon
    }
  })

  const tab = createMockTab()
  service.attach(tab, 'webgl')

  const recovered = service.recover(tab)
  assert.equal(recovered, true)
  assert.equal(webglAddon.atlasCleared, 1)
  assert.ok(tab.term.refreshed.length > 0)

  const recoveredEv = bus.events.find(e => e.name === 'terminal.renderer.recovered')
  assert.ok(recoveredEv)
  assert.equal(recoveredEv.payload.type, 'webgl-atlas-clear')
})

test('TerminalRendererService: setRendererTypeForAll updates all open tabs dynamically', () => {
  const service = new TerminalRendererService({
    createCanvasAddon: () => new MockAddon('canvas'),
    createWebglAddon: () => new MockAddon('webgl')
  })

  const tab1 = createMockTab('t1')
  const tab2 = createMockTab('t2')
  service.attach(tab1, 'canvas')
  service.attach(tab2, 'canvas')

  assert.equal(tab1._rendererType, 'canvas')
  assert.equal(tab2._rendererType, 'canvas')

  // Пользователь переключил настройку на WebGL
  service.setRendererTypeForAll('webgl')
  assert.equal(tab1._rendererType, 'webgl')
  assert.equal(tab2._rendererType, 'webgl')

  // Пользователь переключил настройку на DOM
  service.setRendererTypeForAll('dom')
  assert.equal(tab1._rendererType, 'dom')
  assert.equal(tab2._rendererType, 'dom')
  assert.equal(tab1._rendererAddon, null)
})

test('TerminalRendererService: detach and destroy cleanly dispose addons and clear tabs', () => {
  let addon1 = null
  let addon2 = null
  const service = new TerminalRendererService({
    createCanvasAddon: () => {
      const a = new MockAddon('canvas')
      if (!addon1) addon1 = a
      else addon2 = a
      return a
    }
  })

  const tab1 = createMockTab('t1')
  const tab2 = createMockTab('t2')
  service.attach(tab1, 'canvas')
  service.attach(tab2, 'canvas')

  service.detach(tab1)
  assert.equal(addon1.disposed, true)
  assert.equal(tab1._rendererAddon, null)

  service.destroy()
  assert.equal(addon2.disposed, true)
  assert.equal(tab2._rendererAddon, null)
})
