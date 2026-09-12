---
id: organization-shared-and-workspace-isolated-assets
title: Asset Library разделяется на глобальный Shared и изолированные workspace-библиотеки
status: accepted
date: 2026-09-12
deciders: [diyorkhaydarov]
area: assets
applies_to:
  - apps/mcp/src/assets.ts
  - apps/mcp/src/tools.ts
  - apps/mcp/src/video/canvas-catalog.ts
  - apps/web/src/App.tsx
  - apps/web/src/routes/Assets.tsx
  - convex/assets.ts
  - convex/lib/assetRef.ts
  - convex/migrations.ts
  - convex/schema.ts
tags: [assets, shared-library, workspace-isolation]
refs: [user-request]
supersedes: [video-audio-and-shared-storage]
superseded_by: []
---

## Контекст

Название Shared применялось к personal scope, хотя он принадлежал principal
конкретного браузера или MCP-токена. Из-за этого агент мог переместить ассеты в
personal другого principal, а пользователи не видели их в `/assets`.
Workspace-ассеты при этом должны оставаться изолированными для проектов вроде
Farq.uz и Osago.

## Решение

Сохранить два и только два asset scope: `shared` и `workspace`. `shared` — одна
организационная библиотека, доступная всем аутентифицированным пользователям и
MCP-токенам Canvas независимо от workspace. `workspace` остаётся изолированным
и никогда не подмешивается в Shared-выдачу. Personal scope удаляется;
существующие personal-ассеты мигрируют в Shared без изменения байтов, immutable
versions, tags, provenance и ID-bindings.

Refs имеют формы `asset://shared/<slug>@<revision>` и
`asset://workspace/<workspace>/<slug>@<revision>`. Медиа, создаваемое через
`canvas_save` под `/assets`, по-прежнему становится workspace-ассетом; явный
upload/import в Shared требует `scope=shared`.

## Обоснование

Модель прямо соответствует двум продуктовым намерениям: общий каталог для всей
организации и приватное пространство проекта. Она устраняет зависимость
видимости Shared от identity конкретного токена и не раскрывает workspace-медиа
за пределы его проекта.

## Отклонённые альтернативы

Personal как псевдоним Shared; автоматическое объединение workspace-ассетов в
глобальном поиске; одна библиотека без workspace-изоляции.

## Последствия

Старые `asset://personal/...` перестают быть публичным контрактом после
миграции. UI явно называет `/assets` Shared Asset Library, а workspace routes —
изолированными библиотеками. Slug Shared глобально уникален в организации.

## Как проверить

Создать Shared asset одним principal и прочитать другим; убедиться, что он
виден из любого workspace. Создать workspace asset и проверить, что он виден
только в `/w/<slug>/assets`, отсутствует в `/assets` и не разрешается из другого
workspace. Проверить сохранность object key, versions, tags и canvas/video
bindings после миграции personal → shared.
