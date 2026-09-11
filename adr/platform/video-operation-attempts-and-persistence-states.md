---
id: video-operation-attempts-and-persistence-states
title: Видеооперации группируют попытки, а persistence receipt хранит явное состояние байтов
status: accepted
date: 2026-09-11
deciders: [unknown]
area: platform
applies_to:
  - convex/schema.ts
  - convex/videoJobs.ts
  - convex/videoRecovery.ts
  - convex/videoRender.ts
  - convex/videoShots.ts
  - convex/videoProviderRunner.ts
  - convex/videoCritiqueRunner.ts
  - convex/videoCritiqueRecovery.ts
  - convex/lib/videoProcessing.ts
  - convex/lib/videoPersistence.ts
  - convex/lib/videoObservability.ts
  - convex/assets.ts
  - convex/crons.ts
  - apps/web/src/components/video/VideoJobs.tsx
  - apps/web/src/components/video/review/RenderCandidates.tsx
  - apps/web/src/routes/VideoJob.tsx
  - apps/web/src/styles/surfaces/video-production.css
  - apps/worker/test/video-render.integration.mjs
tags: [video, recovery, idempotency, observability, ux]
refs: []
supersedes: []
superseded_by: []
---

## Контекст

Одна render/media операция может иметь несколько осознанных попыток. Плоский
список jobs позволял неудачной поздней попытке визуально заслонить уже сохранённый
draft. Строковый persistence receipt и проверки произвольного `stage` не давали
контракту отличить reservation, частично записанные байты, полностью записанные
байты и доказанно недоступный источник.

## Решение

Каждый job хранит серверный `operationId`, порядковый `attemptNumber` и ссылку на
предыдущую попытку. API возвращает операции вместе с историей попыток и последней
успешной попыткой. UI выделяет её независимо от состояния самого нового retry.

Persistence receipt хранится нативным discriminated union со состояниями
`reserved`, `partially_persisted`, `persisted`, `source_unavailable` и типизированными
descriptors объектов. `stage` остаётся только прогрессом для человека.

Новая попытка render/media создаётся только сервером от конкретного job, если
trusted recovery равен `regenerate` и `safeToRegenerate=true`. Сервер создаёт новый
idempotency key; автоматического повтора нет. Paid и unknown-effect jobs этот путь
не получают.

Операционные сбои пишут структурированные сигналы: persistence failure,
недоступный recovery source, retry count, duration mismatch и старые orphan leases.
Ненулевой orphan count, source unavailable и duration mismatch имеют alert-флаг;
инфраструктура логов может строить пороги без отдельной продуктовой БД метрик.

## Обоснование

Явное состояние байтов устраняет косвенные эвристики восстановления. Группировка
сохраняет доступ к рабочему результату, а серверный retry boundary не позволяет
клиенту случайно повторить платный или неизвестный эффект.

## Отклонённые альтернативы

Сохранить JSON-строку и добавить новые значения `stage`; автоматически повторять
локальные jobs; считать последнюю попытку единственным результатом операции.

## Последствия

Все fixtures и callers обязаны создавать новые поля jobs и typed receipt. Старые
записи не читаются через compatibility layer в соответствии с green-field posture.
Монитор orphan leases только сигнализирует; удаление остаётся координированным
владельцем lease, чтобы наблюдаемость не стала разрушительной очисткой.

## Как проверить

Проверить server-keyed retry, запрет paid/unknown retry, grouped operation API,
видимость последнего успешного draft после failed retry, все четыре состояния
receipt, recovery без повторного render/provider POST и контейнерный regression
SVG + PNG + MP3 + component + частичный PUT с погрешностью длительности не больше
одного кадра.
