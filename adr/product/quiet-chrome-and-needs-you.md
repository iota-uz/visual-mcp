---
id: quiet-chrome-and-needs-you
title: Один гротеск, пустое создание видео, кадры на Timeline, один inbox
status: accepted
date: 2026-09-12
deciders: [diyorkhaydarov]
area: product
applies_to:
  - apps/web/index.html
  - apps/web/src/styles/tokens.css
  - apps/web/src/routes/Inbox.tsx
  - apps/web/src/routes/VideoProjects.tsx
  - apps/web/src/routes/Canvas.tsx
  - apps/web/src/routes/PublicCanvas.tsx
  - apps/web/src/components/video/VideoReview.tsx
  - apps/web/src/components/video/timeline/TimelineTrackArea.tsx
  - convex/inbox.ts
  - packages/video/src/contracts.ts
tags: [product, web-ui, typography, video, comments]
refs: []
supersedes: []
superseded_by: []
---

## Контекст

Fraunces остался после отмены языка монтажной. New video требовал topic и direction до доски. Timeline был NLE без кадра. Review говорил канцеляритом. Комментарии канваса и video loop не имели общего сигнала.

## Решение

`--app-font-display` = Manrope, Fraunces не грузится. Новый ролик — заголовок, сразу Story; brief.topic/direction могут быть пустыми. Клип на Timeline с asset показывает кадр. Approve остаётся гейтом, формулировка короче. `/inbox` собирает completed-комментарии и awaiting_human loops; рейл показывает «Needs you», когда счётчик > 0. Canvas `?comments=1` открывает панель. Versions в Details сложены. Публичный html/pdf redirect сохраняет wordmark и название.

## Обоснование

Запрос пользователя закрыть все семь пунктов аудита платформы одним проходом.

## Отклонённые альтернативы

Оставить сериф для «характера». Слить canvas comments и video review в один редактор. Убрать гейт approve.

## Последствия

Контракт approve (sha, language, confirmedViewed) не меняется. Агенты по-прежнему могут присылать полный brief.

## Как проверить

`VideoReview.test.tsx`, `App.test.tsx` (Needs you), `convex/inbox.test.ts`. Нет Fraunces в `index.html`.
