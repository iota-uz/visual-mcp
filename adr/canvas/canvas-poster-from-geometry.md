---
id: canvas-poster-from-geometry
title: Обложка канваса — схематичный постер из геометрии, денормализованный в строку
status: accepted
date: 2026-09-08
deciders: [diyorkhaydarov]
area: canvas
applies_to:
  - packages/canvas/src/poster.ts
  - convex/schema.ts
  - convex/canvases.ts
  - convex/workspaces.ts
  - convex/migrations.ts
  - convex/seed.ts
  - apps/mcp/src/tools.ts
  - apps/web/src/components/CanvasCover.tsx
  - apps/web/src/styles/patterns/canvas-cover.css
tags: [canvas, poster, thumbnails, denormalization]
refs:
  - https://github.com/iota-uz/visual-mcp/commit/7068dcf8b1977fa559dea28a72454d7b529c5f60
supersedes: []
superseded_by: []
---

## Контекст

Настоящей обложки у канваса практически никогда нет. `canvases.thumbnailId`
пишут только три места агентского render-пути, фоновый перерендер работает
только для опубликованных канвасов, а `restoreVersion` обложку очищает. У
канваса, созданного из браузера, её не будет никогда — каждая карточка
галереи была пунктирной коробкой «No render yet», а в проде у OSAGO поверх
неё висела красная плашка «Preview update failed».

Посчитать обложку в момент чтения нельзя физически: `ctx.storage` в query и
mutation даёт только `getUrl`, `get(): Blob` есть лишь у
`StorageActionWriter`, а `listCanvases` обязан остаться query ради
реактивности. Клиентский вариант — 200 подписанных URL и 200 полных JSON на
одну отрисовку галереи.

## Решение

Обложка рисуется из самого канваса: расположение нод, подкрашенное ролью
дорожки, и ничего больше — ни текста, ни картинок, ни chrome. Геометрия
считается в `packages/canvas/src/poster.ts` (`canvasPosterForDoc`,
`canvasPoster`), хранится как промилле от bbox, ≤ 32 крупнейших
прямоугольника, аспект зажат в `[0.25, 4]`.

Поле `poster` — `v.optional` на `canvases` и на `canvasVersions`
(иммутабельная копия, чтобы `restoreVersion` — мутация, блоб не читающая —
восстанавливал обложку так же, как ноды). В аргументах мутаций оно
**обязательное**. Проецируется в `listCanvases` и в
`workspaces.listMine.recent[]`, но **не** в `toSummary`.

Постер не трогает `thumbnailId`: настоящий PNG всегда выигрывает, постер —
fallback, протухший подписанный URL через `onError` падает в постер, а не в
«No render yet». Приоритет живёт в одном месте — `CanvasCover`.

Для `kind: "canvas"` объект пишется всегда, даже пустой (`rects: []`), —
тогда `poster === undefined` однозначно значит «ещё не посчитан», на чём и
фильтрует бэкфилл `migrations.backfillCanvasPosters`.

## Обоснование

Это не второй растеризатор. Один растеризатор — Playwright worker
(`adr/platform/browser-export-via-snapshot-worker.md`): постер не
скачивается, не участвует в export, embed и `canvas_snapshot`, не несёт ни
текста, ни картинок. Контракт share-карточки не меняется:
`thumbnailId` остаётся og:image
(`adr/sharing/static-preview-cards-not-embedded-viewers.md`), и постера нет в
`toSummary`, который раскрывается в `getCanvas` — а это и MCP detail, и
публичная проекция; ~2 КБ геометрии там были бы впустую в обоих контрактах.

Обязательность в аргументах при опциональности в схеме — green-field-рычаг:
`tsc` сам перечислил все пути записи, и это доказательство, что покрыты все
четыре (`saveCanvasFileMine`, `patchManualEditMine`, `prepareSaveDoc` в
`apps/mcp` как единственная точка всех `canvas_*` записей, и seed).
Опциональность в схеме — потому что обязательное поле провалит push против
существующих строк, а `html | image | pdf` геометрии не имеют по определению
(`adr/product/agent-authored-dual-format-canvas.md`).

Дорожки, стадии, рёбра, заметки и рисунки исключены: в размере обложки они
сливаются в заливку и прячут ноды. Обложечная страница — та, которую откроет
клик (`defaultPageId` → минимальный `order`), поэтому обложка это обещание,
которое клик выполняет.

## Отклонённые альтернативы

Вычисление на лету в query — невозможно (`ctx.storage` без `get`). Расчёт на
клиенте — 200 подписанных URL на отрисовку и нереактивная геометрия. Запись
постера в `thumbnailId` — сломала бы og:image публичных карточек.
`migrations.define` для бэкфилла — `migrateOne` выполняется в мутации и блоб
не прочтёт; взята форма `prepareLegacyCanvasAssets`. Заполнение исторических
`canvasVersions` отклонено: восстановление на до-постерный чекпойнт покажет
нейтральную плашку — это честнее, чем чужая геометрия под правильным
заголовком.

## Последствия

~50–65 байт на прямоугольник, ≤ 2 КБ на строку при отсечке 32. Связывающее
ограничение — `workspaces.listWorkspaces`, который делает `take(200)` по
каждому воркспейсу ради `canvas_count`: поле безопасно, пока
`воркспейсы × канвасов ≲ 2500`. Лечение при росте — денормализовать
`workspaces.canvasCount`, а не переносить постер; это записано комментарием
в схеме.

`staticRenderStatus` описывает конвейер публикуемых карточек, а не лицо
карточки в списке: в списках остаются только транзитные `queued`/`updating`,
`stale`/`error` показываются на странице канваса рядом с публикацией.
`PageThumb` в рельсе страниц свернулся в `CanvasCover size="chip"`.
Минимальные размеры прямоугольников — презентация, живут в CSS, поэтому их
можно менять без ре-бэкфилла.

## Как проверить

`packages/canvas/test/poster.test.ts` (пустой док, нормализация, отсечка по
площади, детерминизм, зажатие аспекта, роль и вид, нода без дорожки,
многостраничный файл). `convex/canvases.test.ts`: сохранение только
метаданных не стирает обложку; `restoreVersion` восстанавливает обложку
своего чекпойнта. `CanvasCover.test.tsx` — четыре ветки приоритета и
`onError`. Локально: у `kind:"canvas"` виден постер, у остальных — плашка
вида, красной плашки «Preview update failed» нет нигде; `canvas_nodes_move`
через локальный MCP и перетаскивание ноды в редакторе меняют прямоугольники
в открытой соседней вкладке галереи без перезагрузки. Бэкфилл: очистить
`poster` у сида, `migrations:backfillCanvasPosters` → `{updated: 1}`, повтор
→ `{updated: 0}`. Приоритет настоящего PNG проверяется на dev deployment —
воркера в локальном стенде нет.
