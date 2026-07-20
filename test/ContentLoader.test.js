import assert from 'node:assert/strict'
import { test } from 'node:test'
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
