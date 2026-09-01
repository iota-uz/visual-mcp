---
id: unified-assets-and-media-boundaries
title: Медиа из /assets становится переиспользуемым, SVG доверяется, audio не поддерживается
status: accepted
date: 2026-08-29
deciders: [diyorkhaydarov]
area: assets
applies_to:
  - apps/mcp/src/assets.ts
  - apps/mcp/src/tools.ts
  - convex/assets.ts
  - convex/schema.ts
  - packages/runtime/src/**
tags: [assets, svg, media, storage]
refs:
  - https://github.com/iota-uz/visual-mcp/commit/4b2b09ab0d5d84df84941f1da88e65d4a4502b1f
  - https://github.com/iota-uz/visual-mcp/commit/bbf7703c1eed6f3f1f2cdf526bde9d4ac74477f0
supersedes: []
superseded_by: []
---

## Контекст

Отдельные canvas assets и library assets создавали два жизненных цикла и
лишние операции promotion. Одновременно продукт работает с доверенным
внутренним SVG-контентом `@iota.uz`; audio не входит в продуктовую поверхность.

## Решение

Поддерживаемое медиа, сохранённое под `/assets`, автоматически получает
immutable workspace asset revision и binding в canvas. `/src` и `/output`
остаются canvas-local. SVG из workspace сохраняется побайтово без sanitation
или rewrite. Audio не поддерживается ни в upload/import/storage, ни в UI, MCP,
fixtures и документации.

## Обоснование

Одна asset model позволяет повторно использовать байты без ручного promotion.
Переписывание доверенного SVG меняло бы авторский asset. Добавление audio
расширило бы все слои продукта без подтверждённого use case.

## Последствия

Существующие assets адресуются immutable `asset://` refs. Безопасность внешнего
импорта и MIME checks сохраняется, но внутренний SVG не санитизируется. Новая
audio-функция требует отдельного решения, а не локального расширения enum.

## Как проверить

Сохранить SVG под `/assets`, проверить неизменный content hash и возвращённый
`asset_ref`; схемы и тесты не должны принимать audio MIME.
