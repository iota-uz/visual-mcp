---
id: canvas-node-anchored-inspector
title: Inspector и Exit якорятся к выбранной ноде в screen space
status: accepted
date: 2026-09-07
deciders: [diyorkhaydarov]
area: product
applies_to:
  - packages/canvas/src/viewport.ts
  - packages/canvas/src/chrome-placement.ts
  - packages/canvas/src/theme.css
  - packages/canvas/src/render.ts
tags: [product, canvas, editor-ux, inspector]
refs: []
supersedes: []
superseded_by: []
---

## Контекст

После double-click на iframe камера fit'ит экран, а inspector с annotation
и element ref оставался карточкой в левом нижнем углу viewport. Title
дублировал caption на ноде. Exit жил внутри мира с магическим `top: 55px`
и масштабировался с камерой. Esc из interact ещё и снимал selection.

## Решение

Inspector — screen-space карточка рядом с выбранной нодой (справа, иначе
слева / снизу / сверху), едет с камерой. Содержимое: annotation, затем
ref; title только на низком зуме, когда caption не читается. Карточка
скрыта, если показывать нечего.

Exit — screen-space кнопка у верхнего правого края той же ноды, постоянного
размера. World-space Exit удалён.

Esc в `iframe-active` только выходит из interact и оставляет selection.
Повторный Esc снимает выбор, как раньше.

## Обоснование

Proximity: контекст экрана должен стоять у экрана. Один inspector для
клика и interact, иначе карточка прыгает из угла к ноде. Screen-space
держит Exit нажимаемым на любом зуме.

## Отклонённые альтернативы

Панель свойств справа viewport снова далека после fit. Карточка только в
iframe-active даёт прыжок между первым и вторым кликом.

## Последствия

Bottom-left больше не зарезервирован под inspector. На узком viewport
карточка flip'ается под ноду и не должна перекрывать toolbar.

## Как проверить

Клик native/iframe — карточка у ноды. Double-click — fit, карточка в
gutter, Exit на рамке, клики внутри HTML. Esc выходит из interact, нода
остаётся выбранной. Pan/zoom — chrome следует.
