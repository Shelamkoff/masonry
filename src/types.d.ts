export type LayoutMode = 'masonry' | 'row' | 'column'

export interface MasonryOptions {
  /** Minimum column width in pixels. Actual width may be wider to fill the container. */
  columnWidth: number
  /** Layout mode. Default: 'masonry'. */
  layoutMode?: LayoutMode
  /** Auto-detect colSpan from image naturalWidth. Default: true. */
  autoColSpan?: boolean
  /** Gap between items in pixels (horizontal and vertical). Default: 16. */
  gap?: number
  /** Duration of reposition transition in ms. Default: 300. */
  transitionDuration?: number
  /** CSS easing function for reposition transitions. Default: 'ease'. */
  transitionEasing?: string
  /** Duration of fade-in animation in ms for new items. Default: 400. */
  fadeInDuration?: number
  /** Pixel threshold from the bottom to trigger loadMore. Default: 200. */
  infiniteScrollThreshold?: number
  /** Maximum wait for media and fonts before measurement, in ms. Default: 10000. */
  contentLoadTimeout?: number
  /** Callback fired when the user scrolls near the bottom. */
  loadMore?: () => void | Promise<void>
}

export interface MasonryItemData {
  /** Unique identifier for the item. */
  id: string
  /** Ready-made DOM element to position. */
  element: HTMLElement
  /** Fixed height in pixels. If omitted, measured via offsetHeight after content loads. */
  height?: number
  /**
   * How many columns this item spans (1 = default).
   * If omitted, auto-calculated from the natural width of images
   * inside the element relative to columnWidth.
   */
  colSpan?: number
  /** Arbitrary user data passed back through events. */
  meta?: Record<string, unknown>
}

export interface LayoutItem {
  data: MasonryItemData
  /** Wrapper div around the user element. */
  wrapper: HTMLElement
  /** Computed X position (px). */
  x: number
  /** Computed Y position (px). */
  y: number
  /** Computed rendered width (px). */
  renderedWidth: number
  /** Computed rendered height (px). */
  renderedHeight: number
}

export interface LayoutResult {
  /** Items with computed x, y, renderedWidth, renderedHeight. */
  items: LayoutItem[]
  /** Total height of the masonry container (px). */
  containerHeight: number
  /** Number of columns used. */
  columnCount: number
}

export type MasonryEventMap = {
  /** Fired when an item is clicked. */
  'item:click': [payload: { item: MasonryItemData; index: number; event: MouseEvent }]
  /** Fired after a layout recalculation completes. */
  'layout:complete': [payload: { containerHeight: number; columnCount: number }]
  /** Fired when loadMore is triggered by infinite scroll. */
  'scroll:loadmore': []
  /** Fired when loadMore rejects or throws. */
  'scroll:error': [error: unknown]
}

export type MasonryEventName = keyof MasonryEventMap
