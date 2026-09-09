---
id: in-node-comment-anchors
title: Комментарий якорится к точке внутри ноды и перетаскивается
status: superseded
date: 2026-09-09
deciders: [diyorkhaydarov]
area: product
applies_to:
  - convex/schema.ts
  - convex/comments.ts
  - packages/canvas/src/viewport.ts
  - packages/canvas/src/comment-anchor.ts
  - packages/canvas/src/theme.css
  - apps/web/src/routes/Canvas.tsx
  - apps/web/src/components/comments/types.ts
  - apps/mcp/src/tools.ts
  - apps/mcp/src/guides.ts
tags: [product, comments, canvas, editor-ux]
refs: []
supersedes: []
superseded_by: [element-id-comment-anchors]
---

## Контекст

Комментарий на ноде хранил только `nodeId` и рисовался в правом верхнем
углу кадра. Клик по кнопке внутри iframe попадал в `.vc-node`, но точка
выбрасывалась при записи. Два комментария на одном экране сливались в
одну булавку. Человек не мог сказать «вот этот контрол» и не мог
перенести булавку.

`allow-same-origin` у iframe запрещён: родитель не читает DOM экрана.

## Решение

Якорь — одно из трёх:

- **внутри ноды** — `nodeId` + `local:{x,y}` в долях 0–1 прямоугольника
  ноды. Булавка в `node.x + local.x * w`, `node.y + local.y * h`.
- **нода целиком** — только `nodeId` (старые строки и пункт меню без
  клика). Булавка по-прежнему справа сверху.
- **страница** — world `point`, без `nodeId`.

Инструмент Comment пишет `local` с клика. Песочница iframe не
меняется: клик по неактивному экрану — это пиксель ноды. Активный
iframe при выборе Comment выключается.

Булавки не кластерятся по `nodeId`: один тред — одна булавка.
Перетаскивание (порог как у sticky note) вызывает `reanchorMine`:
на ноду под курсором с новым `local`, или на пустую страницу с
`point`. Агент булавки не таскает; MCP даёт `comment_reanchor`.

У native-body опциональный `target_label` (aria-label / текст) — подсказка
агенту, не селектор.

## Обоснование

Нормированные координаты переживают move/resize. Без same-origin нет
привязки к DOM-узлу внутри экрана; визуальная точка — то, что клик по
кнопке в мокапе и означает. Кластер по ноде имел смысл, только пока все
булавки сидели в одном углу.

## Отклонённые альтернативы

- `allow-same-origin` и `elementFromPoint` в iframe: ломает sandbox.
- CSS-селектор как якорь: ломается на каждом HTML rewrite агента.
- Оставить точку в world-space при `nodeId`: устаревает при движении
  ноды — ровно то, от чего отказались раньше, только теперь `local`
  едет вместе с нодой.

## Последствия

`createComment` больше не выбрасывает координаты клика: при `nodeId`
пишет `local`. `comment_create` принимает `local`. Старые нодовые
комментарии без `local` рисуются как раньше.

Агент не видит DOM внутри iframe. `comment_list` отдаёт предложение
`where` («On Invite, 25% from the left, 80% from the top») и `look` —
готовый target для `canvas_snapshot` этой ноды. `local` остаётся
машиночитаемым, не селектором.

## Как проверить

Comment по экрану — булавка на клике, reload, move/resize ноды.
Второй комментарий на том же экране — вторая булавка. Drag на другой
контрол, на другую ноду, на пустую страницу. Comment при активном
iframe. MCP: `comment_create` + `local`, `comment_reanchor`.
