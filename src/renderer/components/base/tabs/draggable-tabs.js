import { APP_CONFIG } from '../../core/config/app-config.js'

/**
 * Generic drag-and-drop tab reordering.
 *
 * Wires mouse events on draggable children of a container.
 * Reorders DOM elements visually during drag, then calls `onReorder(fromIndex, toIndex)`
 * so the parent can sync its internal data model.
 *
 * @example
 * const dt = new DraggableTabs(tabBarEl, {
 *   onReorder: (from, to) => { ... },
 *   dragHandleSelector: '.tab-drag-handle', // optional
 *   excludedSelector: '.tab-add-btn'          // optional, children to skip
 * })
 * // Later, as tabs are added:
 * dt.observeElement(tabElement)
 */
export class DraggableTabs {
  constructor(container, options = {}) {
    this._container = container
    this._onReorder = options.onReorder || (() => {})
    this._dragHandleSelector = options.dragHandleSelector || null
    this._excludedSelector = options.excludedSelector || null
    this._threshold = APP_CONFIG.DRAG_START_THRESHOLD_PX

    this._dragState = null
    this._dropIndicator = null

    this._onMouseMove = this._onMouseMove.bind(this)
    this._onMouseUp = this._onMouseUp.bind(this)

    // Observe existing children
    this._observeExisting()
  }

  _observeExisting() {
    for (const child of this._getDraggableChildren()) {
      this.observeElement(child)
    }
  }

  /**
   * Attach drag listener to a newly added tab element.
   * @param {HTMLElement} element
   */
  observeElement(element) {
    const handle = this._dragHandleSelector
      ? element.querySelector(this._dragHandleSelector)
      : element
    if (!handle) return

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      // Don't initiate drag if clicking a close button or other interactive element
      if (e.target.closest('.tab-close')) return
      this._startDrag(element, e)
    })
  }

  _getDraggableChildren() {
    const children = Array.from(this._container.children)
    if (!this._excludedSelector) return children
    return children.filter(el => !el.matches(this._excludedSelector))
  }

  _getChildIndex(element) {
    return this._getDraggableChildren().indexOf(element)
  }

  _startDrag(element, e) {
    e.stopPropagation()
    e.preventDefault()

    this._dragState = {
      element,
      startX: e.clientX,
      startY: e.clientY,
      isDragging: false,
      fromIndex: this._getChildIndex(element),
      dropTargetIndex: null,
    }

    document.addEventListener('mousemove', this._onMouseMove)
    document.addEventListener('mouseup', this._onMouseUp)
  }

  _onMouseMove(e) {
    const ds = this._dragState
    if (!ds) return

    const dx = e.clientX - ds.startX
    const dy = e.clientY - ds.startY

    if (!ds.isDragging) {
      if (Math.abs(dx) < this._threshold && Math.abs(dy) < this._threshold) return
      ds.isDragging = true
      ds.element.classList.add('dragging')
      document.body.style.cursor = 'grabbing'
      this._createDropIndicator()
    }

    const targetIndex = this._getDropIndex(e.clientX)
    if (targetIndex !== ds.dropTargetIndex) {
      ds.dropTargetIndex = targetIndex
      this._positionDropIndicator(targetIndex)
    }
  }

  _onMouseUp() {
    document.removeEventListener('mousemove', this._onMouseMove)
    document.removeEventListener('mouseup', this._onMouseUp)

    const ds = this._dragState
    if (!ds) return

    if (ds.isDragging && ds.dropTargetIndex != null) {
      const toIndex = ds.dropTargetIndex
      if (toIndex !== ds.fromIndex && toIndex !== ds.fromIndex + 1) {
        this._reorderDom(ds.fromIndex, toIndex)
        const insertAt = toIndex > ds.fromIndex ? toIndex - 1 : toIndex
        this._onReorder(ds.fromIndex, insertAt)
      }
    }

    ds.element.classList.remove('dragging')
    document.body.style.cursor = ''
    this._removeDropIndicator()
    this._dragState = null
  }

  _getDropIndex(clientX) {
    const children = this._getDraggableChildren()
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect()
      const midX = rect.left + rect.width / 2
      if (clientX < midX) return i
    }
    return children.length
  }

  _reorderDom(fromIndex, toIndex) {
    const children = this._getDraggableChildren()
    const element = children[fromIndex]
    const insertBefore = toIndex < children.length ? children[toIndex] : null

    if (insertBefore) {
      this._container.insertBefore(element, insertBefore)
    } else {
      this._container.appendChild(element)
    }
  }

  _createDropIndicator() {
    const indicator = document.createElement('div')
    indicator.className = 'tab-drop-indicator'
    this._container.appendChild(indicator)
    this._dropIndicator = indicator
  }

  _positionDropIndicator(targetIndex) {
    if (!this._dropIndicator) return
    const children = this._getDraggableChildren()
    const containerRect = this._container.getBoundingClientRect()
    let left
    if (targetIndex < children.length) {
      const rect = children[targetIndex].getBoundingClientRect()
      left = rect.left - containerRect.left - 1
    } else {
      const lastRect = children[children.length - 1].getBoundingClientRect()
      left = lastRect.right - containerRect.left - 1
    }
    this._dropIndicator.style.left = left + 'px'
  }

  _removeDropIndicator() {
    if (this._dropIndicator) {
      this._dropIndicator.remove()
      this._dropIndicator = null
    }
  }

  destroy() {
    if (this._dragState) {
      this._onMouseUp()
    }
    this._removeDropIndicator()
  }
}
