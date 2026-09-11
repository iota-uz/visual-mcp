---
id: video-backend-contract-health-gate
title: MCP становится healthy только с совместимым Convex Video backend
status: accepted
date: 2026-09-11
deciders: [unknown]
area: platform
applies_to:
  - apps/mcp/src/index.ts
  - apps/mcp/src/gateway.ts
  - apps/mcp/src/video/registry.ts
  - convex/agentGateway.ts
  - convex/video.ts
tags: [video, convex, railway, deployment, recovery]
refs:
  - production incident 2026-09-11
supersedes: []
superseded_by: []
---

## Контекст

MCP принимал строковый `workspace_id`, но backend validator ожидал только Convex ID.
Корректный slug отклонялся до handler и превращался gateway fallback в ложный
`BACKEND_UNAVAILABLE`. Одновременно Railway `/healthz` проверял только процесс и не
мог обнаружить несовместимость отдельно публикуемых MCP и Convex contracts.

## Решение

Private agent gateway публикует номер Video backend contract. MCP `/healthz`
проверяет точное ожидаемое значение через тот же Convex boundary и возвращает 503,
если backend недоступен или несовместим. Convex публикуется первым через
`npm run convex:push`; только после этого Railway может сделать matching MCP healthy.

`video_project_create` до dispatch вычисляет стабильный receipt из workspace,
имени операции и исходного idempotency key. Exact lookup возвращает сохранённый
результат или честное состояние `unknown`; новый ключ не используется для recovery.
Create/list/reconciliation разрешают точный workspace ID или slug и выполняют
resolution до основной операции.

## Обоснование

Process-only health не обнаруживает раздельный deploy двух частей контракта.
Версионированная проверка не требует production write probe и не создаёт данные.
Детерминированный receipt остаётся известен клиенту даже при потерянном HTTP-ответе.

## Отклонённые альтернативы

Считать успешный Railway deploy доказательством готовности Convex; повторять create
с новым ключом; восстанавливать результат приблизительным поиском по списку проектов.

## Последствия

Нельзя публиковать MCP раньше совместимого Convex backend. Если Convex недоступен,
Railway сохраняет предыдущую healthy ревизию. После deploy всё равно нужны
authenticated smoke calls: health проверяет совместимость, а не весь workflow.

## Как проверить

Запустить MCP transport tests и `convex/agentGateway.test.ts`, затем убедиться, что
`/healthz` возвращает 503 без contract version 1 и 200 с ним. Потерянный ответ create
должен согласоваться через `video_operation_get`, а same-key replay не создаёт дубль.
