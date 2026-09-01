---
id: isolated-local-agent-stack
title: Агенты проверяют продукт на изолированном локальном стеке, не на live deployment
status: accepted
date: 2026-08-19
deciders: [diyorkhaydarov]
area: process
applies_to:
  - scripts/dev-agent.mjs
  - convex/lib/devAuth.ts
  - convex/seed.ts
  - apps/web/src/dev/**
  - AGENTS.md
tags: [development, agents, auth, safety]
refs:
  - https://github.com/iota-uz/visual-mcp/commit/ab375fd169f09594f604163094d12fc0d301de02
supersedes: []
superseded_by: []
---

## Контекст

Все authenticated surfaces требуют Google OAuth для `@iota.uz`, а live
deployment одновременно является dev deployment. Проверка через него меняла
shared state, требовала человека и сталкивалась с production CSP.

## Решение

Агенты запускают `npm run dev:agent`: отдельный local Convex backend, локальные
origin/env, deterministic seed и gated dev auth. `.env.local` snapshot/restore
защищает live pointer. Fixture mode отдельно воспроизводит loading/error/empty.
`SITE_URL` и `SPA_ORIGIN` live deployment не меняются.

## Обоснование

Stack воспроизводим без human sign-in и не затрагивает общую deployment state.
Два независимых gates не позволяют dev auth попасть в production случайно.

## Последствия

Локально нет render worker: render request может вернуть `partial`, сохранив
content. Это ограничение теста, а не повод обращаться к live deployment.

## Как проверить

Запустить stack, открыть `/dev/sign-in?auto=1` одной навигацией и проверить
seeded canvas. Production build не должен содержать dev sign-in surface.
