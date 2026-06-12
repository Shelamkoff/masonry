import { EventBus } from '../../event-bus/index.js'
import { LayoutEngine } from './LayoutEngine.js'
import { ContentLoader } from './ContentLoader.js'
import { InfiniteScroll } from '../../infinite-scroll/src/index.js'
import { debounce } from './utils.js'

const DEFAULTS = {
  gap: 16,
  transitionDuration: 300,
  transitionEasing: 'ease',
  fadeInDuration: 400,
  infiniteScrollThreshold: 200,
}

/**
 * Masonry layout engine for arbitrary DOM blocks.
 *
 * @example
 * const m = new Masonry(container, { columnWidth: 280, gap: 16 })
 * m.append([{ id: '1', element: cardEl }])
 * m.on('item:click', ({ item }) => console.log(item))
 */
export class Masonry {
  /** @type {EventBus} */
  #events = new EventBus()

  #container
  #options
  /** @type {import('./types').LayoutItem[]} */
  #items = []
  #layoutEngine
  #contentLoader
  #infiniteScroll = null
  #resizeObserver
  #debouncedLayout
  #containerWidth = 0
  #destroyed = false
  #clickHandler
  /** @type {Promise<void>} */
  #appendQueue = Promise.resolve()

  /**
   * @param {string} event
   * @param {Function} handler
   * @returns {() => void}
   */
  on(event, handler) { return this.#events.on(event, handler) }

  /**
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) { this.#events.off(event, handler) }

  /**
   * @param {string} event
   * @param {Function} handler
   * @returns {() => void}
   */
  once(event, handler) { return this.#events.once(event, handler) }

  /**
   * @param {string} event
   * @param {*} [data]
   */
  emit(event, data) { this.#events.emit(event, data) }

  /**
   * @param {HTMLElement | string} container
   * @param {import('./types').MasonryOptions} options
   */
  constructor(container, options) {
    // Resolve container
    if (typeof container === 'string') {
      const el = document.querySelector(container)
      if (!el) throw new Error(`Masonry: container "${container}" not found`)
      this.#container = el
    } else {
      this.#container = container
    }

    // Validate required options
    if (typeof options.columnWidth !== 'number' || !options.columnWidth || options.columnWidth <= 0) {
      throw new Error('Masonry: columnWidth must be a positive number')
    }

    // Merge options with defaults
    this.#options = {
      columnWidth: options.columnWidth,
      layoutMode: options.layoutMode ?? 'masonry',
      autoColSpan: options.autoColSpan ?? true,
      gap: options.gap ?? DEFAULTS.gap,
      transitionDuration: options.transitionDuration ?? DEFAULTS.transitionDuration,
      transitionEasing: options.transitionEasing ?? DEFAULTS.transitionEasing,
      fadeInDuration: options.fadeInDuration ?? DEFAULTS.fadeInDuration,
      infiniteScrollThreshold: options.infiniteScrollThreshold ?? DEFAULTS.infiniteScrollThreshold,
      loadMore: options.loadMore,
    }

    this.#layoutEngine = new LayoutEngine()
    this.#contentLoader = new ContentLoader()

    // Container setup
    this.#container.classList.add('masonry-container')
    this.#container.style.position = 'relative'

    // Debounced layout for resize
    this.#debouncedLayout = debounce(() => this.layout(), 100)

    // ResizeObserver — relayout when container width changes
    this.#containerWidth = this.#container.getBoundingClientRect().width
    this.#resizeObserver = new ResizeObserver((entries) => {
      if (this.#destroyed) return
      const entry = entries[0]
      if (!entry) return

      const newWidth = entry.contentRect.width
      if (Math.abs(newWidth - this.#containerWidth) > 0.5) {
        this.#containerWidth = newWidth
        this.#debouncedLayout()
      }
    })
    this.#resizeObserver.observe(this.#container)

    // Infinite scroll
    if (this.#options.loadMore) {
      this.#infiniteScroll = new InfiniteScroll(
        this.#container,
        () => {
          this.emit('scroll:loadmore')
          return this.#options.loadMore?.() ?? Promise.resolve()
        },
        {
          threshold: this.#options.infiniteScrollThreshold,
          sentinel: 'masonry-sentinel',
        },
      )
    }

    // Delegated click handler
    this.#clickHandler = (e) => {
      const wrapper = e.target.closest('.masonry-item')
      if (!wrapper) return

      const id = wrapper.dataset.masonryId
      const item = this.#items.find((i) => i.data.id === id)
      if (!item) return

      const index = this.#items.indexOf(item)
      this.emit('item:click', { item: item.data, index, event: e })
    }
    this.#container.addEventListener('click', this.#clickHandler)
  }

  /**
   * Append new items to the grid.
   *
   * Calls are serialised: if a previous append is still loading content,
   * new calls queue behind it so insertion order is always preserved.
   *
   * @param {import('./types').MasonryItemData[]} items
   * @returns {Promise<void>}
   */
  append(items) {
    if (this.#destroyed) return Promise.resolve()

    // .catch() ensures a failed append does not break subsequent queued calls
    this.#appendQueue = this.#appendQueue
      .then(() => this.#doAppend(items))
      .catch((err) => console.error('Masonry: append failed', err))
    return this.#appendQueue
  }

  /**
   * Internal append — must only run inside the serialised queue.
   *
   * If an item has no explicit `height`, ContentLoader waits for all media
   * (images, video, fonts) inside the element before measuring offsetHeight.
   *
   * @param {import('./types').MasonryItemData[]} items
   * @returns {Promise<void>}
   */
  async #doAppend(items) {
    if (this.#destroyed) return

    // Pre-calculate column width so wrappers are sized correctly before height measurement
    const containerWidth = this.#container.getBoundingClientRect().width
    const { columnWidth, gap, transitionDuration, transitionEasing, fadeInDuration } = this.#options
    const columnCount = Math.max(1, Math.floor((containerWidth + gap) / (columnWidth + gap)))
    const actualWidth = (containerWidth - (columnCount - 1) * gap) / columnCount

    const newLayoutItems = []

    for (const data of items) {
      if (this.#destroyed) {
        // Clean up wrappers already created in this batch but not yet tracked
        for (const li of newLayoutItems) li.wrapper.remove()
        return
      }

      // Create wrapper
      const wrapper = document.createElement('div')
      wrapper.className = 'masonry-item'
      wrapper.dataset.masonryId = data.id
      wrapper.dataset.masonryIndex = String(this.#items.length + newLayoutItems.length)

      // Insert user element into wrapper (needed for offsetHeight measurement).
      // Transition is set later (in rAF after first layout) so the initial
      // positioning is instant — prevents items sliding from (0,0).
      // Keep it invisible so a resize-triggered layout() does not flash
      // unpositioned wrappers at (0,0).
      wrapper.appendChild(data.element)
      wrapper.style.visibility = 'hidden'
      this.#container.appendChild(wrapper)

      // Wait for content before measuring (needed for both colSpan and height)
      const needsMeasure = data.height == null || data.colSpan == null
      if (needsMeasure) {
        await this.#contentLoader.waitForContent(data.element)
      }

      // Auto-calculate colSpan from natural image width if not provided
      if (data.colSpan == null) {
        data.colSpan = this.#options.autoColSpan
          ? this.#detectColSpan(data.element, columnWidth, columnCount)
          : 1
      }

      // Set wrapper width based on colSpan
      const span = Math.max(1, Math.min(data.colSpan, columnCount))
      const itemWidth = span * actualWidth + (span - 1) * gap
      wrapper.style.width = `${itemWidth}px`

      /** @type {import('./types').LayoutItem} */
      const layoutItem = {
        data,
        wrapper,
        x: 0,
        y: 0,
        renderedWidth: itemWidth,
        renderedHeight: data.height ?? 0,
      }

      // If no explicit height — measure after width is set
      if (data.height == null) {
        layoutItem.renderedHeight = wrapper.offsetHeight
      }

      newLayoutItems.push(layoutItem)
    }

    this.#items.push(...newLayoutItems)

    // Recalculate layout (positions items via transforms)
    this.layout()

    // Make wrappers visible AFTER layout has positioned them
    for (const li of newLayoutItems) {
      li.wrapper.style.visibility = ''
    }

    // Fade in new items.
    // The rAF fires after the browser paints items at their calculated positions,
    // so setting the transition here means the initial transform is already committed
    // and won't animate. Only future repositions (resize, remove) will transition.
    requestAnimationFrame(() => {
      for (const item of newLayoutItems) {
        item.wrapper.style.transition = [
          `transform ${transitionDuration}ms ${transitionEasing}`,
          `opacity ${fadeInDuration}ms ease`,
        ].join(', ')
        item.wrapper.classList.add('masonry-item--visible')
      }
    })
  }

  /**
   * Remove an item by id.
   * @param {string} id
   */
  remove(id) {
    const index = this.#items.findIndex((i) => i.data.id === id)
    if (index === -1) return

    const item = this.#items[index]
    item.wrapper.remove()
    this.#items.splice(index, 1)

    // Re-index remaining items
    for (let i = 0; i < this.#items.length; i++) {
      this.#items[i].wrapper.dataset.masonryIndex = String(i)
    }

    this.layout()
  }

  /** Recalculate positions and apply transforms. */
  layout() {
    if (this.#destroyed) return

    this.#containerWidth = this.#container.getBoundingClientRect().width
    if (this.#containerWidth <= 0) return

    // First pass: calculate layout to get new widths
    const first = this.#layoutEngine.calculate(
      this.#items,
      this.#containerWidth,
      this.#options.columnWidth,
      this.#options.gap,
      this.#options.layoutMode,
    )

    // Batch-write all widths first (no reads between writes — avoids layout thrashing)
    for (const item of first.items) {
      item.wrapper.style.width = `${item.renderedWidth}px`
    }

    // Batch-read: a single reflow measures all items at once
    let needsSecondPass = false
    for (const item of first.items) {
      if (item.data.height == null) {
        const measured = item.wrapper.offsetHeight
        if (measured !== item.renderedHeight) {
          item.renderedHeight = measured
          needsSecondPass = true
        }
      }
    }

    // Second pass: recalculate positions with updated heights
    let result = first
    if (needsSecondPass) {
      result = this.#layoutEngine.calculate(
        this.#items,
        this.#containerWidth,
        this.#options.columnWidth,
        this.#options.gap,
        this.#options.layoutMode,
      )
    }

    // Apply positions via transform (GPU-accelerated)
    for (const item of result.items) {
      item.wrapper.style.width = `${item.renderedWidth}px`
      item.wrapper.style.transform = `translate3d(${item.x}px, ${item.y}px, 0)`
    }

    // Update container height
    this.#container.style.height = `${result.containerHeight}px`

    // Move sentinel to bottom
    this.#infiniteScroll?.updateSentinelPosition(result.containerHeight)

    this.emit('layout:complete', { containerHeight: result.containerHeight, columnCount: result.columnCount })
  }

  /**
   * Get a shallow copy of all current items' data.
   * @returns {import('./types').MasonryItemData[]}
   */
  getItems() {
    return this.#items.map((i) => i.data)
  }

  /**
   * Get the current column count (based on the last layout pass).
   * @returns {number}
   */
  getColumnCount() {
    if (this.#containerWidth <= 0) return 1
    const { gap, columnWidth } = this.#options
    return Math.max(1, Math.floor((this.#containerWidth + gap) / (columnWidth + gap)))
  }

  /**
   * Detect colSpan from the natural width of images inside the element.
   * Falls back to 1 if no images or no meaningful width detected.
   *
   * @param {HTMLElement} element
   * @param {number} columnWidth
   * @param {number} columnCount
   * @returns {number}
   */
  #detectColSpan(element, columnWidth, columnCount) {
    const images = element.querySelectorAll('img')
    let maxNatural = 0

    for (const img of images) {
      if (img.naturalWidth > maxNatural) {
        maxNatural = img.naturalWidth
      }
    }

    if (maxNatural <= columnWidth) return 1

    const span = Math.round(maxNatural / columnWidth)
    return Math.max(1, Math.min(span, columnCount))
  }

  /** Tear down everything: observers, listeners, DOM wrappers. */
  destroy() {
    if (this.#destroyed) return
    this.#destroyed = true

    this.#resizeObserver.disconnect()
    this.#infiniteScroll?.destroy()
    this.#debouncedLayout.cancel()
    this.#contentLoader.cancelAll()
    this.#container.removeEventListener('click', this.#clickHandler)

    // Remove ALL masonry-item wrappers from DOM — including orphaned ones
    // from a partially-completed async append
    const wrappers = this.#container.querySelectorAll('.masonry-item')
    for (const w of wrappers) {
      w.remove()
    }
    this.#items = []

    // Reset container styles
    this.#container.style.height = ''
    this.#container.style.position = ''
    this.#container.classList.remove('masonry-container')

    this.#events.clear()
  }
}
