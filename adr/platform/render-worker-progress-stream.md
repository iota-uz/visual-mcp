---
id: render-worker-progress-stream
title: Render worker передаёт измеренный прогресс в durable video job
status: accepted
date: 2026-09-12
deciders: [unknown]
area: platform
applies_to:
  - packages/video/src/media.ts
  - apps/worker/src/app.ts
  - apps/worker/src/video/render.ts
  - apps/worker/src/video/render-child.ts
  - convex/schema.ts
  - convex/videoJobs.ts
  - convex/videoRender.ts
  - apps/mcp/src/video/execute.ts
  - apps/web/src/routes/VideoJob.tsx
tags: [video, render, progress, worker, jobs]
refs:
  - пользовательский отчёт о render jobs без промежуточного прогресса
supersedes: []
superseded_by: []
---

## Контекст

Character render занимает 80–100 секунд. Convex раньше видел только начало
синхронного HTTP-вызова и его финальный JSON, поэтому job всё время показывал
`running/dispatched`, даже когда worker уже рендерил кадры или загружал результат.

## Решение

Внутренний render endpoint поддерживает bounded NDJSON stream. Worker сообщает
только типизированные фазы и измеренный прогресс с шагом 5%: подготовка входов,
рендер кадров, проверка и загрузка артефактов. Convex читает stream в рамках той
же попытки, проверяет fence и сохраняет фазу с долей в durable job. Обычный JSON
ответ endpoint остаётся для локальных прямых вызовов; production orchestrator
явно запрашивает stream.

Ошибки и финальный receipt остаются типизированными terminal events. Progress не
является доказательством persistence и не меняет recovery semantics.

## Обоснование

Поток от фактически выполняющего работу процесса даёт реальный, а не временной
или выдуманный progress. Fence не позволяет запоздалой попытке обновить новый
job state, а 5-процентные buckets ограничивают число сетевых и Convex updates.

## Отклонённые альтернативы

Таймер с предполагаемыми процентами; polling worker; отдельный публичный
callback с новым credential; хранение progress events отдельной таблицей.

## Последствия

`job_get` и UI показывают текущую фазу и процент. Старый worker по-прежнему может
ответить JSON во время rolling deploy, но после обновления обеих сторон новые
render jobs используют поток.

## Как проверить

Проверить worker NDJSON route, monotonic fenced updates и финальный result/error;
затем запустить character render и увидеть несколько изменений `job_get` до
терминального состояния.
