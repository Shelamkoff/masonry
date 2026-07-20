import { EventBus } from '@shelamkoff/event-bus'
import { InfiniteScroll } from '@shelamkoff/infinite-scroll'
import { ContentLoader } from './ContentLoader.js'
import { LayoutEngine } from './LayoutEngine.js'
import { debounce } from './utils.js'

const LAYOUT_MODES = new Set(['masonry', 'row', 'column'])
const DEFAULTS = {
  layoutMode: 'masonry',
  autoColSpan: true,
  gap: 16,
  transitionDuration: 300,
  transitionEasing: 'ease',
  fadeInDuration: 400,
  infiniteScrollThreshold: 200,
  contentLoadTimeout: 10_000,
}

/**
 * Responsive masonry layout for arbitrary DOM elements.
 */
export class Masonry {
  #events = new EventBus()
  #container
  #options
  /** @type {import('./types').LayoutItem[]} */
  #items = []
  #layoutEngine = new LayoutEngine()
  #contentLoader
  #infiniteScroll = null
  #resizeObserver
  #debouncedLayout
  #containerWidth = 0
  #destroyed = false
  #clickHandler
  #appendQueue = Promise.resolve()
  #reservedIds = new Set()
  #reservedElements = new Set()
  #ownedWrappers = new Set()
  #animationFrames = new Set()
  #originalHeight
  #originalPosition
  #hadContainerClass

  /**
   * @param {HTMLElement | string} container
   * @param {import('./types').MasonryOptions} options
   */
  constructor(container, options) {
    if (typeof document === 'undefined' || typeof HTMLElement === 'undefined') {
      throw new Error('Masonry requires a browser document')
    }
    if (typeof ResizeObserver !== 'function') {
      throw new Error('Masonry requires ResizeObserver support')
    }

    if (typeof container === 'string') {
      const resolved = document.querySelector(container)
      if (!resolved) {
        throw new Error(`Masonry container "${container}" was not found`)
      }
      container = resolved
    }
    if (!(container instanceof HTMLElement)) {
      throw new TypeError('Masonry container must be an HTMLElement or a valid selector')
    }

    this.#container = container
    this.#options = this.#normalizeOptions(options)
    this.#contentLoader = new ContentLoader({
      timeout: this.#options.contentLoadTimeout,
    })

    if (this.#options.loadMore && typeof IntersectionObserver !== 'function') {
      throw new Error('Masonry infinite scrolling requires IntersectionObserver support')
    }

    this.#originalHeight = container.style.height
    this.#originalPosition = container.style.position
    this.#hadContainerClass = container.classList.contains('masonry-container')
    container.classList.add('masonry-container')
    container.style.position = 'relative'

    this.#debouncedLayout = debounce(() => {
      if (!this.#destroyed) this.layout()
    }, 100)

    this.#containerWidth = container.getBoundingClientRect().width
    this.#resizeObserver = new ResizeObserver(entries => {
      if (this.#destroyed) return
      const width = entries[0]?.contentRect.width
      if (Number.isFinite(width) && Math.abs(width - this.#containerWidth) > 0.5) {
        this.#containerWidth = width
        this.#debouncedLayout()
      }
    })
    this.#resizeObserver.observe(container)

    if (this.#options.loadMore) {
      this.#infiniteScroll = new InfiniteScroll(
        container,
        async () => {
          this.emit('scroll:loadmore')
          return this.#options.loadMore()
        },
        {
          threshold: this.#options.infiniteScrollThreshold,
          sentinel: 'masonry-sentinel',
          onError: error => this.emit('scroll:error', error),
        },
      )
    }

    this.#clickHandler = event => {
      if (!(event.target instanceof Element)) return
      const wrapper = event.target.closest('.masonry-item')
      if (
        !wrapper
        || wrapper.parentElement !== this.#container
        || !this.#ownedWrappers.has(wrapper)
      ) {
        return
      }

      const item = this.#items.find(candidate => candidate.wrapper === wrapper)
      if (!item) return
      this.emit('item:click', {
        item: { ...item.data },
        index: this.#items.indexOf(item),
        event,
      })
    }
    container.addEventListener('click', this.#clickHandler)
  }

  on(event, handler) {
    return this.#events.on(event, handler)
  }

  off(event, handler) {
    this.#events.off(event, handler)
  }

  once(event, handler) {
    return this.#events.once(event, handler)
  }

  emit(event, data) {
    this.#events.emit(event, data)
  }

  /**
   * Serially append a batch. A failed batch rejects its own promise without
   * poisoning later queued appends.
   *
   * @param {import('./types').MasonryItemData[]} items
   * @returns {Promise<void>}
   */
  append(items) {
    this.#assertActive()
    const batch = this.#reserveItems(items)
    const operation = this.#appendQueue.then(() => this.#doAppend(batch))
    this.#appendQueue = operation.catch(() => undefined)

    return operation.finally(() => {
      for (const item of batch) {
        this.#reservedIds.delete(item.id)
        this.#reservedElements.delete(item.element)
      }
    })
  }

  async #doAppend(batch) {
    this.#assertActive()
    if (batch.length === 0) return

    const containerWidth = this.#container.getBoundingClientRect().width
    if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
      throw new Error('Masonry container must have a measurable width before appending items')
    }

    const {
      columnWidth,
      gap,
      transitionDuration,
      transitionEasing,
      fadeInDuration,
    } = this.#options
    const columnCount = Math.max(1, Math.floor((containerWidth + gap) / (columnWidth + gap)))
    const actualWidth = (containerWidth - (columnCount - 1) * gap) / columnCount
    const created = []
    let committed = false

    try {
      for (const data of batch) {
        this.#assertActive()
        const originParent = data.element.parentNode
        const originNextSibling = data.element.nextSibling
        const wrapper = document.createElement('div')
        wrapper.className = 'masonry-item'
        wrapper.dataset.masonryId = data.id
        wrapper.dataset.masonryIndex = String(this.#items.length + created.length)
        wrapper.style.visibility = 'hidden'
        wrapper.appendChild(data.element)
        this.#container.appendChild(wrapper)
        this.#ownedWrappers.add(wrapper)
        created.push({ data, wrapper, originParent, originNextSibling })

        if (data.height === undefined || data.colSpan === undefined) {
          await this.#contentLoader.waitForContent(data.element)
          this.#assertActive()
        }

        if (data.colSpan === undefined) {
          data.colSpan = this.#options.autoColSpan
            ? this.#detectColSpan(data.element, columnWidth, columnCount)
            : 1
        }

        const span = Math.min(data.colSpan, columnCount)
        const width = span * actualWidth + (span - 1) * gap
        wrapper.style.width = `${width}px`

        created[created.length - 1].layoutItem = {
          data,
          wrapper,
          x: 0,
          y: 0,
          renderedWidth: width,
          renderedHeight: data.height ?? wrapper.offsetHeight,
        }
      }

      const layoutItems = created.map(entry => entry.layoutItem)
      this.#items.push(...layoutItems)
      committed = true

      this.layout()
      for (const item of layoutItems) item.wrapper.style.visibility = ''
      this.#scheduleReveal(
        layoutItems,
        transitionDuration,
        transitionEasing,
        fadeInDuration,
      )
    } catch (error) {
      if (committed) {
        const wrappers = new Set(created.map(entry => entry.wrapper))
        this.#items = this.#items.filter(item => !wrappers.has(item.wrapper))
      }
      for (const entry of created) this.#ownedWrappers.delete(entry.wrapper)
      this.#rollbackCreated(created)
      this.#reindex()
      throw error
    }
  }

  /**
   * @param {string} id
   */
  remove(id) {
    this.#assertActive()
    if (typeof id !== 'string' || id.trim() === '') {
      throw new TypeError('Masonry item id must be a non-empty string')
    }

    const index = this.#items.findIndex(item => item.data.id === id)
    if (index === -1) return
    const [item] = this.#items.splice(index, 1)
    this.#ownedWrappers.delete(item.wrapper)
    item.data.element.remove()
    item.wrapper.remove()
    this.#reindex()
    this.layout()
  }

  layout() {
    this.#assertActive()
    this.#containerWidth = this.#container.getBoundingClientRect().width
    if (!Number.isFinite(this.#containerWidth) || this.#containerWidth <= 0) return

    const first = this.#layoutEngine.calculate(
      this.#items,
      this.#containerWidth,
      this.#options.columnWidth,
      this.#options.gap,
      this.#options.layoutMode,
    )
    for (const item of first.items) {
      item.wrapper.style.width = `${item.renderedWidth}px`
    }

    let needsSecondPass = false
    for (const item of first.items) {
      if (item.data.height === undefined) {
        const measured = item.wrapper.offsetHeight
        if (measured !== item.renderedHeight) {
          item.renderedHeight = measured
          needsSecondPass = true
        }
      }
    }

    const result = needsSecondPass
      ? this.#layoutEngine.calculate(
        this.#items,
        this.#containerWidth,
        this.#options.columnWidth,
        this.#options.gap,
        this.#options.layoutMode,
      )
      : first

    for (const item of result.items) {
      item.wrapper.style.width = `${item.renderedWidth}px`
      item.wrapper.style.transform = `translate3d(${item.x}px, ${item.y}px, 0)`
    }
    this.#container.style.height = `${result.containerHeight}px`
    this.#infiniteScroll?.updateSentinelPosition(result.containerHeight)
    this.emit('layout:complete', {
      containerHeight: result.containerHeight,
      columnCount: result.columnCount,
    })
  }

  getItems() {
    this.#assertActive()
    return this.#items.map(item => ({ ...item.data }))
  }

  getColumnCount() {
    this.#assertActive()
    if (this.#containerWidth <= 0) return 1
    const { gap, columnWidth } = this.#options
    return Math.max(1, Math.floor((this.#containerWidth + gap) / (columnWidth + gap)))
  }

  destroy() {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#resizeObserver.disconnect()
    this.#infiniteScroll?.destroy()
    this.#debouncedLayout.cancel()
    this.#contentLoader.cancelAll()
    this.#container.removeEventListener('click', this.#clickHandler)

    for (const frame of this.#animationFrames) cancelAnimationFrame(frame)
    this.#animationFrames.clear()

    for (const item of this.#items) {
      if (item.wrapper.parentNode === this.#container) {
        this.#container.insertBefore(item.data.element, item.wrapper)
      } else {
        item.data.element.remove()
      }
      item.wrapper.remove()
    }
    for (const wrapper of this.#ownedWrappers) wrapper.remove()

    this.#items = []
    this.#ownedWrappers.clear()
    this.#container.style.height = this.#originalHeight
    this.#container.style.position = this.#originalPosition
    if (!this.#hadContainerClass) {
      this.#container.classList.remove('masonry-container')
    }
    this.#events.clear()
  }

  #normalizeOptions(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Masonry options must be an object')
    }

    const normalized = {
      columnWidth: options.columnWidth,
      layoutMode: options.layoutMode ?? DEFAULTS.layoutMode,
      autoColSpan: options.autoColSpan ?? DEFAULTS.autoColSpan,
      gap: options.gap ?? DEFAULTS.gap,
      transitionDuration: options.transitionDuration ?? DEFAULTS.transitionDuration,
      transitionEasing: options.transitionEasing ?? DEFAULTS.transitionEasing,
      fadeInDuration: options.fadeInDuration ?? DEFAULTS.fadeInDuration,
      infiniteScrollThreshold:
        options.infiniteScrollThreshold ?? DEFAULTS.infiniteScrollThreshold,
      contentLoadTimeout: options.contentLoadTimeout ?? DEFAULTS.contentLoadTimeout,
      loadMore: options.loadMore,
    }

    this.#assertFiniteOption('columnWidth', normalized.columnWidth, 0, false)
    this.#assertFiniteOption('gap', normalized.gap, 0, true)
    this.#assertFiniteOption('transitionDuration', normalized.transitionDuration, 0, true)
    this.#assertFiniteOption('fadeInDuration', normalized.fadeInDuration, 0, true)
    this.#assertFiniteOption(
      'infiniteScrollThreshold',
      normalized.infiniteScrollThreshold,
      0,
      true,
    )
    this.#assertFiniteOption('contentLoadTimeout', normalized.contentLoadTimeout, 0, true)

    if (!LAYOUT_MODES.has(normalized.layoutMode)) {
      throw new TypeError(`Unknown Masonry layout mode: ${String(normalized.layoutMode)}`)
    }
    if (typeof normalized.autoColSpan !== 'boolean') {
      throw new TypeError('Masonry autoColSpan must be a boolean')
    }
    if (
      typeof normalized.transitionEasing !== 'string'
      || normalized.transitionEasing.trim() === ''
    ) {
      throw new TypeError('Masonry transitionEasing must be a non-empty string')
    }
    if (normalized.loadMore !== undefined && typeof normalized.loadMore !== 'function') {
      throw new TypeError('Masonry loadMore must be a function')
    }
    return normalized
  }

  #assertFiniteOption(name, value, minimum, inclusive) {
    const belowMinimum = inclusive ? value < minimum : value <= minimum
    if (!Number.isFinite(value) || belowMinimum) {
      const qualifier = inclusive ? 'greater than or equal to' : 'greater than'
      throw new RangeError(`Masonry ${name} must be a finite number ${qualifier} ${minimum}`)
    }
  }

  #reserveItems(items) {
    if (!Array.isArray(items)) {
      throw new TypeError('Masonry append expects an array of items')
    }

    const ids = new Set()
    const elements = new Set()
    const existingIds = new Set(this.#items.map(item => item.data.id))
    const existingElements = new Set(this.#items.map(item => item.data.element))
    const normalized = items.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new TypeError(`Masonry item at index ${index} must be an object`)
      }
      if (typeof item.id !== 'string' || item.id.trim() === '') {
        throw new TypeError(`Masonry item at index ${index} must have a non-empty string id`)
      }
      if (!(item.element instanceof HTMLElement)) {
        throw new TypeError(`Masonry item "${item.id}" element must be an HTMLElement`)
      }
      if (item.height !== undefined && (!Number.isFinite(item.height) || item.height < 0)) {
        throw new RangeError(`Masonry item "${item.id}" height must be a non-negative finite number`)
      }
      if (item.colSpan !== undefined && (!Number.isInteger(item.colSpan) || item.colSpan < 1)) {
        throw new RangeError(`Masonry item "${item.id}" colSpan must be a positive integer`)
      }

      const id = item.id.trim()
      if (ids.has(id) || existingIds.has(id) || this.#reservedIds.has(id)) {
        throw new Error(`Masonry item id "${id}" is already in use`)
      }
      if (
        elements.has(item.element)
        || existingElements.has(item.element)
        || this.#reservedElements.has(item.element)
      ) {
        throw new Error(`Masonry item "${id}" reuses an element that is already in use`)
      }
      ids.add(id)
      elements.add(item.element)
      return { ...item, id }
    })

    for (const item of normalized) {
      this.#reservedIds.add(item.id)
      this.#reservedElements.add(item.element)
    }
    return normalized
  }

  #detectColSpan(element, columnWidth, columnCount) {
    const images = [
      ...(element.matches('img') ? [element] : []),
      ...element.querySelectorAll('img'),
    ]
    const maxNaturalWidth = images.reduce(
      (max, image) => Math.max(max, image.naturalWidth || 0),
      0,
    )
    if (maxNaturalWidth <= columnWidth) return 1
    return Math.max(1, Math.min(Math.round(maxNaturalWidth / columnWidth), columnCount))
  }

  #scheduleReveal(items, transitionDuration, transitionEasing, fadeInDuration) {
    const frame = requestAnimationFrame(() => {
      this.#animationFrames.delete(frame)
      if (this.#destroyed) return
      for (const item of items) {
        if (!this.#ownedWrappers.has(item.wrapper)) continue
        item.wrapper.style.transition = [
          `transform ${transitionDuration}ms ${transitionEasing}`,
          `opacity ${fadeInDuration}ms ease`,
        ].join(', ')
        item.wrapper.classList.add('masonry-item--visible')
      }
    })
    this.#animationFrames.add(frame)
  }

  #rollbackCreated(created) {
    for (const entry of [...created].reverse()) {
      const { data, wrapper, originParent, originNextSibling } = entry
      data.element.remove()
      wrapper.remove()
      if (originParent) {
        const reference = originNextSibling?.parentNode === originParent
          ? originNextSibling
          : null
        originParent.insertBefore(data.element, reference)
      }
    }
  }

  #reindex() {
    this.#items.forEach((item, index) => {
      item.wrapper.dataset.masonryIndex = String(index)
    })
  }

  #assertActive() {
    if (this.#destroyed) {
      throw new Error('Masonry instance has been destroyed')
    }
  }
}
