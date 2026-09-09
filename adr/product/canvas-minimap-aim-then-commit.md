---
id: canvas-minimap-aim-then-commit
title: Карта канваса — прицел, затем commit; hover не двигает камеру
status: accepted
date: 2026-09-09
deciders: [diyorkhaydarov]
area: product
applies_to:
  - packages/canvas/src/viewport.ts
  - packages/canvas/src/theme.css
  - apps/web/src/lib/realtimeCanvas.test.ts
  - apps/web/src/lib/touchCanvas.test.ts
tags: [product, canvas, editor-ux, minimap]
refs: []
supersedes: []
superseded_by: []
---

## Контекст

Синий прямоугольник на карте — текущий viewport. Для мыши `pointerdown`
сразу центрировал камеру, а `pointermove` продолжал вести её за курсором.
Событие всплывало в контейнер и начинало обычный pan. Навести на экран и
кликнуть было нельзя: индикатор прилипал к мыши, реальный viewport уезжал
на край канваса. Touch уже был другим: tap no-op, scrub после slop.

## Решение

Карта — обзор плюс прыжок, не live-follow.

- Hover и pointerdown камеру не трогают.
- Мышь и pen: click (pointerup без драга) один раз центрирует камеру.
  Попадание в ноду — центр этой ноды, иначе world-точка под курсором. Зум
  не меняется.
- Drag после `MINIMAP_SCRUB_SLOP_PX` — scrub, как раньше.
- Touch tap по-прежнему no-op; drag scrub.
- Pointer events карты не всплывают в контейнер — карта не запускает pan
  канваса.
- Hover-ghost на 220×90 не рисуем.

## Обоснование

Figma/Miro: наведение не двигает камеру, click прыгает, drag панорамирует.
Экраны на карте крошечные — snap к ноде важнее точной точки. Ghost поверх
текущего viewport на этой высоте не читается.

## Отклонённые альтернативы

Live-follow с первого пикселя мыши — исходный баг. Hover-ghost отклонён из-за
двух прямоугольников на 90px. Ручка только на синем индикаторе — лишний
hit-target при `pointer-events: none` и той же площади карты.

## Последствия

Мышь больше не использует карту как джойстик с нажатия. Кто водит зажатым —
после slop scrub остаётся. Палец не телепортирует камеру тапом.

## Как проверить

Навести на карту без клика — камера стоит. Клик по экрану — один прыжок на
него. Nudge меньше slop — click. Drag за slop — live scrub. Touch tap no-op.
