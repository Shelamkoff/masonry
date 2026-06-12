export interface ContentLoaderOptions {
  /** Content-loading timeout in ms. Default: 10 000. */
  timeout?: number
}

export class ContentLoader {
  constructor(options?: ContentLoaderOptions)
  waitForContent(element: HTMLElement): Promise<void>
  cancelAll(): void
}
