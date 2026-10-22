import { RADIAL_MENU_CONFIG } from '../../core/config/radial-menu-config.js'
import { sectorAt } from './radial-menu-model.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const R = RADIAL_MENU_CONFIG.RADIUS_PX
const DEAD = RADIAL_MENU_CONFIG.DEAD_ZONE_PX
const LIST_GAP = 10

/**
 * Радиальное меню поверх терминала: первый уровень — кольцо секторов (по часовой с 12 часов,
 * в центре «✕»), вложенные уровни — обычный список рядом с выбранным сектором, где помещается
 * полный текст. Хит-тест кольца считается по координатам, а не по SVG-элементам.
 *
 * Уровень: `{ items: [{ label, children?: Level, run?: () => Level | void }] }`.
 */
export class RadialMenu {
  /** @param {{ containerEl: HTMLElement }} opts — позиционированный контейнер терминалов */
  constructor({ containerEl }) {
    this._containerEl = containerEl
    this._overlay = null
    this._svg = null
    this._center = { x: 0, y: 0 }
    this._root = null
    this._listEl = null
    this._listStack = []
    this._selected = null
    this._highlight = null
    this._onMove = this._onMove.bind(this)
    this._onClick = this._onClick.bind(this)
    this._onKeyDown = this._onKeyDown.bind(this)
  }

  isVisible() {
    return !!this._overlay
  }

  /** @param {number} clientX @param {number} clientY @param {{items: Array}} level */
  show(clientX, clientY, level) {
    const rect = this._containerEl.getBoundingClientRect()
    this._open(this._clampCenter(clientX - rect.left, clientY - rect.top, rect), level)
  }

  hide() {
    if (!this._overlay) return
    document.removeEventListener('keydown', this._onKeyDown, true)
    this._overlay.remove()
    this._overlay = null
    this._svg = null
    this._listEl = null
    this._listStack = []
    this._root = null
    this._selected = null
    this._highlight = null
  }

  destroy() {
    this.hide()
    this._containerEl = null
  }

  _clampCenter(x, y, rect) {
    const m = R + RADIAL_MENU_CONFIG.EDGE_MARGIN_PX
    const clamp = (v, max) => (max < 2 * m ? max / 2 : Math.min(Math.max(v, m), max - m))
    return { x: clamp(x, rect.width), y: clamp(y, rect.height) }
  }

  _open(center, level) {
    this.hide()
    this._center = center
    this._root = level

    const overlay = document.createElement('div')
    overlay.className = 'radial-menu-overlay'
    overlay.addEventListener('mousemove', this._onMove)
    overlay.addEventListener('mousedown', (e) => e.stopPropagation())
    overlay.addEventListener('click', this._onClick)
    overlay.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      this.hide()
    })
    this._overlay = overlay
    this._containerEl.appendChild(overlay)
    document.addEventListener('keydown', this._onKeyDown, true)
    this._render()
  }

  _onKeyDown(e) {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    if (this._listEl) this._closeList()
    else this.hide()
  }

  _sectorFor(e, radius = null) {
    const rect = this._overlay.getBoundingClientRect()
    return sectorAt(e.clientX - rect.left - this._center.x, e.clientY - rect.top - this._center.y, {
      count: this._root.items.length,
      deadZone: DEAD,
      radius
    })
  }

  _onMove(e) {
    if (e.target.closest?.('.radial-menu-list')) return
    const sector = this._sectorFor(e, R)
    if (sector === this._highlight) return
    this._highlight = sector
    this._syncSectorClasses()
  }

  _onClick(e) {
    if (e.target.closest?.('.radial-menu-list')) return
    const sector = this._sectorFor(e, R)
    if (sector !== null) {
      this._chooseRoot(sector)
      return
    }
    const rect = this._overlay.getBoundingClientRect()
    const dist = Math.hypot(e.clientX - rect.left - this._center.x, e.clientY - rect.top - this._center.y)
    if (dist < DEAD && this._listEl) this._closeList()
    else this.hide()
  }

  _chooseRoot(index) {
    const item = this._root.items[index]
    if (!item.children) {
      this._run(item)
      return
    }
    if (!item.children.items.length) return
    this._selected = index
    this._listStack = [{ level: item.children, title: item.label }]
    this._renderList()
    this._syncSectorClasses()
  }

  _run(item) {
    const center = this._center
    this.hide()
    const next = item.run?.()
    if (next?.items?.length) this._open(center, next)
  }

  _syncSectorClasses() {
    this._svg?.querySelectorAll('.radial-menu-sector, .radial-menu-label').forEach((el, i) => {
      const index = i % this._root.items.length
      el.classList.toggle('highlighted', index === this._highlight)
      el.classList.toggle('selected', index === this._selected)
    })
  }

  _closeList() {
    this._listEl?.remove()
    this._listEl = null
    this._listStack = []
    this._selected = null
    this._syncSectorClasses()
  }

  /** Список вложенного уровня рядом с выбранным сектором; пункты со своими детьми заменяют содержимое. */
  _renderList() {
    this._listEl?.remove()
    const { level, title } = this._listStack[this._listStack.length - 1]
    const el = document.createElement('div')
    el.className = 'radial-menu-list'
    el.addEventListener('contextmenu', (e) => e.preventDefault())

    const header = document.createElement('div')
    header.className = 'radial-menu-list-title'
    if (this._listStack.length > 1) {
      header.classList.add('clickable')
      header.textContent = `← ${title}`
      header.addEventListener('click', () => {
        this._listStack.pop()
        this._renderList()
      })
    } else {
      header.textContent = title
    }
    el.appendChild(header)

    for (const item of level.items) {
      const row = document.createElement('div')
      row.className = 'radial-menu-list-item'
      row.textContent = item.children ? `${item.label} ›` : item.label
      row.addEventListener('click', () => {
        if (item.children) {
          if (!item.children.items.length) return
          this._listStack.push({ level: item.children, title: item.label })
          this._renderList()
        } else {
          this._run(item)
        }
      })
      el.appendChild(row)
    }

    el.style.visibility = 'hidden'
    this._overlay.appendChild(el)
    this._listEl = el
    this._positionList(el)
    el.style.visibility = ''
  }

  /** Ставит список снаружи кольца со стороны выбранного сектора, не выходя за границы контейнера. */
  _positionList(el) {
    const bounds = this._overlay.getBoundingClientRect()
    const m = RADIAL_MENU_CONFIG.EDGE_MARGIN_PX
    el.style.maxHeight = `${Math.max(bounds.height - 2 * m, 80)}px`
    const w = el.offsetWidth
    const h = el.offsetHeight

    const angle = (this._selected * 2 * Math.PI) / this._root.items.length
    const dx = Math.sin(angle)
    const dy = -Math.cos(angle)
    const ax = this._center.x + dx * (R + LIST_GAP)
    const ay = this._center.y + dy * (R + LIST_GAP)

    const place = (a, size, d) => (d > 0.35 ? a : d < -0.35 ? a - size : a - size / 2)
    const clamp = (v, size, max) => (max < size + 2 * m ? (max - size) / 2 : Math.min(Math.max(v, m), max - size - m))
    el.style.left = `${clamp(place(ax, w, dx), w, bounds.width)}px`
    el.style.top = `${clamp(place(ay, h, dy), h, bounds.height)}px`
  }

  _render() {
    const items = this._root.items
    const { x: cx, y: cy } = this._center

    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('class', 'radial-menu')
    svg.setAttribute('width', String(R * 2))
    svg.setAttribute('height', String(R * 2))
    svg.style.left = `${cx - R}px`
    svg.style.top = `${cy - R}px`

    // Сначала все секторы, потом все подписи: иначе соседний сектор перекрывает чужой текст
    const step = (2 * Math.PI) / items.length
    const labels = []
    items.forEach((item, i) => {
      const path = document.createElementNS(SVG_NS, 'path')
      path.setAttribute('class', 'radial-menu-sector')
      path.setAttribute('d', sectorPath(i, items.length))
      path.setAttribute('fill-rule', 'evenodd')
      svg.appendChild(path)

      const mid = i * step
      const labelR = (R + DEAD) / 2
      const text = document.createElementNS(SVG_NS, 'text')
      text.setAttribute('class', 'radial-menu-label')
      text.setAttribute('x', String(R + labelR * Math.sin(mid)))
      text.setAttribute('y', String(R - labelR * Math.cos(mid)))
      text.textContent = truncate(item.label) + (item.children ? ' ›' : '')
      const title = document.createElementNS(SVG_NS, 'title')
      title.textContent = item.label
      text.appendChild(title)
      labels.push(text)
    })
    svg.append(...labels)

    const hub = document.createElementNS(SVG_NS, 'circle')
    hub.setAttribute('class', 'radial-menu-hub')
    hub.setAttribute('cx', String(R))
    hub.setAttribute('cy', String(R))
    hub.setAttribute('r', String(DEAD))
    const hubText = document.createElementNS(SVG_NS, 'text')
    hubText.setAttribute('class', 'radial-menu-hub-label')
    hubText.setAttribute('x', String(R))
    hubText.setAttribute('y', String(R))
    hubText.textContent = '✕'
    svg.append(hub, hubText)

    this._svg?.remove()
    this._svg = svg
    this._overlay.appendChild(svg)
    this._syncSectorClasses()
  }
}

function truncate(label) {
  const max = RADIAL_MENU_CONFIG.MAX_LABEL_CHARS
  const s = String(label ?? '')
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** Кольцевой сектор `i` из `count` в системе координат svg (центр — (R, R)). */
function sectorPath(i, count) {
  if (count === 1) {
    return `M ${R - R} ${R} a ${R} ${R} 0 1 0 ${2 * R} 0 a ${R} ${R} 0 1 0 ${-2 * R} 0 ` +
      `M ${R - DEAD} ${R} a ${DEAD} ${DEAD} 0 1 1 ${2 * DEAD} 0 a ${DEAD} ${DEAD} 0 1 1 ${-2 * DEAD} 0`
  }
  const step = (2 * Math.PI) / count
  const a0 = (i - 0.5) * step
  const a1 = (i + 0.5) * step
  const pt = (r, a) => `${R + r * Math.sin(a)} ${R - r * Math.cos(a)}`
  const large = step > Math.PI ? 1 : 0
  return `M ${pt(R, a0)} A ${R} ${R} 0 ${large} 1 ${pt(R, a1)} L ${pt(DEAD, a1)} ` +
    `A ${DEAD} ${DEAD} 0 ${large} 0 ${pt(DEAD, a0)} Z`
}
