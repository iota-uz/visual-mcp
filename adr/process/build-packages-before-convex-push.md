---
id: build-packages-before-convex-push
title: Convex публикуется только после сборки workspace-пакетов
status: accepted
date: 2026-08-23
deciders: [diyorkhaydarov]
area: process
applies_to:
  - package.json
  - packages/canvas/**
  - packages/runtime/**
  - convex/**
tags: [deploy, convex, build, generated-artifacts]
refs:
  - https://github.com/iota-uz/visual-mcp/commit/ad825c60d920bfef295d9360c84fb1cd42d38399
supersedes: []
superseded_by: []
---

## Контекст

Convex imports `@visual-canvas/canvas` и `@visual-canvas/runtime` из gitignored
`dist`. Bare push однажды отправил устаревший build: сервер обслуживал 11
template resources при 12 в registry, и `device-frame-screen` отсутствовал.

## Решение

Публиковать Convex только через `npm run convex:push`, который сначала собирает
оба workspace package. Не использовать bare `convex dev --once` для shipping.

## Обоснование

Source tree не определяет фактически bundled bytes, пока зависимости читаются
из `dist`; обязательная сборка устраняет скрытую зависимость от локального
состояния.

## Последствия

Любой альтернативный deploy entrypoint обязан сохранить build-before-push.

## Как проверить

Проверить script `convex:push` в `package.json` и совпадение числа template
resources между registry и развёрнутым MCP после публикации.
