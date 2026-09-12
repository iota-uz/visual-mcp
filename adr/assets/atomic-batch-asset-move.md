---
id: atomic-batch-asset-move
title: Перенос ассетов пакетный по умолчанию и атомарный
status: accepted
date: 2026-09-12
deciders: [diyorkhaydarov]
area: assets
applies_to:
  - convex/schema.ts
  - convex/assets.ts
  - convex/agentGateway.ts
  - apps/mcp/src/tools.ts
  - apps/mcp/src/video/canvas-catalog.ts
  - apps/web/src/components/AssetMoveDrawer.tsx
  - apps/web/src/routes/Assets.tsx
  - apps/web/src/styles/surfaces/assets.css
  - README.md
tags: [assets, workspaces, batch, idempotency]
refs: []
supersedes: []
superseded_by: []
---

## Контекст

Одиночный `asset_move` переносил один ассет между библиотеками. Пользователю
нужно переносить выбранный набор из одного workspace в другой, а отдельные
single и batch tools создавали бы два конкурирующих контракта одной задачи.

## Решение

`asset_move` принимает от одного до ста workspace asset refs и всегда работает
как атомарный batch. Один ассет передаётся массивом длины один. Все refs обязаны
принадлежать явно указанному source workspace. Любой invalid ref, duplicate,
archived asset или slug collision блокирует весь batch и возвращается в общем
структурированном списке; overwrite и auto-rename отсутствуют.

Успешная операция меняет workspace у существующих asset records, но не копирует
bytes, не создаёт revisions и не меняет tags или provenance. Старые refs больше
не разрешаются, а bindings по asset/version IDs остаются действительными.
Успех записывается под principal и idempotency key вместе с полным отображением
старых refs в новые; неизменный повтор возвращает сохранённый результат.

UI использует тот же mutation и отдельный read-only preflight. Selection mode,
destination drawer и подтверждение раскрываются последовательно; пользователь
видит коллизии и изменение refs до записи.

## Обоснование

Один batch-first tool покрывает одиночный и массовый сценарий без разрастания
MCP-каталога. Атомарность исключает наполовину перенесённую библиотеку, а
идемпотентность делает безопасным повтор после неопределённого transport outcome.

## Отклонённые альтернативы

Сохранить отдельный single tool; перемещать по одному с частичным успехом;
молча пропускать коллизии; автоматически переименовывать или перезаписывать
целевые ассеты; копировать object-store bytes.

## Последствия

Старый singular input `asset_ref` удалён без compatibility layer. Максимум сто
элементов соответствует одной видимой странице библиотеки и удерживает работу в
одной Convex transaction. Для более крупных объёмов потребуется отдельный
durable job, а не скрытая пакетная нарезка с частичными результатами.

## Как проверить

Перенести один и несколько ассетов; проверить all-or-nothing при коллизии,
same-key replay и key/input conflict, неизменные versions/object keys/tags,
неразрешимость старых refs, работоспособность bindings, UI keyboard selection,
direct MCP контракт и отказ cross-workspace вызова внутри scoped `execute`.
