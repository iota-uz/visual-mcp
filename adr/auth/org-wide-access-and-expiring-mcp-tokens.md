---
id: org-wide-access-and-expiring-mcp-tokens
title: Доступ ограничен организацией, права общие внутри неё, MCP tokens живут 90 дней
status: accepted
date: 2026-08-14
deciders: [diyorkhaydarov]
area: auth
applies_to:
  - convex/auth.ts
  - convex/lib/auth.ts
  - convex/tokens.ts
  - convex/workspaces.ts
  - convex/canvases.ts
  - apps/mcp/src/index.ts
tags: [auth, authorization, tokens, organization]
refs:
  - https://github.com/iota-uz/visual-mcp/commit/55dd64a3cae053cf8e24af416ffc7e6069198cb1
  - https://github.com/iota-uz/visual-mcp/commit/9a736358216596f3c86d909f41954dee608a169a
supersedes: []
superseded_by: []
---

## Контекст

Visual Canvas — внутренний single-organization продукт. Creator-scoped ACL
мешал бы совместной работе, а бессрочный MCP bearer token переживал бы уход
сотрудника независимо от состояния Google account.

## Решение

Google sign-in допускает только verified `@iota.uz` identity и проверяет `hd` и
`email_verified` server-side. Внутри организации нет ACL, invites и ролей:
любой authenticated пользователь или valid MCP token может читать и изменять
общие workspaces/canvases, а `createdBy` служит attribution, не ownership guard.
Private означает доступ организации; public означает unguessable slug без
login. MCP tokens истекают через 90 дней и могут быть отозваны.

## Обоснование

Модель соответствует общей внутренней рабочей поверхности и избегает ложного
ощущения creator ownership. Ограниченный lifetime bearer token создаёт
независимую границу доступа после ухода сотрудника.

## Последствия

Добавление tenant/owner authorization, roles или configurable token lifetime —
изменение продукта и требует нового ADR. Проверка client-supplied OAuth `hd`
hint без server-side claims недостаточна.

## Как проверить

Auth tests отклоняют неверный hosted domain и unverified email; workspace tests
показывают org-wide access; token становится недействительным ровно на
`expiresAt` и после revoke.
