/**
 * Trailing-edge debounce with cancel support.
 * Returns a debounced function that delays invocation until `wait` ms
 * after the last call. Attach `.cancel()` to abort any pending call.
 *
 * @param {Function} fn
 * @param {number} wait
 * @returns {Function & { cancel(): void }}
 */
export function debounce(fn, wait) {
  let timeoutId

  const debounced = (...args) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), wait)
  }

  debounced.cancel = () => {
    clearTimeout(timeoutId)
    timeoutId = undefined
  }

  return debounced
}

/**
 * Generates a short unique ID.
 * @returns {string}
 */
export function uid() {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * Clamps a number between min and max (inclusive).
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

/**
 * Counts columns for prevalidated finite dimensions without overflowing the
 * sum of the container width and gap.
 * @param {number} containerWidth
 * @param {number} columnWidth
 * @param {number} gap
 * @returns {number}
 */
export function getColumnCount(containerWidth, columnWidth, gap) {
  const containerWithGap = containerWidth + gap
  const columnWithGap = columnWidth + gap
  let count = Math.max(
    1,
    Number.isFinite(containerWithGap)
      ? Math.floor(containerWithGap / columnWithGap)
      : Math.floor((containerWidth - columnWidth) / columnWithGap) + 1,
  )
  if (!Number.isSafeInteger(count)) {
    throw new RangeError('Masonry column count must be a positive safe integer')
  }

  // At very different numeric scales the quotient can round up to a whole
  // column even when its gaps leave no room for the requested width.
  while (count > 1) {
    const availableWidth = containerWidth - (count - 1) * gap
    const requiredWidth = count * columnWidth
    if (
      availableWidth > 0
      && availableWidth >= requiredWidth - Number.EPSILON * containerWidth
    ) break
    count -= 1
  }

  // Division can round an exact fit below the next integer. Only recover that
  // column when its actual rendered width still meets the requested minimum.
  const nextCount = count + 1
  if (
    Number.isSafeInteger(nextCount)
    && (containerWidth - count * gap) / nextCount >= columnWidth
  ) count = nextCount

  return count
}

/**
 * Recognizes HTML elements across realms, including nodes adopted from an iframe.
 * Calling a native DOM method also rejects objects that only imitate node fields.
 *
 * @param {unknown} value
 * @returns {value is HTMLElement}
 */
export function isHTMLElement(value) {
  if (value?.nodeType !== 1 || value.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
    return false
  }
  const matches = globalThis.HTMLElement?.prototype.matches
    ?? value.ownerDocument?.defaultView?.Element?.prototype.matches
  if (typeof matches !== 'function') return false

  try {
    return matches.call(value, '*')
  } catch {
    return false
  }
}
