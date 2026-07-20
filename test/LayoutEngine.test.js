import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LayoutEngine } from '../src/LayoutEngine.js'

function item(id, height, colSpan = 1) {
  return {
    data: { id, height, colSpan },
    wrapper: {},
    x: 0,
    y: 0,
    renderedWidth: 0,
    renderedHeight: height,
  }
}

test('masonry mode places items in the shortest available column group', () => {
  const items = [
    item('a', 100),
    item('b', 50),
    item('c', 80),
    item('wide', 40, 2),
  ]
  const result = new LayoutEngine().calculate(items, 620, 200, 10)

  assert.equal(result.columnCount, 3)
  assert.deepEqual(
    result.items.map(({ x, y, renderedWidth }) => [x, y, renderedWidth]),
    [
      [0, 0, 200],
      [210, 0, 200],
      [420, 0, 200],
      [210, 90, 410],
    ],
  )
  assert.equal(result.containerHeight, 130)
})

test('row mode starts every row below the tallest item in the prior row', () => {
  const items = [
    item('a', 100),
    item('b', 50),
    item('c', 80),
    item('wide', 40, 2),
  ]
  const result = new LayoutEngine().calculate(items, 620, 200, 10, 'row')

  assert.deepEqual(
    result.items.map(({ x, y }) => [x, y]),
    [[0, 0], [210, 0], [420, 0], [0, 110]],
  )
  assert.equal(result.containerHeight, 150)
})

test('column mode distributes item counts evenly between columns', () => {
  const items = [
    item('a', 20),
    item('b', 30),
    item('c', 40),
    item('d', 50),
    item('e', 60),
  ]
  const result = new LayoutEngine().calculate(items, 410, 200, 10, 'column')

  assert.deepEqual(
    result.items.map(({ x, y }) => [x, y]),
    [[0, 0], [0, 30], [0, 70], [210, 0], [210, 60]],
  )
  assert.equal(result.containerHeight, 120)
})

test('empty layouts remain valid', () => {
  const result = new LayoutEngine().calculate([], 500, 220, 16)
  assert.equal(result.containerHeight, 0)
  assert.equal(result.columnCount, 2)
})

test('rejects invalid dimensions, modes, heights, and spans', () => {
  const engine = new LayoutEngine()
  assert.throws(() => engine.calculate({}, 500, 200, 10), TypeError)
  assert.throws(() => engine.calculate([], 0, 200, 10), RangeError)
  assert.throws(() => engine.calculate([], 500, Infinity, 10), RangeError)
  assert.throws(() => engine.calculate([], 500, 200, -1), RangeError)
  assert.throws(() => engine.calculate([], 500, 200, 10, 'diagonal'), TypeError)
  assert.throws(
    () => engine.calculate([item('a', Number.NaN)], 500, 200, 10),
    RangeError,
  )
  assert.throws(
    () => engine.calculate([item('a', 20, 0)], 500, 200, 10),
    RangeError,
  )
})
