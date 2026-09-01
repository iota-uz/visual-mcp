---
id: static-preview-cards-not-embedded-viewers
title: Публичное встраивание — статическая PNG-карточка со ссылкой, а не iframe-viewer
status: accepted
date: 2026-08-25
deciders: [diyorkhaydarov]
area: sharing
applies_to:
  - docs/public-embeds.md
  - convex/embeds.ts
  - convex/http.ts
  - apps/mcp/src/tools.ts
  - apps/web/server.mjs
tags: [sharing, embeds, png, github]
refs:
  - https://github.com/iota-uz/visual-mcp/commit/d67a7284462d36129afb5b2a69a56e083799ad82
supersedes: []
superseded_by: []
---

## Контекст

GitHub и Markdown не исполняют интерактивный canvas viewer, но должны показывать
актуальный визуальный preview и вести на существующую public share surface.

## Решение

Embed — script-free PNG preview, обёрнутый ссылкой на public canvas, node или
artifact. Отдельный website iframe snippet и отдельный `/embed/:slug` viewer не
создаются. Latest preview следует опубликованным checkpoints; pinned preview
остаётся на выбранной версии. Приватизация или rotation public link отзывает
карточки вместе с основной ссылкой.

## Обоснование

Статическая карточка совместима с GitHub image proxy, CSP и обычным Markdown и
не создаёт вторую интерактивную поверхность с отдельными auth/layout rules.

## Последствия

Интерактивность доступна после перехода по ссылке. Качество embeds зависит от
render queue, но публичная семантика остаётся привязана к checkpoint.

## Как проверить

Скопировать `github_markdown`, открыть изображение без JavaScript, перейти по
ссылке, затем приватизировать canvas и убедиться, что обе public surfaces
перестали обслуживаться.
