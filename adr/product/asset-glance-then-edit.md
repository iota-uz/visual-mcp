---
id: asset-glance-then-edit
title: Карточка ассета — превью и имя; метаданные по запросу
status: accepted
date: 2026-09-12
deciders: [diyorkhaydarov]
area: product
applies_to:
  - apps/web/src/routes/Assets.tsx
  - apps/web/src/styles/surfaces/assets.css
  - apps/web/src/components/AssetPreviewDialog.tsx
tags: [product, web-ui, assets]
refs: []
supersedes: []
superseded_by: []
---

## Контекст

Story и Shots уже glance-then-edit. Библиотека ассетов оставалась CMS: filename, MIME, байты, ревизия, ref и archive на каждой карточке, плюс баннер Import.

## Решение

Карточка — превью и имя. Теги остаются как фильтр. Ref, archive, правка — в меню ⋯ и в превью. Import URL — drawer, не баннер на странице. Размер библиотеки — одна строка.

## Обоснование

Ассеты — общая подложка канваса и видео; тот же принцип взгляда, что у Story/Shots.

## Отклонённые альтернативы

Оставить facts на карточке «для агентов» — человек курирует взглядом, ref копируется из меню.

## Последствия

Shared vs workspace libraries не меняются.

## Как проверить

`Assets.test.tsx`: превью, теги и archive из меню, компактный размер.
