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
  constructor(callback) {
    this.callback = callback
    this.disconnected = false
  }
  observe(element) {
    this.element = element
  }
  disconnect() {
    this.disconnected = true
  }
}

class FakeIntersectionObserver {
  constructor(callback) {
    this.callback = callback
  }
  observe() {}
  unobserve() {}
  disconnect() {}
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
