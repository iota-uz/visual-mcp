---
id: canvas-node-actions
title: Play, Download и Rename живут в caption ноды, в контекстном меню и в inspector
status: accepted
date: 2026-09-07
deciders: [diyorkhaydarov]
area: product
applies_to:
  - packages/canvas/src/render.ts
  - packages/canvas/src/viewport.ts
  - packages/canvas/src/context-menu.ts
  - packages/canvas/src/prototype.ts
  - packages/canvas/src/theme.css
  - apps/web/src/routes/Canvas.tsx
  - apps/web/src/routes/Present.tsx
tags: [product, canvas, editor-ux, prototype, export]
refs: []
supersedes: []
superseded_by: []
---

## Контекст

Чтобы посмотреть один экран как прототип, нужно было идти в Present и
дальше по start frame; чтобы получить PNG одной ноды — просить агента
сделать snapshot. В Claude Design у каждого артборда есть Play и
Download прямо в его заголовке, а интерактивные артборды подсвечены.
`canvas-context-menu` и `canvas-node-anchored-inspector` уже задали, где
живут действия над нодой.

## Решение

У каждой ноды, кроме `actor` и `decision` (их caption перестроен), в
caption strip после заголовка появляется кластер `.vc-caption-actions`:
**Play** (настоящий `<a href>` на `/c/:id/present?page=&node=`, поэтому
⌘-клик открывает новую вкладку), **Download** (PNG через
`browser-export-via-snapshot-worker`) и **⋯** (открывает контекстное
меню ноды). Кластер виден при hover, фокусе и selection; прячется при
активном iframe, на low zoom, в placement-инструментах и во время drag.

Те же действия дублируются в контекстном меню (`play`, `download`,
`rename`) и в inspector строкой `.vc-inspector-tools` — только для coarse
pointer или low zoom, когда кластер недоступен. Play показывает залитую
иконку и accent ring на ноде, если у неё есть hotspot
(`prototypeNodeFlags`); стартовая нода помечена флагом Start.

Present принимает `?page=&node=` без настроенного start: узел, с которого
нажали Play, становится start на время сеанса; Esc и «Back to canvas»
возвращают на канвас с тем же `?page=&node=`.

Заголовок: в шапке редактора появляется меню Export (страница PNG 1×/2×,
страница PDF, все страницы PDF).

## Обоснование

Действие должно быть там, где объект. Кластер в caption — screen-constant
по размеру, не требует screen-space overlay и переживает reconcile
(caption и так заменяется целиком). Ссылка вместо кнопки для Play
сохраняет браузерное поведение новой вкладки. Дублирование в inspector
следует правилу anchored-inspector: палец не умеет hover.

## Отклонённые альтернативы

- Screen-space header strip над нодой (как в Claude Design): третий
  якорящийся элемент рядом с inspector и Exit, ещё один слой в
  `positionChrome`. Caption уже есть.
- Quick-action bar над selection: отложен, inspector покрывает.
- Download через клиентский рендер (html2canvas): iframe-ноды кросс-origin,
  результат расходился бы с тем, что видит агент.

## Последствия

`RenderOptions` получает `captionActions`, `resolvePresentUrl`,
`prototypeFlags`; статические рендеры и public viewer их не передают и не
получают кнопок. `ViewportOptions` получает `onPlay`, `onDownload`,
`onCaptionRename`, `prototypeFlags`. Present больше не требует start.

## Как проверить

Hover по ноде показывает кластер; Play открывает Present на этой ноде,
Esc возвращает с выделенной нодой; ⌘-клик — новая вкладка. Нода с
hotspot — кольцо и залитый Play; start-нода — флаг. Low zoom — кластера
нет, inspector показывает строку действий. Download без worker — тост
«render worker is not configured».
