import { isHTMLElement } from './utils.js'

/**
 * Waits until images, video metadata, and web fonts are ready for measurement.
 */
export class ContentLoader {
  #pending = new Set()
  #timeout

  /**
   * @param {{ timeout?: number }} [options]
   */
  constructor(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('ContentLoader options must be an object')
    }
    const timeout = options.timeout ?? 10_000
    if (!Number.isFinite(timeout) || timeout < 0) {
      throw new RangeError('ContentLoader timeout must be a finite number greater than or equal to 0')
    }
    this.#timeout = timeout
  }

  /**
   * @param {HTMLElement} element
   * @returns {Promise<void>}
   */
  async waitForContent(element) {
    if (!isHTMLElement(element)) {
      throw new TypeError('ContentLoader element must be an HTMLElement')
    }

    const controller = new AbortController()
    const { signal } = controller
    this.#pending.add(controller)

    try {
      const pendingMedia = []
      const images = this.#collect(element, 'img')
      for (const image of images) {
        if (!image.complete) {
          pendingMedia.push(this.#waitForEvents(image, ['load', 'error'], signal))
        }
      }

      const videos = this.#collect(element, 'video')
      for (const video of videos) {
        if (video.readyState < video.HAVE_METADATA && !video.error) {
          pendingMedia.push(this.#waitForEvents(video, ['loadedmetadata', 'error'], signal))
        }
      }

      const fonts = element.ownerDocument.fonts
      if (fonts) {
        pendingMedia.push(Promise.resolve(fonts.ready).then(() => undefined))
      }

      if (pendingMedia.length === 0) return

      let timer
      const timeout = new Promise(resolve => {
        timer = setTimeout(resolve, this.#timeout)
      })
      const aborted = new Promise(resolve => {
        signal.addEventListener('abort', resolve, { once: true })
      })

      try {
        await Promise.race([
          Promise.allSettled(pendingMedia),
          aborted,
          timeout,
        ])
      } finally {
        clearTimeout(timer)
      }
    } finally {
      controller.abort()
      this.#pending.delete(controller)
    }
  }

  cancelAll() {
    for (const controller of this.#pending) {
      controller.abort()
    }
    this.#pending.clear()
  }

  #collect(element, selector) {
    const descendants = Array.from(element.querySelectorAll(selector))
    return element.matches(selector) ? [element, ...descendants] : descendants
  }

  #waitForEvents(target, eventNames, signal) {
    return new Promise(resolve => {
      const done = () => {
        for (const eventName of eventNames) {
          target.removeEventListener(eventName, done)
        }
        signal.removeEventListener('abort', done)
        resolve()
      }

      for (const eventName of eventNames) {
        target.addEventListener(eventName, done, { once: true })
      }
      signal.addEventListener('abort', done, { once: true })
    })
  }
}
