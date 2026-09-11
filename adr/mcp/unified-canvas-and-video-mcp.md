---
id: unified-canvas-and-video-mcp
title: Canvas и Video Studio используют один MCP endpoint и единый каталог
status: accepted
date: 2026-09-11
deciders: [diyorkhaydarov]
area: mcp
applies_to:
  - apps/mcp/**
  - apps/web/server.mjs
  - apps/web/server.test.js
  - apps/web/src/components/ConnectPanel.tsx
  - scripts/video-integration-smoke.mjs
  - .agents/skills/video-production/**
  - docs/VIDEO-OPERATIONS.md
  - docs/VIDEO-PLAN.md
  - README.md
tags: [mcp, video, execute, discovery]
refs:
  - canvas-and-video-endpoints.md
supersedes: [canvas-and-video-endpoints]
superseded_by: []
---

## Контекст

Пользователь запросил цельный MCP для Canvas и Video Studio и переход локальных
клиентов на одно подключение после деплоя. Два endpoint разделяли каталог, хотя
использовали общие identity, assets и backend.

## Решение

Единственный публичный MCP endpoint — `/mcp`. В нём опубликован общий каталог
Canvas, Video Studio и общих операций. Общие tools регистрируются один раз;
типизированные предметные имена и схемы сохраняются. Старый Video route удаляется
без alias. Web proxy пропускает точный путь `/mcp`, сохраняя stateless POST-only
транспорт и проверку bearer token.

Direct calls и `execute` используют общий каталог и одни handlers. Объединение
не отменяет guards, CAS, idempotency, effect accounting и запрет вложенного
`execute`/`canvas_run`. Отдельные search/describe-tools не добавляются: discovery
остаётся у harness, подробные материалы — в resources.

Локальные подключения переводятся на один endpoint только после проверки
развёрнутого общего каталога. Существующие credentials сохраняются без публикации
в чат или репозиторий. Объединение транспорта не пересоздаёт media или проекты.

## Обоснование

Это явное продуктовое решение пользователя. Одно подключение даёт агенту доступ
к общему рабочему пространству и устраняет дублирование общих tools в клиенте.

## Отклонённые альтернативы

Сохранение двух отдельных endpoint заменено текущим запросом пользователя.
Универсальный dispatcher вместо предметных инструментов не требуется.

## Последствия

Клиенты с отдельным Video подключением должны обновить конфигурацию после релиза.
Изменения registry, instructions, proxy, setup guidance и smoke checks выпускаются
вместе. Правила provider secrets, человеческого approval и runtime isolation
остаются прежними.

## Как проверить

Один SDK client получает Canvas и Video tools без повторяющихся имён, вызывает
обе группы и использует их через `execute`. Exact-route tests отклоняют старый
Video route и неподдерживаемые методы. Проверить resources, auth и существующие
Canvas сценарии до обновления локальных конфигураций.
