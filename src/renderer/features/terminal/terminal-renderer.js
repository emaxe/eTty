import { CanvasAddon } from '@xterm/addon-canvas'
import { WebglAddon } from '@xterm/addon-webgl'
import { TERMINAL_CONFIG } from '../../core/config/terminal-config.js'

/**
 * TerminalRendererService — управление жизненным циклом и отказоустойчивостью
 * движков рендеринга терминала (Canvas 2D / WebGL / DOM).
 *
 * Обеспечивает:
 * 1. Безопасную инициализацию Canvas 2D (по умолчанию), WebGL или DOM.
 * 2. Защиту WebGL при потере контекста GPU (webglcontextlost → автопереключение на Canvas).
 * 3. Защиту от переполнения и порчи атласа текстур глифов (Texture Atlas Corruption guard).
 * 4. Автовосстановление и ручной сброс рендерера (Cmd+P → "Восстановить рендерер терминала").
 * 5. Динамическое переключение движка на лету без перезапуска приложения и потери PTY.
 */
export class TerminalRendererService {
  /**
   * @param {object} [deps]
   * @param {import('../../core/event-bus.js').EventBus} [deps.eventBus]
   * @param {import('../../core/state-store.js').StateStore} [deps.store]
   * @param {Function} [deps.createCanvasAddon] — фабрика CanvasAddon (для DI/тестирования)
   * @param {Function} [deps.createWebglAddon] — фабрика WebglAddon (для DI/тестирования)
   */
  constructor({
    eventBus = null,
    store = null,
    createCanvasAddon = () => new CanvasAddon(),
    createWebglAddon = () => new WebglAddon()
  } = {}) {
    this._eventBus = eventBus
    this._store = store
    this._createCanvasAddon = createCanvasAddon
    this._createWebglAddon = createWebglAddon
    this._tabs = new Set()
  }

  /**
   * Подключает выбранный движок рендеринга к вкладке.
   * @param {object} tab — объект вкладки с полями term, container, pid, etc.
   * @param {'canvas'|'webgl'|'dom'} [rendererType]
   */
  attach(tab, rendererType = TERMINAL_CONFIG.DEFAULT_RENDERER) {
    if (!tab || !tab.term) return

    this.detach(tab)

    const normalized = this._normalizeRendererType(rendererType)
    tab._rendererType = normalized

    if (normalized === TERMINAL_CONFIG.RENDERERS.WEBGL) {
      this._attachWebgl(tab)
    } else if (normalized === TERMINAL_CONFIG.RENDERERS.CANVAS) {
      this._attachCanvas(tab)
    } else {
      tab._rendererAddon = null
    }

    tab.recoverRenderer = () => this.recover(tab)
    this._tabs.add(tab)
  }

  /**
   * Корректно отключает рендерер вкладки и освобождает ресурсы.
   * @param {object} tab
   */
  detach(tab) {
    if (!tab) return
    this._tabs.delete(tab)

    if (typeof tab._rendererCleanup === 'function') {
      try {
        tab._rendererCleanup()
      } catch (err) {
        console.warn('[TerminalRenderer] Cleanup error:', err)
      }
      tab._rendererCleanup = null
    }

    if (tab._rendererAddon) {
      try {
        tab._rendererAddon.dispose()
      } catch (err) {
        console.warn('[TerminalRenderer] Dispose error:', err)
      }
      tab._rendererAddon = null
    }
  }

  /**
   * Восстанавливает рендерер вкладки при появлении артефактов, зависаний или битых текстур.
   * @param {object} tab
   * @returns {boolean} true если восстановление выполнено успешно
   */
  recover(tab) {
    if (!tab || !tab.term) return false

    if (tab._rendererType === TERMINAL_CONFIG.RENDERERS.WEBGL) {
      try {
        if (tab._rendererAddon && typeof tab._rendererAddon.clearTextureAtlas === 'function') {
          tab._rendererAddon.clearTextureAtlas()
          this._refreshViewport(tab)
          this._eventBus?.emit('terminal.renderer.recovered', { tabId: tab.tabId, type: 'webgl-atlas-clear' })
          return true
        }
      } catch (err) {
        console.warn('[TerminalRenderer] clearTextureAtlas failed, recreating WebGL addon:', err)
      }

      // Если очистить атлас не удалось — пересоздаем WebGL-аддон
      try {
        this.detach(tab)
        this._attachWebgl(tab)
        this._tabs.add(tab)
        this._refreshViewport(tab)
        this._eventBus?.emit('terminal.renderer.recovered', { tabId: tab.tabId, type: 'webgl-recreated' })
        return true
      } catch (err) {
        console.warn('[TerminalRenderer] WebGL re-creation failed, falling back to Canvas:', err)
        this._fallbackToCanvas(tab, 'recreate-failed')
        return true
      }
    }

    if (tab._rendererType === TERMINAL_CONFIG.RENDERERS.CANVAS) {
      try {
        tab._rendererAddon?.clearTextureAtlas?.()
        this._refreshViewport(tab)
        this._eventBus?.emit('terminal.renderer.recovered', { tabId: tab.tabId, type: 'canvas-atlas-clear' })
        return true
      } catch (err) {
        console.warn('[TerminalRenderer] Canvas clear failed, recreating Canvas addon:', err)
        this.detach(tab)
        this._attachCanvas(tab)
        this._tabs.add(tab)
        this._refreshViewport(tab)
        return true
      }
    }

    this._refreshViewport(tab)
    return true
  }

  /**
   * Вызывается при переключении на вкладку для профилактики рассинхрона текстур.
   * @param {object} tab
   */
  onTabActivated(tab) {
    if (!tab || !tab.term) return

    // Если для активной вкладки используется WebGL и за время фоновой работы
    // накопились страницы атласа или изменились размеры — сбрасываем атлас для чистой отрисовки
    if (tab._rendererType === TERMINAL_CONFIG.RENDERERS.WEBGL && tab._rendererAddon) {
      if (tab._atlasPagesCount > 1) {
        try {
          tab._rendererAddon.clearTextureAtlas?.()
          tab._atlasPagesCount = 1
          this._refreshViewport(tab)
        } catch (e) {
          // ignore
        }
      }
    }
  }

  /**
   * Применяет выбранный рендерер ко всем открытым вкладкам (на лету из настроек).
   * @param {'canvas'|'webgl'|'dom'} rendererType
   */
  setRendererTypeForAll(rendererType) {
    const normalized = this._normalizeRendererType(rendererType)
    const tabs = [...this._tabs]
    for (const tab of tabs) {
      this.attach(tab, normalized)
      try {
        tab.fitAddon?.fit()
        this._refreshViewport(tab)
      } catch (e) {
        // ignore
      }
    }
  }

  _attachCanvas(tab) {
    try {
      const addon = this._createCanvasAddon()
      tab.term.loadAddon(addon)
      tab._rendererAddon = addon
      tab._rendererType = TERMINAL_CONFIG.RENDERERS.CANVAS
      tab._rendererCleanup = () => {}
    } catch (err) {
      console.warn('[TerminalRenderer] Canvas addon failed, using DOM renderer:', err)
      tab._rendererAddon = null
      tab._rendererType = TERMINAL_CONFIG.RENDERERS.DOM
    }
  }

  _attachWebgl(tab) {
    let addon
    try {
      addon = this._createWebglAddon()
      tab.term.loadAddon(addon)
      tab._rendererAddon = addon
      tab._rendererType = TERMINAL_CONFIG.RENDERERS.WEBGL
      tab._atlasPagesCount = 1
    } catch (err) {
      console.warn('[TerminalRenderer] WebGL addon failed, falling back to Canvas:', err)
      this._fallbackToCanvas(tab, 'init-failed')
      return
    }

    let clearDebounceTimer = null

    // 1. Защита: обработка потери WebGL-контекста (GPU crash / driver reset / sleep)
    let contextLossSub = null
    if (typeof addon.onContextLoss === 'function') {
      contextLossSub = addon.onContextLoss(() => {
        console.warn('[TerminalRenderer] WebGL context lost on tab', tab.tabId, '— auto-recovering with Canvas addon')
        this._fallbackToCanvas(tab, 'context-loss')
      })
    }

    // 2. Защита: мониторинг страниц атласа текстур глифов
    let addAtlasSub = null
    if (typeof addon.onAddTextureAtlasCanvas === 'function') {
      addAtlasSub = addon.onAddTextureAtlasCanvas(() => {
        tab._atlasPagesCount = (tab._atlasPagesCount || 1) + 1
        if (tab._atlasPagesCount >= TERMINAL_CONFIG.WEBGL_MAX_ATLAS_PAGES) {
          if (!clearDebounceTimer) {
            clearDebounceTimer = setTimeout(() => {
              clearDebounceTimer = null
              try {
                addon.clearTextureAtlas?.()
                tab._atlasPagesCount = 1
                this._refreshViewport(tab)
              } catch (e) {
                // ignore
              }
            }, TERMINAL_CONFIG.WEBGL_ATLAS_CLEAR_DEBOUNCE_MS)
          }
        }
      })
    }

    tab._rendererCleanup = () => {
      if (clearDebounceTimer) {
        clearTimeout(clearDebounceTimer)
        clearDebounceTimer = null
      }
      try {
        contextLossSub?.dispose?.()
      } catch (e) { /* ignore */ }
      try {
        addAtlasSub?.dispose?.()
      } catch (e) { /* ignore */ }
    }
  }

  _fallbackToCanvas(tab, reason) {
    if (tab._rendererCleanup) {
      try { tab._rendererCleanup() } catch (e) { /* ignore */ }
      tab._rendererCleanup = null
    }
    if (tab._rendererAddon) {
      try { tab._rendererAddon.dispose() } catch (e) { /* ignore */ }
      tab._rendererAddon = null
    }

    this._attachCanvas(tab)
    this._eventBus?.emit('terminal.renderer.fallback', {
      tabId: tab.tabId,
      from: 'webgl',
      to: 'canvas',
      reason
    })

    this._refreshViewport(tab)
  }

  _refreshViewport(tab) {
    try {
      if (tab.term && typeof tab.term.refresh === 'function') {
        tab.term.refresh(0, Math.max(0, tab.term.rows - 1))
      }
    } catch (e) {
      // ignore
    }
  }

  _normalizeRendererType(type) {
    if (type === TERMINAL_CONFIG.RENDERERS.WEBGL) return TERMINAL_CONFIG.RENDERERS.WEBGL
    if (type === TERMINAL_CONFIG.RENDERERS.DOM) return TERMINAL_CONFIG.RENDERERS.DOM
    return TERMINAL_CONFIG.RENDERERS.CANVAS
  }

  destroy() {
    for (const tab of [...this._tabs]) {
      this.detach(tab)
    }
    this._tabs.clear()
  }
}
