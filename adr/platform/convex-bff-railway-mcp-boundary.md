---
id: convex-bff-railway-mcp-boundary
title: Convex хранит данные и обслуживает BFF, а stateless MCP работает в Railway
status: accepted
date: 2026-08-23
deciders: [diyorkhaydarov]
area: platform
applies_to:
  - convex/agentGateway.ts
  - convex/http.ts
  - apps/mcp/**
  - apps/web/server.mjs
  - apps/worker/**
tags: [convex, railway, mcp, service-boundary]
refs:
  - https://github.com/iota-uz/visual-mcp/commit/688d884d293174d01a2ff94560f189cf2467ffa0
supersedes: []
superseded_by: []
---

## Контекст

Долгоживущий streaming MCP transport плохо соответствовал Convex httpAction.
При этом Convex уже владел моделью данных, auth и public delivery, а Railway —
worker и web service.

## Решение

Convex остаётся database и BFF: auth, metadata, versions, bindings, public
routes и короткие allowlisted agent gateway calls. Stateless MCP protocol и
tool runtime работают отдельным Railway service. Web service проксирует
канонический `https://canvas.iota.uz/mcp` через private network. Render/exec
выполняет отдельный Railway worker.

## Обоснование

Граница оставляет durable state в Convex и не держит MCP connection внутри
serverless action. Fixed gateway уменьшает доступную MCP service поверхность.

## Последствия

Новый MCP capability должен быть явно открыт в agent gateway. Изменения tool
runtime деплоятся отдельно от Convex functions; public origin остаётся один.

## Как проверить

Проверить, что `apps/mcp` обращается к Convex только через gateway, а gateway
экспортирует ровно allowlisted functions с тестами в `convex/agentGateway.test.ts`.
