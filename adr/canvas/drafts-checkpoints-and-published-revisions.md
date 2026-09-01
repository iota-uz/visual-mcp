---
id: drafts-checkpoints-and-published-revisions
title: CanvasFile v3 разделяет долговечный draft, именованные checkpoints и опубликованную ревизию
status: accepted
date: 2026-08-21
deciders: [diyorkhaydarov]
area: canvas
applies_to:
  - packages/canvas/**
  - convex/canvases.ts
  - apps/mcp/src/tools.ts
  - apps/web/src/routes/Canvas.tsx
  - apps/web/src/routes/Present.tsx
tags: [canvasfile-v3, drafts, checkpoints, publishing]
refs:
  - https://github.com/iota-uz/visual-mcp/commit/b0fa76aa614d9ede2107593ff01665d7b103534a
  - https://github.com/iota-uz/visual-mcp/commit/3cce73989a179708c030a229f029127644021040
supersedes: []
superseded_by: []
---

## Контекст

Авторы делают много мелких правок. Если каждая из них становится публичной
версией, история заполняется техническими промежуточными состояниями, а public
share и embeds показывают недоделанную работу.

## Решение

CanvasFile v3 содержит ordered Pages и canvas-level prototype. Записи меняют
долговечный private draft и увеличивают `draft_revision`, но не создают Version.
`canvas_checkpoint` атомарно фиксирует Pages, prototype, files и bindings как
именованную immutable version. Публикация сначала создаёт checkpoint; следующий
checkpoint уже публичного canvas продвигает опубликованную ревизию.

## Обоснование

Draft даёт безопасную непрерывную работу, checkpoint — осмысленную историю, а
отдельная published revision не показывает внешним читателям промежуточные
состояния.

## Последствия

Новый draft остаётся приватным до checkpoint. Share previews и latest embeds
должны следовать опубликованной ревизии, а pinned embeds — выбранной версии.

## Как проверить

Создать публичный canvas, изменить draft и убедиться, что public view не
изменился; после `canvas_checkpoint` public view и latest embed должны
обновиться вместе.
