---
id: workspace-first-navigation
title: Рейл ведёт в воркспейс, а не в библиотеку ассетов
status: accepted
date: 2026-09-12
deciders: [diyorkhaydarov]
area: product
applies_to:
  - apps/web/src/App.tsx
  - apps/web/src/components/WorkspaceCard.tsx
  - apps/web/src/styles/surfaces/sidebar.css
  - apps/web/src/styles/patterns/workspace-card.css
  - convex/workspaces.ts
  - convex/lib/purge.ts
tags: [product, web-ui, navigation]
refs: []
supersedes: []
superseded_by: []
---

## Контекст

Продукт — воркспейс из трёх коллекций: canvases, videos, assets. Сайдбар вёл имена воркспейсов в `/w/:slug/assets` и подсвечивал «Videos» на `/w/:slug/videos`. Карточка воркспейса считала только канвасы.

## Решение

Клик по имени воркспейса в рейле открывает `/w/:slug`. Активен сам воркспейс на любой его коллекции. Глобальные Videos активны только на `/videos`, `/v/` и `/jobs/`. Карточка показывает canvases и videos. Удаление воркспейса снимает и видеопроекты.

## Обоснование

Запрос пользователя: полировать платформу целиком, не только Video Studio. Рейл должен совпадать с коллекциями на странице воркспейса.

## Отклонённые альтернативы

Оставить shortcuts в ассеты — воркспейс читался как библиотека картинок.

## Последствия

Сегмент Canvases / Videos / Assets на странице воркспейса остаётся способом сменить коллекцию.

## Как проверить

`App.test.tsx`: имя воркспейса ведёт на `/w/:slug`; `/w/insurance/videos` подсвечивает воркспейс, не Videos.
