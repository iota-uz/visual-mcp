---
id: stable-refs-idempotency-and-concurrency-guards
title: Стабильный ref, идемпотентное сохранение и явные guards образуют контракт записи
status: accepted
date: 2026-08-14
deciders: [diyorkhaydarov]
area: mcp
applies_to:
  - apps/mcp/src/tools.ts
  - apps/mcp/src/refs.ts
  - convex/canvases.ts
tags: [mcp, idempotency, concurrency, addressing]
refs:
  - https://github.com/iota-uz/visual-mcp/commit/335551a6e2c8ea31992a22af52cba589f7309607
  - https://github.com/iota-uz/visual-mcp/commit/bb844dc0cf6a4f11cab1175025d8c40bd1ce1b35
supersedes: []
superseded_by: []
---

## Контекст

Ранний CRUD workflow требовал много вызовов и при повторе мог создавать
`slug-2`. Параллельные правки без version/hash guards перетирали изменения.

## Решение

Один стабильный `ref` адресует canvas. `canvas_save` делает upsert по ref и
идемпотентен при тех же аргументах. Инкрементальные записи используют явные
`expected_version`, `expected_draft_revision` и content hashes там, где это
применимо; конфликт возвращается, а не разрешается скрытым last-write-wins.

## Обоснование

Повтор сетевого вызова не должен создавать новый объект, а конкурентная правка
не должна незаметно уничтожать работу другого агента.

## Последствия

Клиенты обязаны читать актуальную ревизию перед guarded write и после конфликта.
Схемы и ответы должны возвращать поля, необходимые для следующего безопасного
вызова.

## Как проверить

Запустить MCP tests для повторного `canvas_save` и stale revision/hash conflicts
в `apps/mcp/test/` и `convex/canvases.test.ts`.
