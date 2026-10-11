let _el = null
let _timer = null

/**
 * Глобальное уведомление внизу окна. `message === null` — скрыть.
 * Ошибки скрываются сами через 5 с, info остаётся до следующего вызова.
 * @param {string|null} message
 * @param {'error'|'info'} [type]
 */
export function showToast(message, type = 'info') {
  clearTimeout(_timer)
  if (!_el) {
    _el = document.createElement('div')
    _el.className = 'app-toast'
    document.body.appendChild(_el)
  }
  if (message == null) {
    _el.classList.remove('visible')
    return
  }
  _el.textContent = message
  _el.className = `app-toast visible ${type === 'error' ? 'error' : 'info'}`
  if (type === 'error') _timer = setTimeout(() => _el.classList.remove('visible'), 5000)
}
