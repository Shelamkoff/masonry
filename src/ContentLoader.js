/**
 * Waits for all media content inside a DOM element to finish loading
 * before height measurement. Detects <img>, <video>, and web fonts.
 *
 * Uses Promise.allSettled so a single broken asset never blocks layout.
 * Includes a configurable timeout to prevent indefinite blocking.
 */
export class ContentLoader {
  #pending = new Set()
  #timeout

  /**
   * @param {{ timeout?: number }} [options]
   */
  constructor(options = {}) {
    /** Content-loading timeout in ms. Default: 10 000. */
    this.#timeout = options.timeout ?? 10_000
  }

  /**
   * Wait for all media inside the element to be ready.
   * @param {HTMLElement} element
   * @returns {Promise<void>}
   */
  async waitForContent(element) {
    const ac = new AbortController()
    this.#pending.add(ac)

    try {
      const promises = []

      // 1. Images
      const images = element.querySelectorAll('img')
      for (const img of images) {
        if (img.complete) continue

        promises.push(
          new Promise((resolve) => {
            const done = () => {
              img.removeEventListener('load', done)
              img.removeEventListener('error', done)
              resolve()
            }
            img.addEventListener('load', done)
            img.addEventListener('error', done)
          }),
        )
      }

      // 2. Video
      const videos = element.querySelectorAll('video')
      for (const video of videos) {
        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) continue

        promises.push(
          new Promise((resolve) => {
            const done = () => {
              video.removeEventListener('loadedmetadata', done)
              video.removeEventListener('error', done)
              resolve()
            }
            video.addEventListener('loadedmetadata', done)
            video.addEventListener('error', done)
          }),
        )
      }

      // 3. Web fonts
      if (typeof document !== 'undefined' && document.fonts && document.fonts.status !== 'loaded') {
        promises.push(document.fonts.ready.then(() => undefined))
      }

      if (promises.length === 0) return

      // Timeout timer — cleared on completion to avoid lingering handles
      let timer
      const timeoutPromise = new Promise((resolve) => {
        timer = setTimeout(resolve, this.#timeout)
      })

      // Abort-aware race: resolve all, bail on cancel, or timeout
      try {
        await Promise.race([
          Promise.allSettled(promises).then(() => undefined),
          new Promise((_, reject) => {
            ac.signal.addEventListener('abort', () =>
              reject(new DOMException('Cancelled', 'AbortError')),
            )
          }),
          timeoutPromise,
        ])
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      throw err
    } finally {
      this.#pending.delete(ac)
    }
  }

  /** Cancel all pending content-loading promises (called from destroy). */
  cancelAll() {
    for (const ac of this.#pending) {
      ac.abort()
    }
    this.#pending.clear()
  }
}
