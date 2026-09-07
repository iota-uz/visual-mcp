---
id: agent-authored-dual-format-canvas
title: Агент авторит CanvasDoc и артефакты двух форматов, человек получает сфокусированный редактор
status: accepted
date: 2026-08-09
deciders: [diyorkhaydarov]
area: product
applies_to:
  - packages/canvas/**
  - packages/runtime/**
  - apps/web/src/routes/Canvas.tsx
  - apps/mcp/src/tools.ts
tags: [product, authoring, canvasdoc, artifacts]
refs:
  - https://github.com/iota-uz/visual-mcp/commit/9a736358216596f3c86d909f41954dee608a169a
supersedes: []
superseded_by: []
---

## Контекст

Продукт должен принимать структурированные диаграммы и интерфейсы, но также
хостить HTML, PNG, PDF и SVG, которые не сводятся к одной editable scene model.
Полноценный generic drawing editor дублировал бы авторскую роль агента.

## Решение

Поддерживать два first-class формата: декларативный CanvasFile/CanvasDoc,
рендерящийся first-party engine, и opaque HTML/image/PDF artifacts. Агент
авторит content и graph structure через MCP. Человек получает сфокусированные
операции выбора, move, resize, delete, comments и session-local undo, но не
general-purpose tldraw/Excalidraw layer.

## Обоснование

Structured canvas даёт семантические node refs и безопасные typed edits, а
opaque artifacts сохраняют выразительность web/render toolchain. Разделение
ролей удерживает UI простым и не создаёт второй полнофункциональный authoring
product.

## Последствия

Новая authoring функция должна решить, относится ли она к agent contract или к
focused human editor. Opaque artifact не обязан становиться editable CanvasDoc.

## Как проверить

README и MCP schemas поддерживают `kind=canvas`, `html`, `image`, `pdf`; viewer
даёт ограниченный набор прямых манипуляций и не содержит generic drawing layer.

## Уточнения

- 2026-09-07: `human-authored-canvas-content` добавляет два вида контента,
  которые авторит человек — sticky notes и заголовок ноды. Разделение ролей
  в остальном не меняется.
