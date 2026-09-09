---
id: element-id-comment-anchors
title: Комментарий якорится к элементу по data-vc-id, а не к процентам кадра
status: accepted
date: 2026-09-09
deciders: [diyorkhaydarov]
area: product
applies_to:
  - convex/schema.ts
  - convex/comments.ts
  - convex/http.ts
  - packages/canvas/src/vc-id.ts
  - packages/canvas/src/iframe-probe.ts
  - packages/canvas/src/comment-anchor.ts
  - packages/canvas/src/element-ref.ts
  - packages/canvas/src/viewport.ts
  - apps/web/src/routes/Canvas.tsx
  - apps/web/src/components/comments/types.ts
  - apps/mcp/src/tools.ts
  - apps/mcp/src/guides.ts
tags: [product, comments, canvas, mcp, agent-ux]
refs: []
supersedes: [in-node-comment-anchors]
superseded_by: []
---

## Контекст

Предыдущее решение хранило клик как `local` 0–1 прямоугольника ноды. Для мыши
это работало. Для агента — нет: проценты не называют кнопку, `look` + snapshot
не показывают булавку, координаты считаются от всего кадра включая chrome, а
не от контента. CSS-селектор ломается на каждом rewrite HTML. `allow-same-origin`
у iframe запрещён.

Нужен стабильный идентификатор контрола, который человек кликает и который
агент читает текстом.

## Решение

Идентичность комментария на экране — `{node_id, el, role, name}`:

- `el` — `data-vc-id` на интерактивном элементе или заголовке.
- `role` / `name` — ARIA-роль и accessible name, дублируются в треде, чтобы
  список комментариев читался без DOM.
- `local` остаётся точкой отрисовки булавки и fallback для image/PDF/пустого
  поля, где элемента нет.
- Страничный комментарий по-прежнему `point` без `node_id`.

HTML при save и при отдаче `/i/` штампуется: валидный авторский `data-vc-id`
сохраняется, иначе id = slug имени или `el-` + hash(`role|name|short-path`).
Штамп только вставляет атрибут в opening tag.

Hit-test iframe — injected probe + `postMessage`, без `allow-same-origin`.
Native-body — `elementFromPoint` в родительском DOM.

Локатор: `canvas://ws/c?node=invite&el=submit-claim`. MCP: `screen_tree`
отдаёт `{el, role, name, tag}`; `comment_create` принимает `el` и сверяет его
с деревом экрана. Snapshot не нужен, чтобы понять, о каком контроле речь.

## Обоснование

Один id живёт в HTML, в комментарии и в MCP. Агент читает дерево текста, а не
картинку. Песочница iframe не меняется. Геометрия остаётся только там, где
элемента нет.

## Отклонённые альтернативы

- `local` + snapshot как канон для агента: VLM не сопоставляет проценты с
  неразмеченным PNG, N комментариев → N снимков.
- CSS-селектор как якорь: ломается на rewrite.
- `allow-same-origin` + `elementFromPoint` из родителя: ломает sandbox.
- DOM-binding на живой узел без стабильного id: не переживает перерисовку.

## Последствия

`target_label` и `look` у комментария убраны. `comment_list.where` называет
контрол. Старые нодовые комментарии без `el` рисуются по `local` или в правом
верхнем углу. Drag булавки перезаякоривает на новый `el`.

## Как проверить

Comment по кнопке в iframe — булавка на клике, `el` в треде, reload, move
ноды. Второй комментарий на другом контроле того же экрана. Drag на другой
`el`, на другую ноду, на страницу. MCP: `screen_tree`, `comment_create` с
`el`, отказ на неизвестный `el`. HTML после save содержит `data-vc-id`.
