---
id: task-shaped-tools-and-progressive-disclosure
title: MCP сохраняет task-shaped инструменты и progressive disclosure
status: accepted
date: 2026-08-23
deciders: [diyorkhaydarov]
area: mcp
applies_to:
  - apps/mcp/src/tools.ts
  - apps/mcp/src/instructions.ts
  - apps/mcp/src/guides.ts
  - apps/mcp/test/**
tags: [mcp, tool-routing, progressive-disclosure]
refs:
  - https://github.com/iota-uz/visual-mcp/commit/12e0d2022f7f4586dcd50568ee8f831a507af812
  - docs/adr/001-mcp-surface-and-progressive-disclosure.md
supersedes: []
superseded_by: []
---

## Контекст

У операций canvas, page, node, component, comment и asset различаются проверки,
побочные эффекты, повторяемость и concurrency guards. Старый flat CRUD surface
уже сокращался, но один универсальный execute-инструмент скрыл бы эти различия
от routing-модели и от авторизации.

## Решение

Сохранять инструменты, названные по атомарной задаче. Новый инструмент допустим,
только если у него отдельный контракт и routing cases; иначе расширяется схема
существующего инструмента. Большие руководства, темы и примеры выдаются через
MCP resources по запросу: сначала компактный каталог, затем выбранный ресурс.

## Обоснование

Явная операция делает видимыми side effects, retry semantics и guards. Это
улучшает маршрутизацию, авторизацию и наблюдаемость, а progressive disclosure не
загружает шаблоны и длинные примеры до того, как они понадобились.

## Отклонённые альтернативы

- Один generic execute tool: отклонён, потому что прячет разные контракты.
- Включать source каждого template в каталог: отклонено из-за стоимости
  контекста; каталог содержит только данные для выбора.

## Последствия

Размер surface сам по себе не является дефектом. Его рост должен подтверждаться
положительными и отрицательными routing tests. Целевые пороги исходного ADR:
не менее 90% recall и 95% negative precision.

## Как проверить

Проверить `docs/adr/001-mcp-surface-and-progressive-disclosure.md`, регистрацию
в `apps/mcp/src/tools.ts` и routing evals в `evals/production-ui/`.
