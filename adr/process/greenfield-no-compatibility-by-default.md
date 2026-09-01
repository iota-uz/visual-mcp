---
id: greenfield-no-compatibility-by-default
title: Green-field изменения заменяют старую модель целиком, если совместимость не запрошена
status: accepted
date: 2026-08-19
deciders: [diyorkhaydarov]
area: process
applies_to:
  - AGENTS.md
  - apps/**
  - convex/**
  - packages/**
tags: [greenfield, migrations, compatibility]
refs:
  - https://github.com/iota-uz/visual-mcp/commit/96f6f6fea012857022b5f8401c9d5c08edba36bc
  - https://github.com/iota-uz/visual-mcp/commit/aa8908998fa95b84de5042546599e7e379732b12
supersedes: []
superseded_by: []
---

## Контекст

Проект быстро меняет ещё не закреплённые модели. Compatibility layers, dual
reads/writes и legacy adapters увеличивают число состояний и мешают агентам
понимать актуальный контракт.

## Решение

По умолчанию выбирать чистую target architecture, делать breaking schema/API
change, удалять superseded implementation и обновлять все internal callers,
validators, fixtures, templates, docs и tests в одном изменении. Совместимость
и сохранение конкретных production data добавляются только по явному запросу.

## Обоснование

В green-field фазе цена постоянной совместимости выше цены пересоздания
development data; одна актуальная модель проще и надёжнее.

## Последствия

Нельзя добавлять fallback «на всякий случай». Но это решение не разрешает
случайно удалять намеренные свойства текущего контракта: сначала нужно проверить
ADR, включая reinforcement MCP descriptions.

## Как проверить

При schema/API replacement отсутствуют legacy adapters и dual paths, а все
репозиторные callers и tests используют новую модель.
