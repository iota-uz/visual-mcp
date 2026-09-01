---
paths:
  - "adr/**"
  - "ADR.md"
---

# Architecture Decision Records

`ADR.md` at the repository root is the index. Records live in
`adr/<area>/<slug>.md`. The ledger exists to prevent an agent from accidentally
undoing intentional behavior after seeing only its local cost or complexity.

## When a record is required

- A choice between viable options has lasting consequences.
- A product, security, storage, protocol, or authoring rule becomes part of the
  system contract.
- A previous decision is superseded or reversed.
- Code ownership moves between services or packages.
- A user answer changes architecture, an agent-facing workflow, or product
  behavior.

Routine fixes and behavior-preserving refactors belong in git. Deployment work
belongs in the relevant runbook. Unresolved proposals belong in an issue.

## Areas

| Area | Covers |
| --- | --- |
| `mcp` | tool surface, schemas, routing guidance, resources, agent protocol |
| `canvas` | CanvasFile/CanvasDoc, pages, prototypes, drafts and checkpoints |
| `assets` | asset storage, imports, bindings, supported media |
| `sharing` | public links, previews, embeds, publication semantics |
| `auth` | browser and MCP identity, organization access |
| `platform` | Convex/Railway/worker boundaries and cross-cutting infrastructure |
| `product` | durable product-surface choices spanning technical areas |
| `process` | development, deployment, and the ADR ledger itself |

Cross-cutting records go in the area where their main effect lives and must
list every governed path in `applies_to`.

## Record format

```markdown
---
id: stable-slug
title: Краткое название решения
status: accepted # proposed | accepted | superseded | reversed
date: 2026-09-01
deciders: [unknown]
area: mcp
applies_to:
  - apps/mcp/**
tags: [mcp, agent-ux]
refs:
  - https://github.com/iota-uz/visual-mcp/commit/<sha>
supersedes: []
superseded_by: []
---

## Контекст

## Решение

## Обоснование

## Отклонённые альтернативы

## Последствия

## Как проверить
```

Records are written in Russian; front matter keys and enum values stay in
English. `date` is when the decision was made, not when it was reconstructed.
Use `unknown` when the source does not identify a decider. Do not invent
rationale or alternatives. Every `applies_to` entry must match a real path.

## Lifecycle and index

The lifecycle is `proposed` -> `accepted` -> `superseded` or `reversed`.
History is never deleted. A replacement sets `supersedes` on the new record and
`superseded_by` plus the terminal status on the old one.

`ADR.md` is grouped by area, newest first. Each line has this shape:

```markdown
- **Название** — [запись](adr/mcp/stable-slug.md) · accepted · 2026-09-01 (refs)
```

Before changing behavior, read the matching area and run
`rg -l '<path-or-concept>' adr/ ADR.md` to find cross-cutting decisions.
