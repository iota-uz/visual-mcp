---
id: trusted-provider-node-runtime
title: Буферизуемые ответы генерации обрабатываются в доверенном Node action
status: accepted
date: 2026-09-10
deciders: [unknown]
area: assets
applies_to:
  - convex/videoProviders.ts
  - convex/videoProviderRunner.ts
  - convex/videoCritiqueRunner.ts
  - convex/lib/videoCritiqueCompletion.ts
  - convex/lib/videoProviderAdapters.ts
  - convex/videoCapabilities.ts
  - packages/video/src/jobs.ts
tags: [providers, memory, security, video]
refs:
  - https://docs.convex.dev/production/state/limits
  - ../../docs/VIDEO-PLAN.md
supersedes: []
superseded_by: []
---

## Контекст

OpenAI возвращает изображения в base64 JSON. При n=4 и высоком разрешении
строки, JSON и декодированные bytes превышают 64 MiB стандартного Convex
runtime. Платный запрос нельзя отправлять в заведомо неподходящий runtime.

## Решение

Image/voice submission и Gemini inline-video critique выполняют доверенные Convex Node actions
(512 MiB); прежний scheduled entry point передаёт только job ID. Ключи остаются
в Convex и не попадают в media worker, sandbox или аргументы задач. Нового
сервиса и бакета нет. Claim, receipt, unknown outcome и отсутствие повторного
платного POST сохраняются.

До dispatch ограничить сумму output pixels: 8 294 400 на запрос, references
и mask: суммарно 32 MiB, отдельный reference: 25 MiB. Неподдерживаемое сочетание
count/size отклоняется с конкретным полем и советом уменьшить count/размер.
Capabilities публикуют эти ограничения. Ограничивать реально прочитанные
provider JSON bytes (56 MiB для OpenAI), а не доверять Content-Length.

## Обоснование

Node выделяет достаточный запас для ограниченных JSON/base64 копий; V8 остаётся
для небольших metadata и транзакций. Лимиты runtime проверены по официальной
документации 2026-09-10. Это оценка ограниченной памяти, не доказательство
фактического качества модели или успешного платного пилота.

## Отклонённые альтернативы

Передать provider keys в изолированный media/code worker; допустить любые
batch-размеры и терять результат после оплаты; повторять неизвестный paid POST.

## Последствия

Максимальное разрешение доступно с count=1; меньшие изображения — до count=4
в общей квоте pixels. Oversize/повреждённый ответ остаётся неизвестным/частичным
результатом, не автоматически повторяется. Streaming provider parsing можно
развить отдельно без изменения security boundary.

## Как проверить

Schema/preflight отказывает до POST; ложный Content-Length не обходит лимит.
Action fixture проверяет один POST, сохранение bytes и повторную ingestion
без повторной генерации. Production memory и quality — отдельные проверки.
