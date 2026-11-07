import type { LayoutItem, LayoutResult, LayoutMode } from './types.js'

export class LayoutEngine {
  calculate(
    items: LayoutItem[],
    containerWidth: number,
    columnWidth: number,
    gap: number,
    mode?: LayoutMode,
  ): LayoutResult
}
