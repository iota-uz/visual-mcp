---
id: architecture-decisions-ledger
title: Решения ведутся в append-only ADR ledger, отдельном от истории реализации
status: accepted
date: 2026-09-01
deciders: [unknown]
area: process
applies_to:
  - ADR.md
  - adr/**
  - AGENTS.md
  - CLAUDE.md
  - .claude/rules/adr.md
tags: [process, adr, agents]
refs:
  - unknown
supersedes: []
superseded_by: []
---

## Контекст

Git хорошо хранит diff, но не гарантирует, что следующий агент увидит мотив
намеренной сложности перед локальной оптимизацией. Это проявилось, когда
повторяемые MCP instructions были посчитаны безусловным token defect без
сохранённого rationale о freshness в длинном контексте.

## Решение

Использовать систему Granite: корневой append-only индекс `ADR.md`, отдельные
records в `adr/<area>/`, path-scoped правило `.claude/rules/adr.md` и обязательный
указатель в `AGENTS.md` и `CLAUDE.md`. При замене решения добавляется новый record и
двунаправленная supersession link; старый record не переписывается и не удаляется.

Реконструированные записи опираются только на commit history, PLAN, README,
AGENTS и существующий `docs/adr/001...`; пробелы отмечаются `unknown`.

## Обоснование

Отдельные файлы уменьшают конфликтность параллельной работы, areas и
`applies_to` делают решения обнаружимыми рядом с кодом, а append-only lifecycle
сохраняет причины текущей формы системы.

## Отклонённые альтернативы

- Оставить решения только в PLAN и commit messages: отклонено, потому что они
  не всплывают механически перед правкой конкретного пути.
- Перенести существующий `docs/adr/001...` и удалить его: отклонено; исходный
  документ оставлен как историческое доказательство.

## Последствия

Любое новое долговечное решение добавляется вместе с изменением. Routine fixes
не требуют ADR. Исторические records могут уточняться только lifecycle metadata,
а не переписыванием rationale.

## Как проверить

Все ссылки из `ADR.md` существуют, front matter ids уникальны, а каждый
`applies_to` glob совпадает хотя бы с одним путём.
