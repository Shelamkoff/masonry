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

for (const { heights, span, column, top } of [
  { heights: [30, 20, 10, 20, 30], span: 2, column: 1, top: 20 },
  { heights: [10, 20, 10, 20, 10], span: 2, column: 0, top: 20 },
  { heights: [5, 15, 25, 35, 45], span: 3, column: 0, top: 25 },
  { heights: [45, 35, 25, 15, 5], span: 3, column: 2, top: 25 },
  { heights: [10, 30, 20, 40, 15], span: 99, column: 0, top: 40 },
  { heights: [40, 20, 30, 10, 5], span: 1, column: 4, top: 5 },
]) {
  test(`masonry chooses the first lowest group for heights ${heights} and span ${span}`, () => {
    const items = heights.map((height, index) => item(String(index), height))
    items.push(item('probe', 7, span))

    const result = new LayoutEngine().calculate(items, heights.length * 100, 100, 0)
    const probe = result.items.at(-1)

    assert.equal(probe.x, column * 100)
    assert.equal(probe.y, top)
    assert.equal(probe.renderedWidth, Math.min(span, heights.length) * 100)
  })
}

test('masonry recalculates window maxima when consecutive items change their spans', () => {
  const items = [30, 20, 10, 20, 30].map((height, index) => item(String(index), height))
  items.push(item('pair', 5, 2), item('triple', 7, 3), item('quad', 9, 4))

  const result = new LayoutEngine().calculate(items, 500, 100, 0)

  assert.deepEqual(result.items.slice(5).map(({ x, y }) => [x, y]), [
    [100, 20], [100, 25], [0, 32],
  ])
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

for (const mode of ['masonry', 'row', 'column']) {
  test(`${mode} mode supports many narrow columns without exceeding argument limits`, () => {
    const result = new LayoutEngine().calculate([item('a', 20)], 1500, 0.01, 0, mode)

    assert.equal(result.columnCount, 150_000)
    assert.equal(result.containerHeight, 20)
    assert.equal(result.items[0].renderedWidth, 0.01)
  })

  test(`${mode} mode excludes the trailing gap without losing the final item height`, () => {
    const result = new LayoutEngine().calculate([item('a', 20)], 500, 200, 1e20, mode)

    assert.equal(result.columnCount, 1)
    assert.equal(result.containerHeight, 20)
  })

  test(`${mode} mode does not allocate unused columns for a sparse layout`, () => {
    const result = new LayoutEngine().calculate([item('a', 20)], 1000, 1e-7, 0, mode)

    assert.equal(result.columnCount, 10_000_000_000)
    assert.equal(result.containerHeight, 20)
    assert.equal(result.items[0].x, 0)
    assert.equal(result.items[0].renderedWidth, 1e-7)
  })

  test(`${mode} mode handles finite dimensions whose sum would overflow`, () => {
    const result = new LayoutEngine().calculate(
      [item('a', 20)],
      Number.MAX_VALUE,
      Number.MAX_VALUE / 2,
      Number.MAX_VALUE,
      mode,
    )

    assert.equal(result.columnCount, 1)
    assert.equal(result.containerHeight, 20)
    assert.equal(result.items[0].x, 0)
    assert.equal(result.items[0].renderedWidth, Number.MAX_VALUE)
  })

  test(`${mode} mode keeps positive column widths when the gap dominates the calculation`, () => {
    const result = new LayoutEngine().calculate([item('a', 20)], 1e308, 100, 1e308, mode)

    assert.equal(result.columnCount, 1)
    assert.equal(result.items[0].renderedWidth, 1e308)
  })

  test(`${mode} mode rejects an unrepresentable derived height`, () => {
    assert.throws(
      () => new LayoutEngine().calculate(
        [item('a', Number.MAX_VALUE), item('b', Number.MAX_VALUE)],
        200,
        200,
        0,
        mode,
      ),
      { name: 'RangeError', message: /height.*finite/i },
    )
  })
}

test('rejects an unrepresentable column count before allocating the skyline', () => {
  assert.throws(
    () => new LayoutEngine().calculate([item('a', 20)], 500, Number.MIN_VALUE, 0),
    { name: 'RangeError', message: /column count.*safe integer/i },
  )
})

test('preserves exact-fit fractional columns without subtraction rounding them down', () => {
  const result = new LayoutEngine().calculate([item('a', 20)], 0.03, 0.01, 0)

  assert.equal(result.columnCount, 3)
  assert.equal(result.items[0].renderedWidth, 0.01)
})

test('preserves fractional columns when subtracting their gaps loses precision', () => {
  const result = new LayoutEngine().calculate([item('a', 20)], 0.34, 0.01, 0.1)

  assert.equal(result.columnCount, 4)
  assert.ok(Math.abs(result.items[0].renderedWidth - 0.01) < Number.EPSILON)
})

for (const mode of ['masonry', 'row', 'column']) {
  test(`${mode} mode keeps mixed spans inside the container without overlaps`, () => {
    let seed = 4731
    const random = maximum => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed % maximum
    }
    const engine = new LayoutEngine()

    for (let scenario = 0; scenario < 50; scenario += 1) {
      const containerWidth = 50 + random(2000)
      const columnWidth = 10 + random(300)
      const gap = random(30)
      const items = Array.from({ length: random(25) }, (_, index) => {
        const entry = item(String(index), random(300), 1 + random(8))
        if (index % 3 === 0) delete entry.data.height
        return entry
      })
      const result = engine.calculate(items, containerWidth, columnWidth, gap, mode)

      for (const [index, entry] of result.items.entries()) {
        assert.ok(Number.isFinite(entry.x) && Number.isFinite(entry.y))
        assert.ok(entry.x >= 0 && entry.y >= 0 && entry.renderedWidth > 0)
        assert.ok(entry.x + entry.renderedWidth <= containerWidth + 1e-8)
        assert.ok(entry.y + entry.renderedHeight <= result.containerHeight + 1e-8)

        for (const other of result.items.slice(index + 1)) {
          const overlapX = Math.min(entry.x + entry.renderedWidth, other.x + other.renderedWidth)
            - Math.max(entry.x, other.x)
          const overlapY = Math.min(entry.y + entry.renderedHeight, other.y + other.renderedHeight)
            - Math.max(entry.y, other.y)
          assert.ok(overlapX <= 1e-8 || overlapY <= 1e-8, 'items must not overlap')
        }
      }
    }
  })
}

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
