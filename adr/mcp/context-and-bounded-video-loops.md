---
id: context-and-bounded-video-loops
title: Видео-контекст и bounded loop хранят состояние, а не reasoning
status: accepted
date: 2026-09-10
deciders: [diyorkhaydarov]
area: mcp
applies_to:
  - convex/videoWorkflow.ts
  - convex/lib/videoWorkflow.ts
  - packages/video/src/workflow.ts
  - apps/mcp/src/video/workflow.ts
tags: [context-engineering, loop-engineering, hitl]
refs:
  - ../../docs/VIDEO-PLAN.md
supersedes: []
superseded_by: []
---

## Контекст

Пользователь требует переноса workflow из claude-reels, scoped subagents,
независимой оценки настоящего видео и долговечного self-improvement цикла.
Старая SQLite реализация содержит полезные guards, но не становится сервисом.

## Решение

Convex хранит immutable profile revisions, exact-version context, evidence
receipts и bounded language loops. Harness выбирает субагентов и каждый следующий
шаг. Reader не запускает reasoning. Claude/Codex wrappers остаются раздельными.

Sourced означает attributed, не доказанную истину. Unknown — null. Текущие
явные указания человека важнее profile/memory suggestions. Context имеет role,
scene/shot scope, соседние сцены, revision hash, byte limit и явные omissions.
Blind critic не получает самооценку/сценарий автора и прошлые scores; отдельный
reviewer проверяет соответствие brief. Это не защита от mislabeling вызывающим.

Proposal расходует один ограниченный раунд, сохраняет гипотезу, selected reference,
rubric/workflow и input revision. Select требует текущего descendant checkpoint,
exact matching media hashes, technical + independent real-video evidence без
неразрешённой uncertainty. Revert сохраняет прежний выбор и увеличивает
no-progress. Только trusted provider/worker action регистрирует evidence;
agent-authored pass не открывает gate. Select никогда не создаёт human approval.

Pause запрещает новые producer dispatches; running effect может завершиться.
Agent не отменяет human pause. Resume не сбрасывает счётчики и не запускает агента.
Human feedback атомарно инвалидирует решения по старым inputs.

## Обоснование

Общие direct/broker handlers и долговечные CAS receipts обеспечивают одинаковую
семантику при перезапуске harness и UI. Guard не доказывает творческую полезность:
это отдельный empirical pilot, без обещаний будущих охватов.

## Отклонённые альтернативы

SQLite sidecar, скрытый reasoning daemon, self-reported pass, отождествление
agent selection с human approval, сброс iteration limit через resume.

## Последствия

Нужны реальные provider report receipts, migration initializer для старых
проектов, UI replan для новых human inputs и отдельно измеренные quality trials.
Отсутствующие context sections помечаются, не заменяются выдуманными данными.

## Как проверить

`convex/videoWorkflow.test.ts` проверяет profile pins, CAS/replay, uncertainty,
no-progress, human input invalidation и запрет подделки evidence. MCP workflow
tests используют настоящий SDK HTTP transport и общие broker handlers.
