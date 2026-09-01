---
id: run-code-network-risk-is-accepted
title: run_code сохраняет node:vm и network egress как принятый риск
status: accepted
date: 2026-08-09
deciders: [diyorkhaydarov]
area: platform
applies_to:
  - apps/worker/src/exec.ts
  - packages/runtime/src/sandbox/**
  - apps/mcp/src/tools.ts
  - PLAN.md
tags: [security, sandbox, network, accepted-risk]
refs:
  - https://github.com/iota-uz/visual-mcp/commit/9a736358216596f3c86d909f41954dee608a169a
supersedes: []
superseded_by: []
---

## Контекст

`run_code` исполняет agent-authored code через `node:vm`, который не является
security boundary. В актуальном разделе accepted risks PLAN для него явно
принят full network egress. При этом старый Part 2 PLAN содержит более строгую
формулировку; Part 1 описывает текущую hosted architecture и имеет приоритет.

## Решение

Сохранить текущую семантику `run_code`, включая network egress, как осознанный
риск. Основная mitigation — credential-free worker: без Convex deploy key и
storage keys, только короткоживущие URLs для одного canvas, плюс timeout,
memory limits и throwaway workspace.

## Обоснование

Ограничение сети изменило бы существующие authoring workflows. Изоляция blast
radius на уровне worker credentials сохраняет поведение при меньшем ущербе от
компрометации.

## Последствия

Нельзя описывать `node:vm` как надёжную песочницу. Запрет сети, allowlist или
другая isolation boundary являются отдельным security/product решением и
требуют повторной оценки совместимости. Token issuance остаётся реальным
access-control boundary.

## Как проверить

Проверить, что worker не получает постоянных Convex/S3 credentials, использует
короткоживущие scoped URLs, удаляет throwaway workspace и применяет resource
limits. Сопоставить результат с PLAN §10, а не со старым Part 2 §9.
