/**
 * Stateless layout calculator with three modes and colSpan support.
 *
 * - **masonry** (default): shortest-column-first greedy placement.
 * - **row**: left-to-right, row by row. Each row starts after the tallest item in the previous row.
 * - **column**: top-to-bottom, column by column. Items fill column 0, then column 1, etc.
 *
 * Items may span multiple columns via `data.colSpan` (default 1).
 * All positioning uses pixel values suitable for translate3d().
 */
export class LayoutEngine {
  /**
   * Compute positions for every item.
   *
   * @param {import('./types').LayoutItem[]} items
   * @param {number} containerWidth
   * @param {number} columnWidth
   * @param {number} gap
   * @param {import('./types').LayoutMode} [mode='masonry']
   * @returns {import('./types').LayoutResult}
   */
  calculate(items, containerWidth, columnWidth, gap, mode = 'masonry') {
    const columnCount = Math.max(1, Math.floor((containerWidth + gap) / (columnWidth + gap)))
    const actualWidth = (containerWidth - (columnCount - 1) * gap) / columnCount

    switch (mode) {
      case 'row':
        return this.#calculateRow(items, actualWidth, gap, columnCount)
      case 'column':
        return this.#calculateColumn(items, actualWidth, gap, columnCount)
      default:
        return this.#calculateMasonry(items, actualWidth, gap, columnCount)
    }
  }

  /**
   * Get effective colSpan for an item, clamped to [1, columnCount].
   * @param {import('./types').LayoutItem} item
   * @param {number} columnCount
   * @returns {number}
   */
  #getColSpan(item, columnCount) {
    const span = item.data.colSpan ?? 1
    return Math.max(1, Math.min(span, columnCount))
  }

  /**
   * Calculate item width for a given colSpan.
   * @param {number} colSpan
   * @param {number} actualWidth  single-column width
   * @param {number} gap
   * @returns {number}
   */
  #spanWidth(colSpan, actualWidth, gap) {
    return colSpan * actualWidth + (colSpan - 1) * gap
  }

  /**
   * Masonry: each item goes into the shortest column group.
   * For multi-span items, finds the consecutive columns with the lowest max height.
   */
  #calculateMasonry(items, actualWidth, gap, columnCount) {
    const columnHeights = new Array(columnCount).fill(0)

    for (const item of items) {
      const span = this.#getColSpan(item, columnCount)

      // Find the best starting column for this span
      let bestCol = 0
      let bestHeight = Infinity

      for (let c = 0; c <= columnCount - span; c++) {
        // Max height across the span
        let maxH = 0
        for (let s = 0; s < span; s++) {
          if (columnHeights[c + s] > maxH) maxH = columnHeights[c + s]
        }
        if (maxH < bestHeight) {
          bestHeight = maxH
          bestCol = c
        }
      }

      item.x = bestCol * (actualWidth + gap)
      item.y = bestHeight
      item.renderedWidth = this.#spanWidth(span, actualWidth, gap)

      const height = item.data.height ?? item.renderedHeight
      item.renderedHeight = height

      // Update all spanned columns
      const bottom = item.y + height + gap
      for (let s = 0; s < span; s++) {
        columnHeights[bestCol + s] = bottom
      }
    }

    return this.#result(items, columnHeights, gap, columnCount)
  }

  /**
   * Row: round-robin left-to-right placement with independent column stacking.
   * Items are assigned to columns in order (col 0, 1, 2, … 0, 1, 2, …),
   * preserving insertion order while each column stacks independently —
   * no uniform row height, no vertical gaps.
   */
  #calculateRow(items, actualWidth, gap, columnCount) {
    const columnHeights = new Array(columnCount).fill(0)
    let colIndex = 0

    for (const item of items) {
      const span = this.#getColSpan(item, columnCount)

      // Wrap to next "row" if multi-span item doesn't fit
      if (colIndex + span > columnCount) {
        colIndex = 0
      }

      // Max height across the spanned columns
      let maxH = 0
      for (let s = 0; s < span; s++) {
        if (columnHeights[colIndex + s] > maxH) maxH = columnHeights[colIndex + s]
      }

      item.x = colIndex * (actualWidth + gap)
      item.y = maxH
      item.renderedWidth = this.#spanWidth(span, actualWidth, gap)

      const height = item.data.height ?? item.renderedHeight
      item.renderedHeight = height

      const bottom = item.y + height + gap
      for (let s = 0; s < span; s++) {
        columnHeights[colIndex + s] = bottom
      }

      colIndex += span
      if (colIndex >= columnCount) colIndex = 0
    }

    return this.#result(items, columnHeights, gap, columnCount)
  }

  /**
   * Column: top-to-bottom, column by column.
   * Items are distributed evenly across columns in insertion order.
   * colSpan is forced to 1 — multi-span would cascade heights across columns.
   */
  #calculateColumn(items, actualWidth, gap, columnCount) {
    const columnHeights = new Array(columnCount).fill(0)

    // Build column-assignment boundaries for even distribution.
    // E.g. 7 items / 3 cols → [3, 2, 2] instead of [3, 3, 1].
    const base = Math.floor(items.length / columnCount)
    const extra = items.length % columnCount
    const colStart = new Array(columnCount + 1)
    colStart[0] = 0
    for (let c = 0; c < columnCount; c++) {
      colStart[c + 1] = colStart[c] + base + (c < extra ? 1 : 0)
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i]

      // Find column for index i via boundaries
      let col = columnCount - 1
      for (let c = 0; c < columnCount; c++) {
        if (i < colStart[c + 1]) { col = c; break }
      }

      // Column mode forces colSpan=1 for all items.
      // Multi-span items in column mode cause cascading height accumulation:
      // a span bleeds into the next column and pushes ALL of that column's
      // items down, creating large vertical gaps.
      item.x = col * (actualWidth + gap)
      item.y = columnHeights[col]
      item.renderedWidth = actualWidth

      const height = item.data.height ?? item.renderedHeight
      item.renderedHeight = height

      columnHeights[col] = item.y + height + gap
    }

    return this.#result(items, columnHeights, gap, columnCount)
  }

  /**
   * @param {import('./types').LayoutItem[]} items
   * @param {number[]} columnHeights
   * @param {number} gap
   * @param {number} columnCount
   * @returns {import('./types').LayoutResult}
   */
  #result(items, columnHeights, gap, columnCount) {
    const maxHeight = columnHeights.length > 0
      ? Math.max(...columnHeights)
      : 0

    const containerHeight = items.length > 0
      ? Math.max(0, maxHeight - gap)
      : 0

    return { items, containerHeight, columnCount }
  }
}
