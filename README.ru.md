# @shelamkoff/masonry

Адаптивная masonry-сетка без привязки к фреймворку. Поддерживает три режима
layout, элементы на несколько колонок, ожидание загрузки медиа, анимированный
перерасчёт, события и опциональную бесконечную загрузку.

[Демо](https://shelamkoff.github.io/masonry/) · [English](README.md)

## Возможности

- Режимы `masonry`, `row` и `column`
- Адаптивные колонки через `ResizeObserver`
- Ручной и автоматический `colSpan`
- Последовательная очередь асинхронных append
- Ожидание изображений, метаданных видео и web fonts
- Ограничение времени ожидания контента
- Infinite scroll через `IntersectionObserver`
- События клика, layout, загрузки и ошибки загрузки
- Корректный `destroy()` с восстановлением DOM и стилей контейнера
- ESM, CSS entry point и TypeScript declarations

## Установка

```bash
npm install @shelamkoff/masonry
```

```js
import { Masonry } from '@shelamkoff/masonry'
import '@shelamkoff/masonry/styles.css'

const grid = new Masonry('.grid', {
  columnWidth: 260,
  gap: 16,
})

const card = document.createElement('article')
card.textContent = 'Элемент сетки'

await grid.append([
  { id: 'article-1', element: card, height: 180 },
])
```

Если `height` не передан, Masonry ждёт готовности медиа внутри элемента и
измеряет wrapper. Параллельные вызовы `append()` выполняются строго по порядку.

## Настройки

| Параметр | Тип | По умолчанию | Назначение |
| --- | --- | --- | --- |
| `columnWidth` | `number` | обязательный | Целевая минимальная ширина колонки |
| `layoutMode` | `masonry \| row \| column` | `masonry` | Алгоритм размещения |
| `autoColSpan` | `boolean` | `true` | Определять span по natural width изображения |
| `gap` | `number` | `16` | Горизонтальный и вертикальный отступ |
| `transitionDuration` | `number` | `300` | Длительность перемещения, мс |
| `transitionEasing` | `string` | `ease` | CSS easing |
| `fadeInDuration` | `number` | `400` | Появление новых элементов, мс |
| `contentLoadTimeout` | `number` | `10000` | Максимальное ожидание медиа, мс |
| `infiniteScrollThreshold` | `number` | `200` | Упреждающий отступ infinite scroll |
| `loadMore` | `() => void \| Promise<void>` | — | Включает infinite scroll |

Все числовые значения должны быть конечными. Размеры и длительности не могут
быть отрицательными, а `columnWidth` должен быть больше нуля.

## Данные элемента

```ts
interface MasonryItemData {
  id: string
  element: HTMLElement
  height?: number
  colSpan?: number
  meta?: Record<string, unknown>
}
```

ID и DOM-элементы должны быть уникальны. `colSpan` — положительное целое число.
В режиме `column` каждый элемент занимает одну колонку.

## Методы и события

- `append(items)` — добавляет batch и возвращает `Promise`.
- `remove(id)` — удаляет элемент и пересчитывает layout.
- `layout()` — запускает перерасчёт вручную.
- `getItems()` — возвращает snapshots данных.
- `getColumnCount()` — возвращает текущее число колонок.
- `destroy()` — отключает observers, отменяет ожидания и восстанавливает DOM.

```js
grid.on('item:click', ({ item, index, event }) => {})
grid.on('layout:complete', ({ containerHeight, columnCount }) => {})
grid.on('scroll:loadmore', () => {})
grid.on('scroll:error', error => {})
```

## Разработка

```bash
npm install
npm test
npm run build
npm run demo
```

## Лицензия

MIT
