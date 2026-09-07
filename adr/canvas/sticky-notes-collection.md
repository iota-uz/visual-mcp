---
id: sticky-notes-collection
title: Sticky notes — коллекция notes[] в CanvasDoc без высоты и с проставляемым автором
status: accepted
date: 2026-09-07
deciders: [diyorkhaydarov]
area: canvas
applies_to:
  - packages/canvas/src/types.ts
  - packages/canvas/src/patch.ts
  - packages/canvas/src/note-metrics.ts
  - packages/canvas/src/search-rows.ts
  - convex/schema.ts
  - convex/canvases.ts
  - apps/mcp/src/notes.ts
  - packages/runtime/src/sandbox/worker-source.ts
tags: [canvas, canvasdoc, sticky-notes, search]
refs: []
supersedes: []
superseded_by: []
---

## Контекст

`human-authored-canvas-content` вводит заметки, которые пишут и человек, и
агент. Нужно место в документе, правило про автора и индексация для
поиска. Claude Design хранит `annotations[]` в манифесте с `w`, но без
`h` — высота подгоняется под текст.

## Решение

`CanvasDoc.notes[]` (до 500): `{ id, x, y, w: 120–2000, text: ≤5000
непустых символов, color: yellow|blue|green|pink|neutral, size: s|m|l,
author: human|agent }`. Высота не хранится: DOM переносит текст, а
`note-metrics.ts` даёт одинаковую оценку для hit-test, minimap и
статичных рендеров, зеркаля метрики `.vc-note[data-size]` в `theme.css`.

Патч-операции `notes.add|update|replace|remove` идут через тот же
`applyCanvasDocPatch`. `author` никогда не берётся из payload:
`patchManualEditMine` ставит `human`, все MCP-пути (`canvas_doc_patch`,
`canvas_patch`, `canvas_run` commit, полные сохранения через
`saveCanvasFileDraft`, `canvas_save`) — `agent`, при этом заметка с
существующим id и `author:"human"` сохраняет автора и текст; попытка
агента сменить текст человеческой заметки отклоняется
(`note_owned_by_human`). Удалять её агент может.

Индекс поиска: таблицы `canvasNodes` и `canvasDraftNodes` хранят одну
строку на сущность с `entity: node|note` и `entityId` вместо `nodeId`;
строки строит один `canvasSearchRows(file)` в `@visual-canvas/canvas`.
`canvas_find` возвращает `notes[]` отдельно от `nodes[]`; `canvas_get`
отдаёт `notes` в проекции и `open_notes_by_human`.

Нативная форма ноды `note` переименована в `card` (SDK `canvas.card()`);
`canvas.sticky()` эмитит `notes.add`.

## Обоснование

Отдельная коллекция не смешивает заметки с lanes/stages/edges/groups и с
поиском по экранам. Отсутствие `h` исключает рассинхрон между тем, что
написал агент, и тем, что перенёс браузер. Проставление автора на
границе — единственный способ гарантировать, что агент не перепишет
обратную связь человека при полном re-save.

## Отклонённые альтернативы

- `notes` как под-поле `labels[]`: у label есть `rect` с высотой и tone,
  нет автора; семантика другая.
- Доверять `author` из payload с валидацией: любой полный `canvas_save`
  молча сделал бы все заметки агентскими.
- Отдельная таблица `canvasNotes` для поиска: те же строки, второй индекс,
  второй sweep.

## Последствия

`CanvasDocSchema` строгий: документ с полем `h` у заметки невалиден.
Все тесты и фикстуры получили `notes: []`. Индексы
`by_versionId_and_entityId` и `by_canvas_page_entity` заменяют
`*_nodeId`/`*_node`. `shape:"note"` больше не валиден.

## Как проверить

`canvas_doc_patch` с `notes.add {author:"human"}` → в документе
`author:"agent"`; `canvas_save` с той же заметкой человека → автор и
текст сохранены; `canvas_get collections:["notes"]` отдаёт заметки и
`open_notes_by_human`; `canvas_find` находит заметку по тексту;
`canvas_run` с `canvas.sticky()` создаёт заметку.
