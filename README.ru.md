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
- Автоматический перерасчёт при изменении высоты уже добавленного контента
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
Медиа внутри одного пакета ожидаются одновременно: их тайм-ауты не складываются.
Если высота и span уже известны, ненужное ожидание пропускается. Поздняя загрузка
медиа и изменение измеряемой высоты карточек вызывают новый перерасчёт.

Ширина сетки определяется по CSS-ширине контента контейнера с учётом padding,
границ и места под scrollbar. CSS-трансформации не меняют число колонок.

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
| `loadMore` | `() => boolean \| void \| Promise<boolean \| void>` | — | Включает infinite scroll; `false` завершает список |

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
В режиме `column` каждый элемент занимает одну колонку. Контейнер, его предки
и вложенные друг в друга элементы нельзя добавлять как отдельные карточки.
Пробелы по краям ID одинаково удаляются в `append()` и `remove()`.

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

Верните `false` из `loadMore`, когда источник данных закончился. Masonry
поставит sentinel на паузу и не будет повторять пустую загрузку.
После успешного добавления карточек видимость sentinel проверяется снова,
чтобы короткие страницы могли заполнить экран. Вызов, не добавивший карточек,
не запускает автоматический цикл повторных запросов.

## Разработка

```bash
npm install
npm test
npm run test:types
npm run test:package
npx playwright install chromium firefox webkit
npm run test:browser
npm run demo
```

`npm run verify` выполняет все проверки релиза, включая три браузерных движка.
Эта же команда запускается перед публикацией через `prepublishOnly`.
Проверка пакета устанавливает собранный tarball в чистый проект и проверяет
ESM/CSS-экспорты и строгую типизацию потребителя в режимах Node16, NodeNext
и Bundler.

Для работы нужны браузерный документ и `ResizeObserver`; для бесконечной
загрузки также нужен `IntersectionObserver`. Импорт пакета при SSR безопасен,
но создавать экземпляр следует после монтирования в браузере. Контейнер должен
быть HTML-элементом текущего browser realm; карточки могут переноситься из
другого документа. Базовый CSS обязателен. Библиотека сохраняет DOM всех
добавленных карточек: для неограниченных лент удаляйте старые элементы либо
реализуйте виртуализацию на уровне приложения.

## Лицензия

MIT
