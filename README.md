# @shelamkoff/masonry

A framework-agnostic responsive masonry grid for arbitrary DOM elements.
It includes three layout strategies, column spans, media-aware measurement,
animated relayout, delegated item events, and optional infinite loading.

[Live demo](https://shelamkoff.github.io/masonry/) ·
[Русская версия](README.ru.md)

## Features

- Masonry, row, and column layout modes
- Responsive column calculation with `ResizeObserver`
- Explicit and image-derived column spans
- Serialized asynchronous appends
- Image, video metadata, and web-font readiness checks
- Configurable content-loading timeout
- Optional `IntersectionObserver` infinite loading
- Click, layout, load, and load-error events
- Clean teardown that unwraps items and restores container styles
- ESM package, CSS entry point, and TypeScript declarations

## Install

```bash
npm install @shelamkoff/masonry
```

Import the controller and its required base styles:

```js
import { Masonry } from '@shelamkoff/masonry'
import '@shelamkoff/masonry/styles.css'
```

## Quick start

```js
const grid = new Masonry('.grid', {
  columnWidth: 260,
  gap: 16,
})

const card = document.createElement('article')
card.textContent = 'A grid item'

await grid.append([
  {
    id: 'article-1',
    element: card,
    height: 180,
  },
])
```

When `height` is omitted, Masonry waits for media inside the element and then
measures the rendered wrapper. Appends are serialized and preserve their call
order.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `columnWidth` | `number` | required | Target minimum column width in pixels |
| `layoutMode` | `masonry \| row \| column` | `masonry` | Placement strategy |
| `autoColSpan` | `boolean` | `true` | Derive a span from image natural width |
| `gap` | `number` | `16` | Horizontal and vertical gap |
| `transitionDuration` | `number` | `300` | Reposition duration in ms |
| `transitionEasing` | `string` | `ease` | CSS easing for repositioning |
| `fadeInDuration` | `number` | `400` | New-item fade duration in ms |
| `contentLoadTimeout` | `number` | `10000` | Maximum wait for media/fonts in ms |
| `infiniteScrollThreshold` | `number` | `200` | Preload distance for `loadMore` |
| `loadMore` | `() => void \| Promise<void>` | — | Enables infinite loading |

All numeric options must be finite. Dimensions and durations cannot be
negative; `columnWidth` must be greater than zero.

## Item data

```ts
interface MasonryItemData {
  id: string
  element: HTMLElement
  height?: number
  colSpan?: number
  meta?: Record<string, unknown>
}
```

IDs and elements must be unique within an instance. `colSpan` is a positive
integer and is clamped to the current number of columns. In column mode every
item occupies one column.

## Methods

### `append(items)`

Returns a promise for that batch. A failed batch rejects without blocking
later appends.

### `remove(id)`

Removes one item and recalculates the layout.

### `layout()`

Forces a synchronous layout recalculation.

### `getItems()` and `getColumnCount()`

Return item-data snapshots and the current column count.

### `destroy()`

Disconnects observers, cancels pending media waits and animation frames,
unwraps managed elements, and restores the container's prior inline styles.
Calling it more than once is safe.

## Events

```js
grid.on('item:click', ({ item, index, event }) => {})
grid.on('layout:complete', ({ containerHeight, columnCount }) => {})
grid.on('scroll:loadmore', () => {})
grid.on('scroll:error', error => {})
```

`on` and `once` return an unsubscribe function.

## Development

```bash
npm install
npm test
npm run build
npm run demo
```

## License

MIT
