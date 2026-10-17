/**
 * Платформа renderer-а. `navigator.userAgent` вместо устаревшего `navigator.platform`;
 * значение совпадает с `process.platform` из preload (`api.platform`) для darwin/win32.
 */
const UA = typeof navigator !== 'undefined' ? navigator.userAgent : ''

export const IS_MAC = /Macintosh|Mac OS X/.test(UA)
export const IS_WIN = /Windows/.test(UA)
