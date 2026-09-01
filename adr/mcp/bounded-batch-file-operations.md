---
id: bounded-batch-file-operations
title: Файловые MCP-операции пакетируются внутри одной задачи, а поиск остаётся отдельным инструментом
status: accepted
date: 2026-09-01
deciders: [diyorkhaydarov]
area: mcp
applies_to:
  - apps/mcp/src/tools.ts
  - apps/mcp/src/editEngine.ts
  - apps/mcp/src/fileTools.ts
  - apps/mcp/test/**
  - evals/production-ui/**
tags: [mcp, tool-routing, batching, token-budget]
refs:
  - docs/audits/visual-canvas-mcp-agent-usage-2026-09-01/README.md
supersedes: []
superseded_by: []
---

## Контекст

Реальные агентские сессии тратили лишние round trips на чтение и точечное
изменение нескольких файлов. При этом объединение поиска, чтения и изменения в
один универсальный инструмент противоречило бы принятой task-shaped поверхности
и сделало бы side effects менее заметными.

## Решение

Пакетировать повторения одной и той же атомарной задачи с жёсткими лимитами:
`canvas_file_get` читает до 20 проекций, а `canvas_edit` применяет до 50 точных
замен по нескольким файлам одной транзакцией. Внутри каждой записи везде
используется поле `path`. Любая ошибка отменяет весь write batch.

Поиск source-текста оформить отдельным read-only `canvas_file_search`, потому
что у него самостоятельное намерение, лимиты сканирования и routing cases.
Полный или regex-подобный универсальный query language не добавлять.

## Обоснование

Batch сокращает повторяющиеся tool calls и повторную передачу `ref`, version и
метаданных, не скрывая тип операции. Отдельный поиск позволяет сначала вернуть
короткие совпадения, а затем прочитать только нужные диапазоны, экономя output
tokens. Ограничения по числу файлов и байтам сохраняют предсказуемый контекст.

## Отклонённые альтернативы

- Один `canvas_files` для поиска, чтения и записи: отклонён из-за смешения
  side effects и ухудшения маршрутизации.
- Сохранить только одиночные операции: отклонено из-за измеренного round-trip и
  token overhead в многофайловых задачах.
- Неограниченный batch: отклонён из-за непредсказуемого размера ответа.

## Последствия

Это green-field breaking contract: внутренние callers, документация и eval
обновляются одновременно, legacy aliases не поддерживаются. Будущие увеличения
лимитов должны учитывать размер контекста и latency.

## Как проверить

Запустить MCP unit/type tests и routing evals. Проверить атомарный rollback,
диапазоны чтения, общий response cap, search truncation и выбор между
`canvas_file_search`, `canvas_file_get`, `canvas_edit`, `canvas_apply_patch`.
