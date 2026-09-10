---
id: video-studio-integration
title: Video Studio переносится в Visual Canvas с долговечным облачным состоянием
status: accepted
date: 2026-09-10
deciders: [diyorkhaydarov]
area: platform
applies_to:
  - apps/mcp/**
  - apps/web/**
  - apps/worker/**
  - convex/**
tags: [video, migration, hitl, providers]
refs:
  - ../../docs/VIDEO-PLAN.md
supersedes: []
superseded_by: []
---

## Контекст

claude-reels уже содержит offline production/workflow ядро. Пользователь
поручил перенести продукт, UI и открытые задачи в visual-mcp и развернуть его.
Это дополнение к convex-bff-railway-mcp-boundary, не отмена разделения BFF/MCP.

## Решение

Один продукт для IOTA: Convex — canonical drafts/versions/jobs/review,
существующая Asset Library — immutable media, Canvas UI — preview и feedback.
Заменить SQLite/local paths адаптерами, без постоянной двойной записи.
Перенести сохранённые материалы/замечания и происхождение; существующие
approval claims не превращать в новые подтверждённые человеческие решения.

Reasoning и субагенты остаются в harness. Облако исполняет durable media jobs,
не постоянный reasoning daemon. Для этой реализации использовать Codex swarm,
не запускать Claude runtime. Claude/Codex skill wrappers оформлять отдельно.

OpenAI image-2.5, ElevenLabs, Gemini critique и Higgsfield shot generation
исполняются доверенным provider executor. Ключи не находятся в процессе
авторского кода. Codex предпочитает встроенный imagegen с последующим импортом;
новый Codex imagegen skill и скрытый платный fallback не нужны. Модель и
capabilities подтверждаются API, неизвестное остаётся неизвестным.

Сценарий/shot candidate/timeline/checkpoint/render — разные объекты и действия.
CAS, pinned inputs, идемпотентность и unknown outcome обязательны; поздний job
не перезаписывает head. Gemini наблюдает реальное видео, не утверждает финал.
Человек утверждает exact язык/version/MP4 hash в authenticated UI. Просмотр
черновика не требует approval. Автоматической публикации в соцсети нет.

## Обоснование

Состояние и доработки должны переживать закрытие harness и браузера; один
продукт сохраняет общий review UX и доступ к медиа. Human approval нельзя
подменять выбором кандидата, technical-pass или оценкой модели.

## Отклонённые альтернативы

Старое приложение в iframe как окончательная интеграция; второй cloud agent
orchestrator; секреты в code worker; удаление source repo до проверки переноса.

## Последствия

Выполнить manifest old→new refs, hash/metadata verification и перенос issues.
Не затрагивать существующие Canvas данные и unrelated backlog. Архивировать
Reels только после приёмки; физическое удаление — отдельное подтверждение.
Денежную бюджетную подсистему не строить; concurrency/cancel/recovery нужны.
Live creative pilot не равен fixture pass и не обещает охватов.

## Как проверить

Изолированный fixture RU/UZ → shot/media → render → preview → time/region
feedback → RU-only revision; restart, stale completion, paused loop, duplicate
operation, unknown provider result; отдельный human approval точного MP4.
Перед deploy проверить контейнерные зависимости, единый SHA, Convex push,
оба MCP endpoint, OAuth/ACL, существующие Canvas-сценарии и rollback handles.
