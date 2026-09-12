---
id: video-studio-quiet-workbench
title: Весь Video Studio — тихий инструмент, без костюма монтажной
status: accepted
date: 2026-09-12
deciders: [diyorkhaydarov]
area: product
applies_to:
  - apps/web/src/routes/VideoStudio.tsx
  - apps/web/src/components/video/**
  - apps/web/src/styles/surfaces/video.css
  - apps/web/src/styles/surfaces/video-shell.css
  - apps/web/src/styles/surfaces/video-storyboard.css
  - apps/web/src/styles/surfaces/video-shots.css
  - apps/web/src/styles/surfaces/video-timeline.css
  - apps/web/src/styles/surfaces/video-review.css
  - apps/web/src/styles/surfaces/video-production.css
tags: [product, video-studio, design-language]
refs: [video-studio-quiet-instrument, video-studio-workbench]
supersedes: []
superseded_by: []
---

## Контекст

`video-studio-quiet-instrument` задал язык для Review: Manrope, бумага,
чернила, тёмная шахта только вокруг 9:16. Story, Shots, Timeline и
inspector остались в костюме монтажной — Fraunces, ALL-CAPS кикеры,
хлопушка, перфорация, vs-rise, градиентный callout. Тот же продукт не
должен менять голос на каждом шаге workflow.

## Решение

Тихий инструмент действует на весь workbench Story → Shots → Timeline →
Review, inspector и Production:

- display-гарнитура на поверхностях студии — body (Manrope), не Fraunces;
- моно — только таймкод, кадр, хеш, индекс;
- без хлопушки, перфорации, штамповых ALL-CAPS, hover-lift и vs-rise;
- карточки — 1px line, без drop-shadow как личности, без градиентных моек;
- inspector callout — бумага и действие, не акцентная реклама;
- Review-шахта остаётся единственным тёмным материалом.

Глобальные `.badge` / `.btn`, Home, Canvas и sidebar не входят в это
решение. Контрактные ink/paper/accent не меняются. Workbench-контракт
(режимы, exact-MP4, annotation-режим, Production drawer) не меняется.

## Обоснование

Костюм на части режимов читается как другой продукт. Distinctiveness у
вертикального ролика — кадр в Review, не сериф на формах Story.

## Отклонённые альтернативы

Новая тема на Story/Shots/Timeline. Полностью тёмная студия. Оставить
костюм «пока Review не примут».

## Последствия

`--app-stripes` и `@keyframes vs-rise` не используются студией. Fraunces
остаётся в `index.html` для не-studio заголовков приложения.

## Как проверить

Desktop и 390 px: Story, Shots, Timeline, Review — один шрифт и плотность;
нет хлопушки/перфорации/vs-rise; inspector без градиента; reduced-motion
без hover-сдвига; Review-шахта на месте.
