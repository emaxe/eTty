/**
 * Diagnostics — мониторинг производительности renderer-процесса.
 * Логирует DOM nodes, listeners, heap, EventBus state, PTY data throughput.
 * Данные можно просматривать в DevTools Console или сохранять в файл через
 * контекстное меню консоли → «Save as...».
 */

class Diagnostics {
  constructor() {
    this._intervalId = null
    this._lastFrameTime = performance.now()
    this._frameCount = 0
    this._fps = 60
    this._samples = []
    this._maxSamples = 200
    this._ptyDataCounter = new Map() // pid → bytes last interval
    this._isRunning = false

    // FPS counter via rAF
    this._rafId = null
    this._measureFPS = this._measureFPS.bind(this)
  }

  start(intervalMs = 5000) {
    if (this._isRunning) return
    this._isRunning = true
    this._intervalId = setInterval(() => this._sample(), intervalMs)
    this._measureFPS()
    console.info('[Diagnostics] Started — interval:', intervalMs, 'ms')
  }

  stop() {
    this._isRunning = false
    if (this._intervalId) {
      clearInterval(this._intervalId)
      this._intervalId = null
    }
    if (this._rafId) {
      cancelAnimationFrame(this._rafId)
      this._rafId = null
    }
  }

  _measureFPS() {
    const now = performance.now()
    this._frameCount++
    if (now - this._lastFrameTime >= 1000) {
      this._fps = Math.round(this._frameCount * 1000 / (now - this._lastFrameTime))
      this._frameCount = 0
      this._lastFrameTime = now
    }
    this._rafId = requestAnimationFrame(this._measureFPS)
  }

  _sample() {
    const data = {
      t: new Date().toISOString(),
      // DOM
      domNodes: document.querySelectorAll('*').length,
      // Heap (if available)
      heapUsedMB: (performance.memory?.usedJSHeapSize / 1024 / 1024).toFixed(1) || 'N/A',
      heapTotalMB: (performance.memory?.totalJSHeapSize / 1024 / 1024).toFixed(1) || 'N/A',
      // FPS
      fps: this._fps,
      // EventBus (global)
      eventBus: window.__eventBus ? this._eventBusStats(window.__eventBus) : 'N/A',
      // Store subscribers
      storeSubs: window.__appStore ? window.__appStore._listeners?.size ?? 'N/A' : 'N/A',
      // Tab count
      tabs: window.__tabBar?.tabs?.length ?? 'N/A',
      // Active PTY data throughput
      ptyThroughput: this._ptyStats(),
      // xterm.js buffer state
      xterm: this._xtermStats(),
    }

    this._samples.push(data)
    if (this._samples.length > this._maxSamples) {
      this._samples.shift()
    }

    // Log only anomalies or every 3rd sample to avoid spam
    const isAnomaly = data.fps < 30 || parseFloat(data.heapUsedMB) > 300
    if (isAnomaly || this._samples.length % 3 === 0) {
      console.log(
        `[Diagnostics] DOM=${data.domNodes} Heap=${data.heapUsedMB}MB FPS=${data.fps} ` +
        `EventBus=${JSON.stringify(data.eventBus)} Tabs=${data.tabs} PTY=${JSON.stringify(data.ptyThroughput)} xterm=${JSON.stringify(data.xterm)}`
      )
    }

    // Deep anomaly — force dump (also trigger on very large terminal buffers)
    const xtermBuffers = Object.values(data.xterm || {})
    const hasHugeBuffer = xtermBuffers.some(s => parseInt(s) > 5000)
    if (isAnomaly || hasHugeBuffer) {
      this.dump()
    }
  }

  _eventBusStats(bus) {
    const stats = {}
    for (const [ev, set] of bus._listeners) {
      stats[ev] = set.size
    }
    return stats
  }

  /** Call this from the PTY data handler to track throughput. */
  recordPtyData(pid, byteLength) {
    const current = this._ptyDataCounter.get(pid) || 0
    this._ptyDataCounter.set(pid, current + byteLength)
  }

  /** Track xterm.js buffer state per tab. */
  recordXtermState(pid, bufferLength, cursorY, isWebGL) {
    this._xtermStates = this._xtermStates || new Map()
    this._xtermStates.set(pid, { bufferLength, cursorY, isWebGL })
  }

  _ptyStats() {
    const result = {}
    for (const [pid, bytes] of this._ptyDataCounter) {
      result[pid] = `${(bytes / 1024).toFixed(1)}KB`
    }
    this._ptyDataCounter.clear()
    return result
  }

  _xtermStats() {
    if (!this._xtermStates) return {}
    const result = {}
    for (const [pid, state] of this._xtermStates) {
      // C = Canvas renderer (WebGL disabled due to GPU texture leaks with AI agents)
      result[pid] = `${state.bufferLength}L@${state.cursorY}yC`
    }
    return result
  }

  /** Print full snapshot to console. */
  dump() {
    console.group('[Diagnostics] Full Snapshot')
    console.log('Latest sample:', this._samples[this._samples.length - 1])
    console.log('All samples:', this._samples)
    console.log('Memory:', performance.memory)
    console.groupEnd()
  }

  /** Export samples as JSON string for saving to file. */
  exportJSON() {
    return JSON.stringify(this._samples, null, 2)
  }
}

const diagnostics = new Diagnostics()

// Expose globally for console access
window.__diagnostics = diagnostics

export { diagnostics }
