export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  wait: number,
): T & { cancel(): void }

export function uid(): string

export function clamp(value: number, min: number, max: number): number
