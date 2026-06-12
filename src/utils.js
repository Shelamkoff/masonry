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
