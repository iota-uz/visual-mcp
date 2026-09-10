---
id: video-audio-and-shared-storage
title: Видео и аудио используют общую приватную библиотеку assets
status: accepted
date: 2026-09-10
deciders: [diyorkhaydarov]
area: assets
applies_to:
  - apps/mcp/src/assets.ts
  - apps/mcp/src/tools.ts
  - convex/assets.ts
  - convex/schema.ts
  - packages/runtime/src/**
  - AGENTS.md
tags: [assets, audio, video, storage]
refs:
  - ../../docs/VIDEO-PLAN.md
supersedes: [unified-assets-and-media-boundaries]
superseded_by: []
---

## Контекст

Пользователь согласовал перенос claude-reels в Visual Canvas, серверную озвучку
ElevenLabs и монтаж Remotion. Это подтверждённый use case для audio; прежний
запрет больше не соответствует продукту. Пользователь просит не плодить бакеты.

## Решение

Разрешить audio во всех согласованных слоях библиотеки с проверками MIME,
размера, декодируемости и metadata. Использовать существующий private
S3-compatible bucket, immutable revisions и workspace ACL. Предел загрузки —
2 000 000 000 bytes (decimal 2 GB), проверяемый до выдачи transport URL и при
финализации. Большие bytes не проходят через MCP JSON или Convex document.
Проверить фактическое ограничение transport, не считать presigned PUT byte policy.

Сохранить прежние решения: `/assets` переиспользуемы; `/src` и `/output`
canvas-local; доверенный SVG сохраняется побайтово, без sanitation/rewrite.
Ingestion регистрирует media metadata до ready; повтор finalize не создаёт
дубликат. Production refs фиксируют конкретную revision, а не latest.

## Обоснование

Озвучка, микс и воспроизводимый preview — части единого производства. Общая
библиотека избегает параллельных источников истины и провайдерских бакетов.

## Отклонённые альтернативы

Отдельный бакет для каждого провайдера; постоянная двойная запись SQLite/S3;
молчаливое расширение enum без согласованной поддержки аудио во всех слоях.

## Последствия

Старые negative audio tests заменяются проверками корректного audio ingestion
и отказов неверного MIME. Принятое решение не означает готовую реализацию:
реальный 2 GB transport/resume и воспроизведение проверяются отдельно.
Правила retention сохраняют bytes, на которые ссылаются versions/approvals.

## Как проверить

Upload/import → finalize → inspect → audio preview → timeline → render.
Проверить >limit, подменённый MIME, hash mismatch, duplicate finalize,
меж-workspace отказ, unchanged SVG hash, независимые RU/UZ audio refs.
