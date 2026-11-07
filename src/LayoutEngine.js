import { getColumnCount } from './utils.js'

const LAYOUT_MODES = new Set(['masonry', 'row', 'column'])

/**
 * Stateless calculator for masonry, row, and column layouts.
 */
export class LayoutEngine {
  /**
   * @param {import('./types').LayoutItem[]} items
   * @param {number} containerWidth
   * @param {number} columnWidth
   * @param {number} gap
   * @param {import('./types').LayoutMode} [mode='masonry']
   * @returns {import('./types').LayoutResult}
   */
  calculate(items, containerWidth, columnWidth, gap, mode = 'masonry') {
    this.#validateInput(items, containerWidth, columnWidth, gap, mode)

    const columnCount = getColumnCount(containerWidth, columnWidth, gap)
    const actualWidth = (containerWidth - (columnCount - 1) * gap) / columnCount

    if (mode === 'row') {
      return this.#calculateRow(items, actualWidth, gap, columnCount)
    }
    if (mode === 'column') {
      return this.#calculateColumn(items, actualWidth, gap, columnCount)
    }
    return this.#calculateMasonry(items, actualWidth, gap, columnCount)
  }

  #calculateMasonry(items, actualWidth, gap, columnCount) {
    // A layout can never reach a column beyond the sum of its item spans.
    // Avoid allocating empty columns when the requested width is very small.
    const occupiedColumns = columnCount <= items.length
      ? columnCount
      : items.reduce(
        (count, item) => Math.min(columnCount, count + this.#getColSpan(item, columnCount)),
        0,
      )
    const columnHeights = new Array(occupiedColumns).fill(0)
    let maxima

    for (const item of items) {
      const span = this.#getColSpan(item, columnCount)
      const height = this.#getHeight(item)
      let bestColumn = 0
      let bestHeight = Infinity

      if (span === 1) {
        for (let column = 0; column < occupiedColumns; column += 1) {
          if (columnHeights[column] < bestHeight) {
            bestColumn = column
            bestHeight = columnHeights[column]
            if (bestHeight === 0) break
          }
        }
      } else if (span === occupiedColumns) {
        bestHeight = 0
        for (const height of columnHeights) bestHeight = Math.max(bestHeight, height)
      } else {
        // A monotonic deque finds every span's maximum in one pass. Reuse its
        // storage between items instead of rescanning each overlapping group.
        maxima ??= new Array(occupiedColumns)
        let head = 0
        let tail = 0

        for (let column = 0; column < occupiedColumns; column += 1) {
          const firstColumn = column - span + 1
          while (head < tail && maxima[head] < firstColumn) head += 1
          while (
            head < tail
            && columnHeights[maxima[tail - 1]] <= columnHeights[column]
          ) tail -= 1
          maxima[tail++] = column
          if (firstColumn < 0) continue

          const groupHeight = columnHeights[maxima[head]]
          if (groupHeight < bestHeight) {
            bestColumn = firstColumn
            bestHeight = groupHeight
            if (bestHeight === 0) break
          }
        }
      }

      item.x = bestColumn * actualWidth + bestColumn * gap
      item.y = bestHeight
      item.renderedWidth = this.#spanWidth(span, actualWidth, gap)
      item.renderedHeight = height

      const bottom = item.y + height + gap
      for (let offset = 0; offset < span; offset += 1) {
        columnHeights[bestColumn + offset] = bottom
      }
    }

    return this.#result(items, columnCount)
  }

  #calculateRow(items, actualWidth, gap, columnCount) {
    let column = 0
    let rowTop = 0
    let rowHeight = 0

    for (const item of items) {
      const span = this.#getColSpan(item, columnCount)
      const height = this.#getHeight(item)

      if (column > 0 && column + span > columnCount) {
        rowTop += rowHeight + gap
        rowHeight = 0
        column = 0
      }

      item.x = column * actualWidth + column * gap
      item.y = rowTop
      item.renderedWidth = this.#spanWidth(span, actualWidth, gap)
      item.renderedHeight = height
      rowHeight = Math.max(rowHeight, height)

      column += span
      if (column >= columnCount) {
        rowTop += rowHeight + gap
        rowHeight = 0
        column = 0
      }
    }

    return this.#result(items, columnCount)
  }

  #calculateColumn(items, actualWidth, gap, columnCount) {
    const base = Math.floor(items.length / columnCount)
    const extra = items.length % columnCount
    let column = 0
    let columnEnd = base + (extra > 0 ? 1 : 0)
    let columnHeight = 0

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      const height = this.#getHeight(item)
      if (index === columnEnd) {
        column += 1
        columnEnd += base + (column < extra ? 1 : 0)
        columnHeight = 0
      }

      item.x = column * actualWidth + column * gap
      item.y = columnHeight
      item.renderedWidth = actualWidth
      item.renderedHeight = height
      columnHeight = item.y + height + gap
    }

    return this.#result(items, columnCount)
  }

  #validateInput(items, containerWidth, columnWidth, gap, mode) {
    if (!Array.isArray(items)) {
      throw new TypeError('LayoutEngine items must be an array')
    }
    if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
      throw new RangeError('LayoutEngine containerWidth must be a positive finite number')
    }
    if (!Number.isFinite(columnWidth) || columnWidth <= 0) {
      throw new RangeError('LayoutEngine columnWidth must be a positive finite number')
    }
    if (!Number.isFinite(gap) || gap < 0) {
      throw new RangeError('LayoutEngine gap must be a finite number greater than or equal to 0')
    }
    if (!LAYOUT_MODES.has(mode)) {
      throw new TypeError(`Unknown layout mode: ${String(mode)}`)
    }
    for (const item of items) {
      if (!item || typeof item !== 'object' || !item.data) {
        throw new TypeError('LayoutEngine items must contain layout item objects')
      }
      this.#getHeight(item)
      this.#getColSpan(item, Number.MAX_SAFE_INTEGER)
    }
  }

  #getHeight(item) {
    const height = item.data.height ?? item.renderedHeight
    if (!Number.isFinite(height) || height < 0) {
      throw new RangeError('Layout item height must be a finite number greater than or equal to 0')
    }
    return height
  }

  #getColSpan(item, columnCount) {
    const span = item.data.colSpan ?? 1
    if (!Number.isInteger(span) || span < 1) {
      throw new RangeError('Layout item colSpan must be a positive integer')
    }
    return Math.min(span, columnCount)
  }

  #spanWidth(span, actualWidth, gap) {
    return span * actualWidth + (span - 1) * gap
  }

  #result(items, columnCount) {
    const containerHeight = items.reduce(
      (height, item) => Math.max(height, item.y + item.renderedHeight),
      0,
    )
    if (!Number.isFinite(containerHeight)) {
      throw new RangeError('Layout container height must remain finite')
    }
    return {
      items,
      containerHeight,
      columnCount,
    }
  }
}
