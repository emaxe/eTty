let _el = null
let _timer = null

/** Сколько показывать уведомление, мс; info остаётся до следующего вызова. */
const TOAST_TIMEOUT_MS = Object.freeze({ error: 6000, success: 3000 })

/**
 * Единое уведомление внизу окна (над статус-баром). `message === null` — скрыть.
 * Ошибки скрываются через 6 с, успех — через 3 с, info остаётся до следующего вызова.
 * Читается скринридером (role="status").
 * @param {string|null} message
 * @param {'error'|'success'|'info'} [type]
 */
export function showToast(message, type = 'info') {
  clearTimeout(_timer)
  if (!_el) {
    _el = document.createElement('div')
    _el.className = 'app-toast'
    _el.setAttribute('role', 'status')
    _el.setAttribute('aria-live', 'polite')
    document.body.appendChild(_el)
  }
  if (message == null) {
    _el.classList.remove('visible')
    return
  }
  const kind = type === 'error' || type === 'success' ? type : 'info'
  _el.textContent = message
  _el.className = `app-toast visible ${kind}`
  const timeout = TOAST_TIMEOUT_MS[kind]
  if (timeout) _timer = setTimeout(() => _el.classList.remove('visible'), timeout)
}
