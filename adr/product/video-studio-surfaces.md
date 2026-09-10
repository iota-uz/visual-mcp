---
id: video-studio-surfaces
title: Video Studio — коллекция воркспейса и иммерсивный редактор
status: accepted
date: 2026-09-10
deciders: [diyorkhaydarov]
area: product
applies_to:
  - apps/web/src/App.tsx
  - apps/web/src/routes/VideoStudio.tsx
  - apps/web/src/routes/VideoProjects.tsx
  - apps/web/src/routes/VideoJob.tsx
  - apps/web/src/routes/Workspace.tsx
  - apps/web/src/routes/Assets.tsx
  - apps/web/src/routes/Home.tsx
  - apps/web/src/components/WorkspaceCard.tsx
  - apps/web/src/components/WorkspaceChrome.tsx
  - apps/web/src/components/VideoProjectCard.tsx
  - apps/web/src/components/video/**
  - apps/web/src/styles/surfaces/video.css
  - convex/video.ts
  - convex/lib/videoPurge.ts
tags: [product, web-ui, video]
refs: []
supersedes: []
superseded_by: [video-studio-workbench]
---

## Контекст

Video Studio перенесли в Visual Canvas как durable backend, но UI остался
длинным документом рядом с рельсом. Канвас — иммерсивный редактор, списки
канвасов и ассетов — карточки с ⋯. Видео не светилось в сайдбаре, на
воркспейсе жило кнопкой, превью всегда говорило «нет ролика».

## Решение

Видео — коллекция воркспейса, рядом с Canvases и Assets, не смешанная
сетка. `/w/:slug` остаётся галереей канвасов.

Студия `/v/:id` — иммерсивный редактор: command bar, режимы Story / Shots /
Timeline / Review, превью 9:16. Jobs, loop и архив — в Production drawer.
Черновик, версия, рендер и approval остаются разными действиями.

Удаление проекта жёсткое: каскад drafts/versions/jobs/comments/loop
состояний. Байты shared Asset Library не трогаем. Миграционный архив
отвязывается, не стирается.

## Обоснование

Требование VIDEO-PLAN: frontend на компонентах и стиле Canvas. Рельс и
карточки уже задали, как в этом продукте находят работу; студия должна
быть редактором, как `/c/:id`.

## Отклонённые альтернативы

Смешать видео в сетку канвасов. Полный NLE с drag-and-drop. Оставить
студию документом в `.page-container`.

## Последствия

Сайдбар получает Videos → `/videos`. Шапка воркспейса — переключатель
коллекций. Появляются rename/delete проекта. MCP-каталог не меняется.

## Как проверить

`/` ⋯ Videos; рельс Videos активен на `/videos`, `/w/:slug/videos`, `/v/:id`.
Воркспейс Canvases | Videos | Assets. Студия без рельса, с command bar.
Пустое превью только без рендера; успешный render виден в 9:16.
