---
id: timeline-is-actual-duration
title: Timeline — единственный источник фактической длительности видео
status: accepted
date: 2026-09-11
deciders: [diyorkhaydarov]
area: product
applies_to:
  - packages/video/src/contracts.ts
  - convex/video.ts
  - convex/videoReview.ts
  - convex/videoRecovery.ts
  - convex/videoDurationMigration.ts
  - apps/mcp/src/video/registry.ts
tags: [video, timeline, duration, contract]
refs:
  - запрос пользователя
supersedes: []
superseded_by: []
---

## Контекст

Проект мог хранить `format.targetDurationMs`, не совпадающий с длительностью
текущего timeline. Поле выглядело как фактический контракт рендера, хотя worker,
review и recovery уже исполняли точное число кадров timeline.

## Решение

Фактическая длительность всегда вычисляется из `timeline.durationFrames` и его
рационального `fps`. В `format` разрешён только `plannedDurationMs`: это
плановый hint, который один раз задаёт начальную длину нового timeline и далее
не участвует в render, review, recovery или UI длительности.

## Обоснование

Один frame-based источник устраняет противоречивые ответы и сохраняет точность
для дробного FPS.

## Отклонённые альтернативы

Автоматически синхронизировать два изменяемых поля; считать planning metadata
обязательным render contract.

## Последствия

Изменение длительности выполняется только через timeline patch. Клиенты,
которым нужен ориентир при создании, передают `plannedDurationMs`.

## Как проверить

Создать проект с planning hint 55 секунд, изменить timeline на 900 кадров при
30 fps и убедиться, что render/review считают 30 секунд, сохраняя hint только
как плановую метаинформацию.
