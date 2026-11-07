import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { JSDOM } from 'jsdom'
import { ContentLoader } from '../src/ContentLoader.js'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.HTMLMediaElement = dom.window.HTMLMediaElement
globalThis.document = dom.window.document

test('waits for a root image as well as descendant media', async () => {
  const image = document.createElement('img')
  Object.defineProperty(image, 'complete', { configurable: true, value: false })
  const loader = new ContentLoader({ timeout: 500 })
  let settled = false
  const pending = loader.waitForContent(image).then(() => {
    settled = true
  })

  await Promise.resolve()
  assert.equal(settled, false)
  image.dispatchEvent(new dom.window.Event('load'))
  await pending
  assert.equal(settled, true)
})

test('cancelAll promptly settles pending waits', async () => {
  const element = document.createElement('div')
  const image = document.createElement('img')
  Object.defineProperty(image, 'complete', { configurable: true, value: false })
  element.appendChild(image)
  const loader = new ContentLoader({ timeout: 60_000 })

  const pending = loader.waitForContent(element)
  loader.cancelAll()
  await pending
})

test('timeout settles broken media and constructor input is validated', async () => {
  const image = document.createElement('img')
  Object.defineProperty(image, 'complete', { configurable: true, value: false })
  await new ContentLoader({ timeout: 0 }).waitForContent(image)

  assert.throws(() => new ContentLoader(null), TypeError)
  assert.throws(() => new ContentLoader({ timeout: -1 }), RangeError)
  assert.throws(() => new ContentLoader({ timeout: Infinity }), RangeError)
  await assert.rejects(new ContentLoader().waitForContent({}), TypeError)
})

for (const adopt of [false, true]) {
  test(`waits for ${adopt ? 'adopted' : 'foreign-realm'} media`, async t => {
    const foreignDom = new JSDOM('<!doctype html><img>')
    t.after(() => foreignDom.window.close())
    const image = foreignDom.window.document.querySelector('img')
    Object.defineProperty(image, 'complete', { value: false })
    if (adopt) document.adoptNode(image)
    const loader = new ContentLoader({ timeout: 60_000 })
    t.after(() => loader.cancelAll())
    let settled = false
    let failure
    const pending = loader.waitForContent(image).then(
      () => { settled = true },
      error => { failure = error },
    )

    await setImmediate()
    assert.equal(failure, undefined)
    assert.equal(settled, false)
    image.dispatchEvent(new foreignDom.window.Event('load'))
    await pending
    assert.equal(settled, true)
  })
}

for (const status of ['loading', 'loaded']) {
  test(`waits for owner-document font readiness while its status is ${status}`, async t => {
    const ownerDocument = document.implementation.createHTMLDocument('content')
    const element = ownerDocument.createElement('article')
    let finishFonts
    ownerDocument.fonts = {
      status,
      ready: new Promise(resolve => { finishFonts = resolve }),
    }
    const loader = new ContentLoader({ timeout: 60_000 })
    t.after(() => loader.cancelAll())
    let settled = false
    const pending = loader.waitForContent(element).then(() => {
      settled = true
    })

    await setImmediate()
    assert.equal(settled, false)
    finishFonts()
    await pending
    assert.equal(settled, true)
  })
}

test('already failed videos do not wait for another error event or the timeout', async t => {
  const video = document.createElement('video')
  Object.defineProperty(video, 'error', { value: { code: 4 } })
  const loader = new ContentLoader({ timeout: 60_000 })
  t.after(() => loader.cancelAll())
  let settled = false
  const pending = loader.waitForContent(video).then(() => {
    settled = true
  })

  await setImmediate()
  assert.equal(settled, true)
  await pending
})

function trackListeners(target, t) {
  const listeners = new Map()
  const addEventListener = target.addEventListener.bind(target)
  const removeEventListener = target.removeEventListener.bind(target)
  t.mock.method(target, 'addEventListener', (name, listener, options) => {
    if (!listeners.has(name)) listeners.set(name, new Set())
    listeners.get(name).add(listener)
    addEventListener(name, listener, options)
  })
  t.mock.method(target, 'removeEventListener', (name, listener, options) => {
    listeners.get(name)?.delete(listener)
    removeEventListener(name, listener, options)
  })
  return () => Array.from(listeners.values()).reduce((count, entries) => count + entries.size, 0)
}

test('waits for all descendant media and releases listeners on both success and error', async t => {
  const element = document.createElement('article')
  const images = [document.createElement('img'), document.createElement('img')]
  for (const image of images) Object.defineProperty(image, 'complete', { value: false })
  const video = document.createElement('video')
  element.append(...images, video)
  const listenerCounts = [...images, video].map(media => trackListeners(media, t))
  const loader = new ContentLoader({ timeout: 60_000 })
  t.after(() => loader.cancelAll())
  let settled = false
  const pending = loader.waitForContent(element).then(() => { settled = true })

  images[0].dispatchEvent(new dom.window.Event('load'))
  images[1].dispatchEvent(new dom.window.Event('error'))
  await setImmediate()
  assert.equal(settled, false)
  video.dispatchEvent(new dom.window.Event('loadedmetadata'))
  await pending

  assert.equal(settled, true)
  assert.deepEqual(listenerCounts.map(count => count()), [0, 0, 0])
})

for (const cancel of [false, true]) {
  test(`${cancel ? 'cancellation' : 'timeout'} releases every pending media listener`, async t => {
    const element = document.createElement('article')
    const image = document.createElement('img')
    Object.defineProperty(image, 'complete', { value: false })
    const video = document.createElement('video')
    element.append(image, video)
    const listenerCounts = [image, video].map(media => trackListeners(media, t))
    const loader = new ContentLoader({ timeout: cancel ? 60_000 : 0 })
    t.after(() => loader.cancelAll())

    const pending = loader.waitForContent(element)
    assert.deepEqual(listenerCounts.map(count => count()), [2, 2])
    if (cancel) loader.cancelAll()
    await pending

    assert.deepEqual(listenerCounts.map(count => count()), [0, 0])
  })
}

test('cancelAll settles concurrent font-only waits and the loader remains reusable', async t => {
  const ownerDocument = document.implementation.createHTMLDocument('content')
  ownerDocument.fonts = { status: 'loading', ready: new Promise(() => {}) }
  const loader = new ContentLoader({ timeout: 60_000 })
  t.after(() => loader.cancelAll())
  const pending = [
    loader.waitForContent(ownerDocument.createElement('article')),
    loader.waitForContent(ownerDocument.createElement('article')),
  ]

  loader.cancelAll()
  await Promise.all(pending)

  const image = document.createElement('img')
  Object.defineProperty(image, 'complete', { value: false })
  let settled = false
  const next = loader.waitForContent(image).then(() => { settled = true })
  await setImmediate()
  assert.equal(settled, false)
  image.dispatchEvent(new dom.window.Event('load'))
  await next
  assert.equal(settled, true)
})

test('HTML element validation rejects SVG nodes and forged DOM-shaped objects', async () => {
  const loader = new ContentLoader()
  await assert.rejects(loader.waitForContent(document.createElementNS('http://www.w3.org/2000/svg', 'svg')), TypeError)
  await assert.rejects(loader.waitForContent({
    nodeType: 1,
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: { defaultView: { Element: { prototype: { matches: () => true } } } },
  }), TypeError)
})
