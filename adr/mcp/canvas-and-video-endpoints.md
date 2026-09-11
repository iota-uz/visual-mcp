---
id: canvas-and-video-endpoints
title: Canvas и Video Studio имеют отдельные MCP endpoints и общий service layer
status: superseded
date: 2026-09-10
deciders: [diyorkhaydarov]
area: mcp
applies_to:
  - apps/mcp/**
  - apps/web/server.mjs
  - apps/web/server.test.js
  - packages/runtime/src/**
tags: [mcp, video, execute, discovery]
refs:
  - ../../docs/VIDEO-PLAN.md
supersedes: []
superseded_by: [unified-canvas-and-video-mcp]
---

## Контекст

Video tools нужны не каждому Canvas клиенту. Пользователь согласовал отдельный
endpoint и отверг дублирование discovery, уже имеющегося в harness.

## Решение

`/mcp` обслуживает Canvas и общие image operations; `/mcp/video` — Video Studio.
Общие assets/comments/jobs и execute используют одни handlers, auth и данные.
Web reverse proxy пропускает ровно эти пути, не generic prefix/proxy dispatcher.
Существующая stateless POST-only политика транспорта сохраняется.

Нет server search_tools/describe_tools, aliases или скрытого catalog lookup.
Операции tools.* также опубликованы в стандартном tools/list этого endpoint;
bindings и схемы происходят из одного registry. Пока capability не реализована,
она не рекламируется как рабочий tool.

Execute переиспользует runtime canvas_run; canvas_run управляет файлами/doc,
execute композирует domain tools. Вложенный execute/canvas_run запрещён.
Пользователь принял внутренние ограничения worker_threads + node:vm: отдельная
microVM не является release prerequisite, но это не hostile-code boundary.
Сеть сохраняется; tool_access:read_only ограничивает broker, не arbitrary HTTP.
Provider keys отдельно от code process; effect accounting — broker_only.

## Обоснование

Отдельный каталог оставляет видео опциональным без второго backend/бакета.
Harness discovery устраняет ненужную цепочку поиска сигнатур. Runtime reuse
не обещает exactly-once внешнего HTTP, RSS quota или защиту microVM.

## Отклонённые альтернативы

Скрытый tools registry с новым search; отдельный Higgsfield MCP endpoint;
обязательная новая VM до внутреннего первого выпуска.

## Последствия

Обновлять route/proxy и tool registration вместе; partial release proxy сам
по себе не доказывает работающий video registry. Typed errors сообщают effect
и конкретное recovery, CAS требует reread/recompute, unknown paid dispatch
никогда не советует слепой повтор. Решения разделов 13–14 плана приоритетны.

## Как проверить

Exact route/auth/body forwarding; unsupported path/method отказ; реальное
tools/list и calls на обоих endpoint; direct/broker одинаковый handler;
нет approve/search/describe tools, нет provider secrets в code process.
