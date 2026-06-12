import type { MasonryOptions, MasonryItemData, MasonryEventMap } from './types'

type Handler<T extends any[]> = (...args: T) => void

export class Masonry {
  constructor(container: HTMLElement | string, options: MasonryOptions)

  on<E extends keyof MasonryEventMap & string>(
    event: E,
    handler: Handler<MasonryEventMap[E]>,
  ): () => void

  off<E extends keyof MasonryEventMap & string>(
    event: E,
    handler: Handler<MasonryEventMap[E]>,
  ): void

  once<E extends keyof MasonryEventMap & string>(
    event: E,
    handler: Handler<MasonryEventMap[E]>,
  ): () => void

  append(items: MasonryItemData[]): Promise<void>
  remove(id: string): void
  layout(): void
  getItems(): MasonryItemData[]
  getColumnCount(): number
  destroy(): void
}
