---
id: studio-frames-jobs-posters
title: Shots показывают кадр, Production — jobs first, список видео — постер
status: accepted
date: 2026-09-12
deciders: [diyorkhaydarov]
area: product
applies_to:
  - apps/web/src/components/video/ShotStudio.tsx
  - apps/web/src/components/video/shots/AssetWell.tsx
  - apps/web/src/components/video/HumanLoopPanel.tsx
  - apps/web/src/components/VideoProjectCard.tsx
  - apps/web/src/routes/VideoStudio.tsx
  - apps/web/src/routes/VideoProjects.tsx
  - convex/video.ts
tags: [product, video-studio, shots, assets]
refs: [studio-glance-then-edit, video-studio-workbench]
supersedes: []
superseded_by: []
---

## Контекст

Доска Shots читала бриф, не кадр. Production смешивал jobs, agent loop и
архив Reels. Список видео ставил иконку Film вместо 9:16.

## Решение

- Шахта шота показывает `selectedVideo`, иначе `startImage`, иначе наборный
  fallback. Preview — тот же `previewAsset`.
- Production: сначала jobs, agent и архив свёрнуты. Archive pending больше
  не спрашивает `window.confirm` поверх уже открытой формы причины.
- `listProjects` / `listMine` отдают `poster` с последнего успешного render.
  Карточка рисует 9:16, если постер есть.

## Обоснование

Объект Shots и галереи — кадр. Jobs — ежедневная работа; loop и архив —
редкие.

## Отклонённые альтернативы

Оставить текстовый колодец. Presign постера в query списка. Держать loop
открытым над jobs.

## Последствия

MCP `video_project_list` не отдаёт poster — агенту кадр не нужен для
навигации. Карточка без постера остаётся колодцем.

## Как проверить

Shot с startImage: img в шахте. Production: Video export выше Agent.
Список: карточка с render показывает PNG; без render — Film.
