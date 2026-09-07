---
id: canvas-context-menu
title: Правый клик открывает короткое меню существующих операций focused-editor
status: accepted
date: 2026-09-07
deciders: [diyorkhaydarov]
area: product
applies_to:
  - packages/canvas/src/viewport.ts
  - packages/canvas/src/context-menu.ts
  - packages/canvas/src/theme.css
  - apps/web/src/routes/Canvas.tsx
tags: [product, canvas, editor-ux, context-menu]
refs: []
supersedes: []
superseded_by: []
---

## Контекст

Человек ожидает меню в точке правого клика, как в Figma и Miro. Редактор
при этом не general-purpose drawing layer: агент авторит контент, человек
получает select, move, resize, delete, comments и session-local undo.
Половина этих действий жила в toolbar, zoom menu, inspector и `?`, а мышь
отдавала `contextmenu` браузеру. Long-press на coarse pointer уже занят
toggle selection.

## Решение

Правый клик мышью и `Shift+F10` / `ContextMenu` открывают короткое меню
уже существующих операций в screen-space overlay viewport. Состав зависит
от цели: пустой канвас, одна нода, multi-selection, группа. Ребро и
comment pin не перехватываются — у них свои панели.

Семантика выбора как в Figma: невыбранная нода становится selection,
нода из multi сохраняет набор, клик по пустому миру selection не сбрасывает.
Выделенный текст в `.vc-native-body` оставляет нативное Copy. Палец не
открывает меню: long-press остаётся multi-select, system menu глушится.

Пункты v1: Add comment, Fit Selection / Fit Page / Zoom to 100%, Open
screen, Copy link, Copy element ref, Delete…. Без Duplicate/Copy/Paste
нод, lock, z-order, align, смены tool и undo.

## Обоснование

Hick и focused-editor ADR требуют короткого discovery-меню, а не второго
authoring product. Duplicate page уже есть отдельно; duplicate ноды —
новая операция и отдельный шаг. Long-press уже отвечает за selection, а
Delete на coarse pointer живёт в inspector.

## Отклонённые альтернативы

React-меню в `apps/web` потребовало бы повторного hit-test поверх
viewport. Полноценный clipboard и long-press-меню отклонены для v1.
Подменю Copy link / Copy element ref отклонены: два плоских пункта
дешевле, чем вложенная навигация.

## Последствия

Мышь больше не получает системное меню на канвасе, кроме выделенного
текста ноды. Меню принадлежит `packages/canvas`, app только даёт
`onCopyNodeLink`. Public/read-only сами ужимают пункты через `editable`
и отсутствие comments.

## Как проверить

Правый клик по миру, native/iframe/image ноде, multi и группе; public
canvas без Delete и Comment; `Shift+F10`; Escape и клик снаружи;
выделенный текст native body — браузерное меню; палец по-прежнему
глушит system menu и не открывает наше.
