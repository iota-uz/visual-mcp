---
id: hosted-remote-mcp-only
title: Продукт использует hosted remote MCP; локальный stdio runtime удалён
status: accepted
date: 2026-08-09
deciders: [diyorkhaydarov]
area: platform
applies_to:
  - apps/mcp/**
  - packages/runtime/**
  - README.md
  - PLAN.md
tags: [mcp, hosted-service, compatibility]
refs:
  - https://github.com/iota-uz/visual-mcp/commit/0bf0e03f563b567cfbd4f1772f4d76642d7a725d
  - https://github.com/iota-uz/visual-mcp/commit/9a736358216596f3c86d909f41954dee608a169a
supersedes: []
superseded_by: []
---

## Контекст

Первоначальный single-user stdio runtime хранил sessions и artifacts локально.
Hosted продукт уже имел общие URLs, auth и durable storage, поэтому два runtime
контракта расходились.

## Решение

Remote MCP на официальном SDK является единственной продуктовой MCP surface.
Локальный stdio server, session store и `.claude-plugin` удалены без
compatibility shim. `packages/runtime` сохраняет только reusable render,
template, theme и sandbox internals.

## Обоснование

Два MCP runtime создавали бы двойную семантику refs, storage и lifecycle.
Hosted service является дифференциатором продукта и даёт долговечные share URLs.

## Последствия

Старый `npx github:iota-uz/visual-mcp` не поддерживается. Локальная разработка
поднимает hosted-shaped stack, а не возвращает stdio API.

## Как проверить

В репозитории нет stdio server/session-store imports; README подключает клиента
к HTTP endpoint `/mcp`.
