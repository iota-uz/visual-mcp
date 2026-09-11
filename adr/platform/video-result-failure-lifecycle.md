---
id: video-result-failure-lifecycle
title: Ошибки локальных media jobs освобождают leases и несут безопасный reason code
status: accepted
date: 2026-09-11
deciders: [diyorkhaydarov]
area: platform
applies_to:
  - packages/video/src/media.ts
  - apps/worker/src/video/render.ts
  - apps/worker/src/video/render-child.ts
  - apps/worker/src/app.ts
  - convex/assets.ts
  - convex/crons.ts
  - convex/schema.ts
  - convex/videoJobs.ts
  - convex/videoRender.ts
  - convex/videoRecovery.ts
  - convex/lib/videoProcessing.ts
  - apps/mcp/src/video/execute.ts
  - apps/web/src/routes/VideoJob.tsx
tags: [video, jobs, storage, recovery, diagnostics]
refs:
  - запрос пользователя
supersedes: []
superseded_by: []
---

## Контекст

Render/media job резервирует несколько object keys до вызова worker. При
`not_applied` и после доказанного отсутствия recovery bytes leases могли
оставаться навсегда. Общий `RENDER_FAILED` при этом скрывал безопасно
показываемую категорию причины, а раскрывать исходный exception нельзя из-за
signed URLs, путей и внутренних логов.

## Решение

Сохранять reservation receipt до dispatch. Терминальный локальный job
освобождает только leases из собственного receipt при `effect=not_applied` или
`recovery_source_unavailable`. Sweep удаляет leases старше 24 часов с
ограниченным размером batch как страховку от прерванного action.

Worker возвращает необязательный enum `reasonCode`, сформированный из
контролируемых категорий. Convex хранит его отдельно от общего error code, MCP
и UI показывают его как диагностику. Текст исходного exception через границу
worker не проходит.

## Обоснование

Receipt даёт точный bounded scope очистки; TTL закрывает аварийный разрыв между
reservation и сохранением receipt. Отдельный reason code сохраняет стабильный
job API и делает сбой устранимым без утечки чувствительных данных.

## Отклонённые альтернативы

Бессрочные leases; очистка по широкому prefix без job receipt; сохранение
сырого exception message; превращение каждой технической причины в новый
верхнеуровневый error code.

## Последствия

Partial/unknown операции сохраняют leases и receipt для reconcile. Paid jobs
не получают разрешение на регенерацию. TTL lease не является TTL сохранённого
asset: asset versions и object bytes этим sweep не удаляются.

## Как проверить

Проверить worker failure envelope, `reasonCode` в `job_get` и UI; убедиться,
что not-applied и unavailable recovery удаляют только leases данного job, а
свежий lease переживает sweep.
