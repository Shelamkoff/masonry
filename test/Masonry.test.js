import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { Masonry } from '../src/Masonry.js'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.Element = dom.window.Element
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.MouseEvent = dom.window.MouseEvent

class FakeResizeObserver {
  static instances = []
  constructor(callback) {
    this.callback = callback
    this.disconnected = false
    FakeResizeObserver.instances.push(this)
  }
  observe(element) {
    this.element = element
  }
  disconnect() {
    this.disconnected = true
  }
  unobserve() {}
}

class FakeIntersectionObserver {
  static instances = []

  constructor(callback) {
    this.callback = callback
    FakeIntersectionObserver.instances.push(this)
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  intersect(value = true) {
    this.callback([{ isIntersecting: value }])
  }
}

globalThis.ResizeObserver = FakeResizeObserver
globalThis.IntersectionObserver = FakeIntersectionObserver
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = id => clearTimeout(id)

function createContainer(initialWidth = 620) {
  let width = initialWidth
  const container = document.createElement('section')
  container.getBoundingClientRect = () => ({ width })
  document.body.appendChild(container)
  return {
    container,
    setWidth(value) {
      width = value
    },
  }
}

function card(label) {
  const element = document.createElement('article')
  element.textContent = label
  return element
}

const flush = () => new Promise(resolve => setImmediate(resolve))

test('appends, lays out, emits clicks, and returns defensive data objects', async () => {
  const { container } = createContainer()
  const masonry = new Masonry(container, {
    columnWidth: 200,
    gap: 10,
    transitionDuration: 0,
    fadeInDuration: 0,
  })
  const first = card('first')
  const wide = card('wide')

  await masonry.append([
    { id: 'first', element: first, height: 100, colSpan: 1 },
    { id: 'wide', element: wide, height: 80, colSpan: 2 },
  ])

  const wrappers = container.querySelectorAll(':scope > .masonry-item')
  assert.equal(wrappers.length, 2)
  assert.equal(wrappers[0].style.transform, 'translate3d(0px, 0px, 0)')
  assert.equal(wrappers[1].style.transform, 'translate3d(210px, 0px, 0)')
  assert.equal(wrappers[1].style.width, '410px')
  assert.equal(container.style.height, '100px')
  assert.equal(masonry.getColumnCount(), 3)

  const snapshot = masonry.getItems()
  snapshot[0].id = 'changed-outside'
  assert.equal(masonry.getItems()[0].id, 'first')

  let clicked
  masonry.on('item:click', payload => {
    clicked = payload
  })
  first.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  assert.equal(clicked.item.id, 'first')
  assert.equal(clicked.index, 0)

  assert.throws(
    () => masonry.append([{ id: 'first', element: card('duplicate'), height: 10 }]),
    /already in use/,
  )
  masonry.destroy()
})

test('a rejected append does not poison later queued operations', async () => {
  const { container, setWidth } = createContainer(0)
  const masonry = new Masonry(container, { columnWidth: 200 })
  const failed = card('failed')

  await assert.rejects(
    masonry.append([{ id: 'failed', element: failed, height: 20 }]),
    /measurable width/,
  )
  assert.equal(failed.parentNode, null)

  setWidth(620)
  await masonry.append([{ id: 'valid', element: card('valid'), height: 30 }])
  assert.equal(masonry.getItems().length, 1)
  masonry.destroy()
})

test('destroy is idempotent, unwraps items, and restores container state', async () => {
  const { container } = createContainer()
  container.style.position = 'absolute'
  container.style.height = '24px'
  const masonry = new Masonry(container, { columnWidth: 200 })
  const element = card('preserve me')
  await masonry.append([{ id: 'preserve', element, height: 40 }])

  masonry.destroy()
  masonry.destroy()

  assert.equal(element.parentNode, container)
  assert.equal(container.querySelectorAll('.masonry-item').length, 0)
  assert.equal(container.style.position, 'absolute')
  assert.equal(container.style.height, '24px')
  assert.equal(container.classList.contains('masonry-container'), false)
  assert.throws(() => masonry.layout(), /destroyed/)
})

test('remove reindexes remaining items and validates ids', async () => {
  const { container } = createContainer()
  const masonry = new Masonry(container, { columnWidth: 200 })
  await masonry.append([
    { id: 'one', element: card('one'), height: 20 },
    { id: 'two', element: card('two'), height: 30 },
  ])

  masonry.remove('one')
  assert.deepEqual(masonry.getItems().map(item => item.id), ['two'])
  assert.equal(container.querySelector('.masonry-item').dataset.masonryIndex, '0')
  assert.throws(() => masonry.remove(' '), TypeError)
  masonry.destroy()
})

test('validates containers, options, and item descriptors', () => {
  const { container } = createContainer()
  assert.throws(() => new Masonry({}, { columnWidth: 200 }), TypeError)
  assert.throws(() => new Masonry('.missing', { columnWidth: 200 }), /not found/)
  assert.throws(() => new Masonry(container), TypeError)
  assert.throws(() => new Masonry(container, { columnWidth: 0 }), RangeError)
  assert.throws(
    () => new Masonry(container, { columnWidth: 200, layoutMode: 'diagonal' }),
    TypeError,
  )

  const masonry = new Masonry(container, { columnWidth: 200 })
  assert.throws(() => masonry.append({}), TypeError)
  assert.throws(() => masonry.append([{ id: '', element: card('x') }]), TypeError)
  assert.throws(
    () => masonry.append([{ id: 'x', element: card('x'), colSpan: 0 }]),
    RangeError,
  )
  masonry.destroy()
})

test('stops infinite loading when loadMore returns false', async () => {
  FakeIntersectionObserver.instances = []
  const { container } = createContainer()
  let calls = 0
  const masonry = new Masonry(container, {
    columnWidth: 200,
    loadMore() {
      calls += 1
      return false
    },
  })
  const observer = FakeIntersectionObserver.instances.at(-1)

  observer.intersect()
  await flush()
  await flush()
  observer.intersect()
  await flush()
  await flush()

  assert.equal(calls, 1)
  masonry.destroy()
})

test('rejects the container and its ancestors without moving existing DOM', () => {
  const { container } = createContainer()
  const masonry = new Masonry(container, { columnWidth: 200 })
  const parent = container.parentNode
  for (const element of [container, parent]) {
    assert.throws(
      () => masonry.append([{ id: 'invalid', element, height: 20, colSpan: 1 }]),
      /container|ancestor/,
    )
    assert.equal(container.parentNode, parent)
  }
  assert.equal(container.children.length, 0)
  masonry.destroy()
})

test('rejects nested item elements in one batch without changing their structure', () => {
  const { container } = createContainer()
  const masonry = new Masonry(container, { columnWidth: 200 })
  const outer = card('outer')
  const inner = card('inner')
  outer.appendChild(inner)
  assert.throws(() => masonry.append([
    { id: 'outer', element: outer },
    { id: 'inner', element: inner },
  ]), /nested|overlap/)
  assert.equal(inner.parentNode, outer)
  assert.equal(outer.parentNode, null)
  masonry.destroy()
})

test('invalid sparse batches do not reserve otherwise valid item IDs', async () => {
  const { container } = createContainer()
  const masonry = new Masonry(container, { columnWidth: 200 })
  const item = { id: 'reusable', element: card('reusable'), height: 20, colSpan: 1 }
  const sparse = [item]
  sparse.length = 2
  assert.throws(() => masonry.append(sparse), TypeError)
  await masonry.append([item])
  assert.equal(masonry.getItems()[0].id, 'reusable')
  masonry.destroy()
})

test('destroy from layout:complete leaves no new animation frames behind', async () => {
  const { container } = createContainer()
  const masonry = new Masonry(container, { columnWidth: 200 })
  const element = card('keep')
  const originalRequest = globalThis.requestAnimationFrame
  let scheduled = 0
  globalThis.requestAnimationFrame = callback => {
    scheduled += 1
    return originalRequest(callback)
  }
  try {
    masonry.once('layout:complete', () => masonry.destroy())
    await masonry.append([{ id: 'keep', element, height: 20, colSpan: 1 }])
    assert.equal(scheduled, 0)
    assert.equal(element.parentNode, container)
  } finally {
    globalThis.requestAnimationFrame = originalRequest
    masonry.destroy()
  }
})

test('destroy from scroll:loadmore prevents the user loader from starting', async () => {
  const { container } = createContainer()
  let loads = 0
  const masonry = new Masonry(container, {
    columnWidth: 200,
    loadMore() { loads += 1 },
  })
  masonry.on('scroll:loadmore', () => masonry.destroy())
  FakeIntersectionObserver.instances.at(-1).intersect()
  await flush()
  assert.equal(loads, 0)
})

test('restores inline style priorities after destroy', () => {
  const { container } = createContainer()
  container.style.setProperty('height', '24px', 'important')
  container.style.setProperty('position', 'absolute', 'important')
  const masonry = new Masonry(container, { columnWidth: 200 })
  masonry.destroy()
  assert.equal(container.style.getPropertyPriority('height'), 'important')
  assert.equal(container.style.getPropertyPriority('position'), 'important')
})

test('does not commit a pending item that the caller has moved out of its wrapper', async () => {
  const { container } = createContainer()
  const masonry = new Masonry(container, { columnWidth: 200, contentLoadTimeout: 50 })
  const image = document.createElement('img')
  Object.defineProperty(image, 'complete', { value: false })
  const destination = document.createElement('aside')
  document.body.appendChild(destination)
  const operation = masonry.append([{ id: 'moving', element: image }])
  await flush()
  destination.appendChild(image)
  image.dispatchEvent(new dom.window.Event('load'))
  await assert.rejects(operation, /moved|wrapper/)
  assert.equal(image.parentNode, destination)
  assert.equal(container.children.length, 0)
  assert.equal(masonry.getItems().length, 0)
  masonry.destroy()
})

test('waits for the media in a batch concurrently while keeping append order', async () => {
  const { container } = createContainer()
  const masonry = new Masonry(container, { columnWidth: 200, contentLoadTimeout: 1000 })
  const first = document.createElement('img')
  const second = document.createElement('img')
  Object.defineProperty(first, 'complete', { value: false })
  Object.defineProperty(second, 'complete', { value: false })
  const batch = masonry.append([
    { id: 'first', element: first },
    { id: 'second', element: second },
  ])
  const next = masonry.append([{ id: 'next', element: card('next'), height: 10, colSpan: 1 }])
  const settled = Promise.allSettled([batch, next])
  try {
    await flush()
    assert.equal(container.contains(first), true)
    assert.equal(container.contains(second), true)
    second.dispatchEvent(new dom.window.Event('load'))
    first.dispatchEvent(new dom.window.Event('load'))
    await batch
    await next
    assert.deepEqual(masonry.getItems().map(item => item.id), ['first', 'second', 'next'])
  } finally {
    masonry.destroy()
    await settled
  }
})

test('does not wait for media when fixed geometry makes it unnecessary', async () => {
  const { container } = createContainer()
  const masonry = new Masonry(container, {
    columnWidth: 200, autoColSpan: false, contentLoadTimeout: 1000,
  })
  const image = document.createElement('img')
  Object.defineProperty(image, 'complete', { value: false })
  let done = false
  const operation = masonry.append([{ id: 'fixed', element: image, height: 30 }])
    .then(() => { done = true })
  const settled = Promise.allSettled([operation])
  try {
    await flush()
    assert.equal(done, true)
    assert.equal(container.style.height, '30px')
  } finally {
    masonry.destroy()
    await settled
  }
})

test('append accepts adopted elements created in another document', async () => {
  const { container } = createContainer()
  const foreign = new JSDOM('<!doctype html><article>foreign card</article>')
  const element = foreign.window.document.querySelector('article')
  const masonry = new Masonry(container, { columnWidth: 200 })
  try {
    await masonry.append([{ id: 'foreign', element, height: 30 }])
    assert.equal(element.ownerDocument, document)
    assert.equal(masonry.getItems()[0].element, element)
  } finally {
    masonry.destroy()
    foreign.window.close()
  }
})

test('constructor rolls back container state when observer setup fails', () => {
  const { container } = createContainer()
  container.style.position = 'absolute'
  container.style.height = '24px'
  const OriginalObserver = globalThis.ResizeObserver
  let disconnected = false
  globalThis.ResizeObserver = class {
    observe() { throw new Error('observe failed') }
    disconnect() { disconnected = true }
  }
  try {
    assert.throws(() => new Masonry(container, { columnWidth: 200 }), /observe failed/)
    assert.equal(disconnected, true)
    assert.equal(container.classList.contains('masonry-container'), false)
    assert.equal(container.style.position, 'absolute')
    assert.equal(container.style.height, '24px')
  } finally {
    globalThis.ResizeObserver = OriginalObserver
  }
})

test('destroy preserves a committed element moved to a new owner', async () => {
  const { container } = createContainer()
  const masonry = new Masonry(container, { columnWidth: 200 })
  const element = card('moved')
  await masonry.append([{ id: 'moved', element, height: 20, colSpan: 1 }])
  const destination = document.createElement('aside')
  document.body.appendChild(destination)
  destination.appendChild(element)
  masonry.destroy()
  assert.equal(element.parentNode, destination)
  assert.equal(container.children.length, 0)
})

test('auto-detected column spans grow again when the container becomes wider', async () => {
  const { container, setWidth } = createContainer(200)
  const masonry = new Masonry(container, { columnWidth: 200, gap: 10 })
  const image = document.createElement('img')
  Object.defineProperty(image, 'naturalWidth', { value: 800 })
  await masonry.append([{ id: 'image', element: image, height: 40 }])
  assert.equal(masonry.getItems()[0].colSpan, 1)
  setWidth(830)
  masonry.layout()
  assert.equal(masonry.getItems()[0].colSpan, 4)
  assert.equal(image.parentElement.style.width, '830px')
  masonry.destroy()
})

test('content changes after append update following positions without a container resize', async () => {
  const { container } = createContainer(200)
  const masonry = new Masonry(container, { columnWidth: 200, gap: 10 })
  let height = 20
  const first = card('dynamic content')
  const second = card('following card')
  await masonry.append([
    { id: 'first', element: first, colSpan: 1 },
    { id: 'second', element: second, height: 20, colSpan: 1 },
  ])
  Object.defineProperty(first.parentElement, 'offsetHeight', { get: () => height })
  masonry.layout()
  assert.equal(second.parentElement.style.transform, 'translate3d(0px, 30px, 0)')
  height = 70
  FakeResizeObserver.instances.at(-1).callback([
    { target: first.parentElement, contentRect: { width: 200, height } },
  ])
  await new Promise(resolve => setTimeout(resolve, 130))
  assert.equal(second.parentElement.style.transform, 'translate3d(0px, 80px, 0)')
  assert.equal(container.style.height, '100px')
  masonry.destroy()
})

test('clicks on elements adopted from another document reach item:click', async () => {
  const { container } = createContainer()
  const foreign = new JSDOM('<!doctype html><article>foreign click</article>')
  const element = foreign.window.document.querySelector('article')
  const masonry = new Masonry(container, { columnWidth: 200 })
  try {
    await masonry.append([{ id: 'foreign', element, height: 30, colSpan: 1 }])
    let clicked
    masonry.on('item:click', event => { clicked = event.item.id })
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    assert.equal(clicked, 'foreign')
  } finally {
    masonry.destroy()
    foreign.window.close()
  }
})

test('remove normalizes IDs in the same way as append', async () => {
  const { container } = createContainer()
  const masonry = new Masonry(container, { columnWidth: 200 })
  await masonry.append([{ id: ' padded ', element: card('padded'), height: 20, colSpan: 1 }])
  masonry.remove(' padded ')
  assert.equal(masonry.getItems().length, 0)
  assert.equal(container.children.length, 0)
  masonry.destroy()
})

test('a stale rearm frame cannot resume loading after a newer callback returned false', async () => {
  const { container } = createContainer()
  const request = globalThis.requestAnimationFrame
  const cancel = globalThis.cancelAnimationFrame
  const frames = new Map()
  let nextFrame = 0
  globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame }
  globalThis.cancelAnimationFrame = id => frames.delete(id)
  let loads = 0
  const masonry = new Masonry(container, {
    columnWidth: 200,
    async loadMore() {
      loads += 1
      if (loads === 1) {
        await masonry.append([{ id: 'first', element: card('first'), height: 20, colSpan: 1 }])
        return true
      }
      return false
    },
  })
  try {
    const observer = FakeIntersectionObserver.instances.at(-1)
    observer.intersect()
    await flush()
    assert.equal(loads, 1)
    observer.intersect()
    await flush()
    assert.equal(loads, 2)
    for (const callback of frames.values()) callback()
    observer.intersect()
    await flush()
    assert.equal(loads, 2)
  } finally {
    masonry.destroy()
    globalThis.requestAnimationFrame = request
    globalThis.cancelAnimationFrame = cancel
  }
})

test('late image loading updates automatic spans even when its displayed height is fixed', async () => {
  const { container } = createContainer()
  const masonry = new Masonry(container, { columnWidth: 200, gap: 10, contentLoadTimeout: 0 })
  const image = document.createElement('img')
  let naturalWidth = 0
  Object.defineProperty(image, 'complete', { value: false })
  Object.defineProperty(image, 'naturalWidth', { get: () => naturalWidth })
  image.style.cssText = 'display:block;width:100%;height:100px'
  await masonry.append([{ id: 'late', element: image, height: 100 }])
  assert.equal(masonry.getItems()[0].colSpan, 1)
  naturalWidth = 600
  image.dispatchEvent(new dom.window.Event('load'))
  await new Promise(resolve => setTimeout(resolve, 130))
  assert.equal(masonry.getItems()[0].colSpan, 3)
  assert.equal(image.parentElement.style.width, '620px')
  masonry.destroy()
})
