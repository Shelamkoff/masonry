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

    const columnCount = Math.max(1, Math.floor((containerWidth + gap) / (columnWidth + gap)))
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
    const columnHeights = new Array(columnCount).fill(0)

    for (const item of items) {
      const span = this.#getColSpan(item, columnCount)
      const height = this.#getHeight(item)
      let bestColumn = 0
      let bestHeight = Infinity

      for (let column = 0; column <= columnCount - span; column += 1) {
        let groupHeight = 0
        for (let offset = 0; offset < span; offset += 1) {
          groupHeight = Math.max(groupHeight, columnHeights[column + offset])
        }
        if (groupHeight < bestHeight) {
          bestColumn = column
          bestHeight = groupHeight
        }
      }

      item.x = bestColumn * (actualWidth + gap)
      item.y = bestHeight
      item.renderedWidth = this.#spanWidth(span, actualWidth, gap)
      item.renderedHeight = height

      const bottom = item.y + height + gap
      for (let offset = 0; offset < span; offset += 1) {
        columnHeights[bestColumn + offset] = bottom
      }
    }

    return this.#result(items, columnHeights, gap, columnCount)
  }

  #calculateRow(items, actualWidth, gap, columnCount) {
    const columnHeights = new Array(columnCount).fill(0)
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

      item.x = column * (actualWidth + gap)
      item.y = rowTop
      item.renderedWidth = this.#spanWidth(span, actualWidth, gap)
      item.renderedHeight = height
      rowHeight = Math.max(rowHeight, height)

      const bottom = rowTop + height + gap
      for (let offset = 0; offset < span; offset += 1) {
        columnHeights[column + offset] = bottom
      }

      column += span
      if (column >= columnCount) {
        rowTop += rowHeight + gap
        rowHeight = 0
        column = 0
      }
    }

    return this.#result(items, columnHeights, gap, columnCount)
  }

  #calculateColumn(items, actualWidth, gap, columnCount) {
    const columnHeights = new Array(columnCount).fill(0)
    const base = Math.floor(items.length / columnCount)
    const extra = items.length % columnCount
    const boundaries = new Array(columnCount + 1).fill(0)

    for (let column = 0; column < columnCount; column += 1) {
      boundaries[column + 1] = boundaries[column] + base + (column < extra ? 1 : 0)
    }

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      const height = this.#getHeight(item)
      let column = columnCount - 1
      for (let candidate = 0; candidate < columnCount; candidate += 1) {
        if (index < boundaries[candidate + 1]) {
          column = candidate
          break
        }
      }

      item.x = column * (actualWidth + gap)
      item.y = columnHeights[column]
      item.renderedWidth = actualWidth
      item.renderedHeight = height
      columnHeights[column] = item.y + height + gap
    }

    return this.#result(items, columnHeights, gap, columnCount)
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

  #result(items, columnHeights, gap, columnCount) {
    const maxHeight = columnHeights.length > 0 ? Math.max(...columnHeights) : 0
    return {
      items,
      containerHeight: items.length > 0 ? Math.max(0, maxHeight - gap) : 0,
      columnCount,
    }
  }
}
