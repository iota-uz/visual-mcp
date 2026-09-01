---
id: repeated-routing-contract-for-context-freshness
title: Общий контракт маршрутизации повторяется в каждом описании инструмента ради свежести контекста
status: accepted
date: 2026-08-23
deciders: [unknown]
area: mcp
applies_to:
  - apps/mcp/src/tools.ts
  - apps/mcp/test/**
  - evals/production-ui/routing-run.mjs
  - evals/production-ui/routing-catalog.mjs
tags: [mcp, long-context, tool-routing, token-budget]
refs:
  - https://github.com/iota-uz/visual-mcp/commit/12e0d2022f7f4586dcd50568ee8f831a507af812
  - docs/audits/visual-canvas-mcp-agent-usage-2026-09-01/README.md
supersedes: []
superseded_by: []
---

## Контекст

`productionToolDescription` намеренно добавляет каждому MCP tool краткие блоки
`Use`, `Do not use`, `Prefer`, `Side effects`, `Retry` и `Errors`. Кроме этого,
подключённый Codex client показывает server instructions общим префиксом перед
описанием каждого tool. В длинном контексте инструкции, переданные один раз,
могут оказаться далеко от текущего выбора инструмента; локальное повторение
возвращает routing и safety contract в свежую часть контекста. Сопровождающий
проекта явно подтвердил этот мотив 2026-09-01 после аудита token usage.

## Решение

Не считать ни общий повторяемый префикс, ни per-tool routing reinforcement
безусловным token defect и не удалять их механически. Сохранять свежий короткий
контракт рядом с каждым tool, особенно side effects, retry и error expectations.
Подробные authoring rules, темы и примеры по-прежнему держать в server
instructions и MCP resources.

Оптимизацию проводить как измеряемый баланс: сокращать формулировки, убирать
только доказанно бесполезные повторы или адаптировать блок к конкретному tool,
но проверять routing quality и поведение в длинном контексте до изменения
контракта.

## Обоснование

Цена повторения платится при загрузке tool catalog, а польза проявляется позже,
когда модель выбирает и вызывает инструмент после большого объёма работы.
Суммарное число символов не измеряет эту пользу. Нужны сравнительные evals с
длинным контекстом, ошибочными соседними tools и retry/concurrency сценариями.

## Отклонённые альтернативы

- Полностью удалить общий prefix и оставить только server instructions:
  отклонено, потому что теряется freshness/reinforcement.
- Перенести весь контракт в каждый tool: отклонено; длинная документация должна
  оставаться progressive-disclosed.

## Последствия

P1 из аудита 2026-09-01 трактуется как задача найти баланс, а не как требование
удалить 119 928 повторяющихся символов. Любой будущий diff этого механизма
должен показать token delta и не ухудшить routing recall, negative precision,
выбор узкой операции и безопасный retry в long-context evals.

## Как проверить

Проверить `productionToolDescription` в `apps/mcp/src/tools.ts`, затем сравнить
полный и сокращённый варианты на одном versioned eval set, включая сценарии с
длинным контекстом. Не принимать изменение только по размеру tool catalog.
