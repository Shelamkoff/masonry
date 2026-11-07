import {
  Masonry,
  type LayoutMode,
  type MasonryEventMap,
  type MasonryEventName,
  type MasonryItemData,
  type MasonryOptions,
} from '@shelamkoff/masonry'

export function useMasonry(container: HTMLElement, element: HTMLElement) {
  const layoutMode: LayoutMode = 'masonry'
  const options: MasonryOptions = {
    columnWidth: 200,
    layoutMode,
    gap: 16,
    autoColSpan: false,
    contentLoadTimeout: 1_000,
    loadMore: async () => false,
  }
  const item: MasonryItemData = { id: 'item', element, height: 120, colSpan: 1 }
  const masonry = new Masonry(container, options)
  const append: Promise<void> = masonry.append([item])
  const items: MasonryItemData[] = masonry.getItems()
  const columns: number = masonry.getColumnCount()

  const click = (payload: MasonryEventMap['item:click'][0]) => {
    payload.item satisfies MasonryItemData
    payload.index satisfies number
    payload.event satisfies MouseEvent
  }
  const unsubscribe: () => void = masonry.on('item:click', click)
  const eventName: MasonryEventName = 'layout:complete'
  masonry.once(eventName, ({ columnCount, containerHeight }) => {
    columnCount satisfies number
    containerHeight satisfies number
  })
  masonry.on('scroll:loadmore', () => {})
  masonry.on('scroll:error', error => { error satisfies unknown })
  masonry.off('item:click', click)
  masonry.remove('item')
  masonry.layout()
  masonry.destroy()

  // @ts-expect-error Column widths must be numeric.
  new Masonry(container, { columnWidth: '200' })
  // @ts-expect-error Event names are limited to the public event map.
  masonry.on('missing:event', () => {})
  // @ts-expect-error Click handlers receive the structured item payload.
  masonry.on('item:click', (value: string) => {})
  // @ts-expect-error Appended items require actual HTML elements.
  masonry.append([{ id: 'invalid', element: 'article' }])

  return { append, items, columns, unsubscribe }
}
