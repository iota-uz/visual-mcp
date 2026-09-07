---
id: browser-export-via-snapshot-worker
title: Экспорт из браузера рендерит snapshot worker через Convex action, кэш по draft revision
status: accepted
date: 2026-09-07
deciders: [diyorkhaydarov]
area: platform
applies_to:
  - convex/exports.ts
  - convex/lib/snapshotRender.ts
  - convex/embedRender.ts
  - convex/schema.ts
  - apps/worker/src/snapshot.ts
  - apps/worker/src/schemas.ts
  - apps/web/src/lib/download.ts
  - apps/web/src/lib/export.ts
  - apps/web/src/components/ExportMenu.tsx
tags: [export, worker, convex, pdf]
refs: []
supersedes: []
superseded_by: []
---

## Контекст

Пользователь попросил перенести из Claude Design кнопку «скачать» у элемента
и общее меню экспорта канваса. В продукте уже есть один растеризатор —
Playwright render worker, которым пользуются `canvas_snapshot` (MCP) и
публичные embed-карточки. Браузер сам не умеет отрисовать iframe-ноды в PNG
(cross-origin, sandbox), а два разных рендерера дали бы две разные картинки
одного и того же канваса.

## Решение

- Экспорт из браузера — это публичный Convex action `exports.requestMine`
  (`convex/exports.ts`). Аргументы: `canvasId`, `pageId?`, `target:
  canvas|node`, `nodeId?`, `clip: frame|content`, `scale: 1|2`, `format:
  png|pdf`. Ответ: `{status: ok|partial, url, filename, mimeType, warnings,
  cached}`; `url` — storage URL Convex, который SPA скачивает через
  `fetch → blob → <a download>` (`apps/web/src/lib/download.ts`).
- Рендерится **draft** (то, что видит редактор), а не последний checkpoint.
- Общая обвязка вызова worker'а (`/snapshot`, staging target-aware entry
  page, подписанные sources, theme payload, коды предупреждений) вынесена в
  `convex/lib/snapshotRender.ts`; `embedRender.ts` использует её же.
- Кэш: таблица `canvasExports`, ключ `sha256(draftRevision, pageIds, target,
  clip, scale, format, theme)`, TTL 24 часа, свой sweep-cron
  (`exports.sweep`) и удаление вместе с канвасом (`lib/purge.ts`).
  Кэшируются только чистые результаты (`status: ok`); `partial` отдаётся,
  но не запоминается, чтобы следующий клик попробовал снова. Попадание в
  кэш обслуживается даже без worker'а.
- Worker `/snapshot` получает `format: png|pdf` (по умолчанию `png`) и
  `entrypoints[]` для многостраничного PDF: по одному растровому захвату на
  entrypoint, каждая страница PDF равна CSS-размеру захвата (1 px = 1 pt),
  диагностика объединяется. PNG-путь не изменён. Ответ получил
  `pages` и `mimeType: image/png | application/pdf`.
- Если `WORKER_URL`/`WORKER_TOKEN` не заданы, action падает с текстом
  `render worker is not configured` **до** staging'а каких-либо blob'ов.
  Это единственное сообщение, которое видит браузер на локальном стеке без
  worker'а.
- Имя файла: `<canvas-slug>-<page-id|node-id|all-pages>[@2x].<png|pdf>`.

## Обоснование

Один рендерер — одинаковая картинка в share-карточке, в `canvas_snapshot`
агента и в скачанном файле. Кэш по draft revision нужен потому, что
Download на ноде — частое действие, а рендер стоит секунды и Chromium.
Отдельная таблица вместо расширения `canvasSnapshots`: та таблица — всегда
PNG неизменяемой версии, и все её читатели (`getSnapshotCache`,
`putSnapshotCache`) опираются на оба факта; PDF драфта туда не ложится без
изменения их контракта.

## Отклонённые альтернативы

- Растеризация в браузере (html2canvas и т.п.): не видит cross-origin
  iframe-ноды и расходится с серверной картинкой.
- Расширить `canvasSnapshots.mimeType` до union: ломает типизацию
  существующих reader'ов и смешивает кэш версии с кэшем драфта.
- Собирать PDF на стороне Convex из PNG: Convex runtime не подходит для
  `pdf-lib` на мегабайтных изображениях, а worker уже держит все байты.

## Последствия

- `apps/worker` зависит от `pdf-lib` (ранее только dev-зависимость тестов
  runtime).
- Локальный `dev:agent` стек без worker'а показывает ошибку
  `render worker is not configured`; проверять PDF/многостраничный экспорт
  нужно с поднятым `apps/worker` (`WORKER_URL`/`WORKER_TOKEN`) или на dev
  deployment.
- Экспорт доступен только signed-in пользователю с записью в `users`
  (та же org-wide read surface, что и остальные `*Mine`).

## Как проверить

- `cd convex && npx vitest run exports.test.ts` — валидация аргументов,
  точный текст ошибки без worker'а, попадание в кэш без worker'а, sweep.
- `npm test -w apps/worker` — `format=pdf` с двумя entrypoints даёт PDF из
  двух страниц; PNG-контракт не изменился.
- `npm test -w apps/web` — `download.test.ts`, `export.test.ts`.
- На стеке с worker'ом: Export → «Export all pages PDF» скачивает файл с
  одной страницей на каждую Page канваса.
