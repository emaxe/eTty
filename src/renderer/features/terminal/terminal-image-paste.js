import { IS_MAC } from '../../core/platform.js'

/**
 * Вставка изображения из буфера обмена в SSH-вкладку.
 *
 * CLI-агенты (claude, opencode, agy) берут картинку из буфера той машины, где запущены; на
 * удалённом хосте буфера Mac нет, а xterm.js вставляет только `text/plain`. Поэтому для SSH-вкладки
 * картинка загружается на сервер (main: clipboard:upload-image), а в PTY вставляется удалённый путь
 * к файлу — агенты превращают вставленный путь изображения во вложение.
 *
 * Триггеры: событие `paste` (Cmd+V / меню) с картинкой без текста и Ctrl+V на macOS.
 * Локальные вкладки не затрагиваются — там агент читает буфер напрямую.
 */
export class TerminalImagePaste {
  /**
   * @param {Object} deps
   * @param {Object} deps.api — ElectronApiAdapter (`clipboardUploadImage`, `ptyWrite`)
   * @param {() => Object|null} deps.getTab — актуальная вкладка (pid меняется при реконнекте)
   * @param {(message: string, type: 'error'|'info') => void} deps.notify
   */
  constructor({ api, getTab, notify }) {
    this._api = api
    this._getTab = getTab
    this._notify = notify
    this._element = null
    this._onPaste = null
    this._uploading = false
  }

  /** @param {import('@xterm/xterm').Terminal} term */
  attach(term) {
    this._element = term.element
    if (!this._element) return
    this._onPaste = (event) => this._handlePasteEvent(event)
    // capture: срабатываем раньше слушателя xterm.js на textarea
    this._element.addEventListener('paste', this._onPaste, true)
  }

  detach() {
    if (this._element && this._onPaste) this._element.removeEventListener('paste', this._onPaste, true)
    this._element = null
    this._onPaste = null
    this._api = null
    this._getTab = null
    this._notify = null
  }

  /** Вкладка, для которой нужен перехват: SSH с готовым каналом удалённой ФС. */
  _eligibleTab() {
    const tab = this._getTab?.()
    return tab?.ssh && tab._sshFsAvailable === true && tab.pid != null ? tab : null
  }

  _handlePasteEvent(event) {
    const tab = this._eligibleTab()
    if (!tab) return
    const data = event.clipboardData
    if (!data) return
    const hasImage = Array.from(data.items || []).some(i => i.kind === 'file' && i.type.startsWith('image/'))
    if (!hasImage || data.getData('text/plain')) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this._upload(tab, { fallbackToCtrlV: false })
  }

  /**
   * Ctrl+V на macOS (так агенты просят вставить картинку). Возвращает true, если нажатие
   * забрано; если в буфере не оказалось картинки, в PTY уходит обычный `^V`.
   */
  handleCtrlV() {
    if (!IS_MAC) return false
    const tab = this._eligibleTab()
    if (!tab) return false
    this._upload(tab, { fallbackToCtrlV: true })
    return true
  }

  async _upload(tab, { fallbackToCtrlV }) {
    if (this._uploading) return
    this._uploading = true
    const api = this._api
    const notify = this._notify
    try {
      notify?.('Загрузка изображения на сервер…', 'info')
      const result = await api.clipboardUploadImage({ kind: 'ssh', sessionId: tab.pid })
      if (result?.success) {
        const bracketed = tab.term?.modes?.bracketedPasteMode
        api.ptyWrite(tab.pid, bracketed ? `\x1b[200~${result.path}\x1b[201~` : result.path)
        notify?.(null)
      } else if (result?.empty) {
        notify?.(null)
        if (fallbackToCtrlV) api.ptyWrite(tab.pid, '\x16')
      } else {
        notify?.(`Не удалось загрузить изображение: ${result?.error || 'неизвестная ошибка'}`, 'error')
      }
    } catch (e) {
      notify?.(`Не удалось загрузить изображение: ${e.message}`, 'error')
    } finally {
      this._uploading = false
    }
  }
}
