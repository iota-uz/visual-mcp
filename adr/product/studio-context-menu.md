---
id: studio-context-menu
title: Контекстные действия студии через общее меню существующих операций
status: superseded
date: 2026-09-11
deciders: [unknown]
area: product
applies_to:
  - apps/web/src/components/ui/ContextMenu.tsx
  - apps/web/src/components/ui/Menu.tsx
  - apps/web/src/components/video/StoryboardEditor.tsx
  - apps/web/src/components/video/VideoDraftStudio.tsx
  - apps/web/src/components/video/TimelineEditor.tsx
  - apps/web/src/components/video/timeline/TimelineTrackArea.tsx
tags: [product, video-studio, context-menu, editor-ux]
refs: []
supersedes: []
superseded_by: [scene-reorder-drag-sort]
---

## Контекст

Действия сцен, клипов и дорожек жили только в разрозненных местах:
перемещение и удаление сцены — в шапке Story, nudge/split/duplicate/delete
клипа — в inspector и клавиатуре, lock/hide/mute дорожки — в мелких кнопках
подписи. Правый клик и долгий тап отдавали меню браузеру, а Shift+F10 не
открывал ничего. Нужен один контракт контекстных действий, а не три
разрозненных меню.

## Решение

Правый клик, долгий тап (только touch/pen, не мышь) и Shift+F10 /
ContextMenu открывают короткое меню уже существующих операций через общий
примитив `useContextMenuTrigger`. Меню содержит только то, что продукт уже
умеет: сцены — Move earlier/later и Delete scene… (удаление — через
`ConfirmButton defaultArmed`, как staged-подтверждение из меню);
клипы — Nudge, Split at playhead, Duplicate, Delete clip (мгновенно, как
клавиатурный Delete); дорожки — Lock/Unlock и Hide/Show либо Mute/Unmute.
Где действий нет (шоты, кандидаты, версии, рендеры, lane без клипа) —
нативное меню браузера не подавляется.

Открытие выделяет цель (семантика Figma), меню коллизионно позиционируется,
фокус входит в первый доступный пункт и возвращается на цель, стрелки
зациклены, Home/End прыгают. Долгий тап отменяется движением, скроллом,
мультитачем и pointer cancel. Деструктивные пункты именуются по конвенции
меню: `…` — только если дальше будет подтверждение.

## Обоснование

Контракт клавиатуры `Menu` уже доказан тестами и переиспользуется через
общий `MenuPopup`, вместо третьего ручного меню. Удаление сцены идёт через
существующий `ConfirmButton`, удаление клипа — мгновенно, как было:
поведение не меняется, меняется только точка входа.

## Отклонённые альтернативы

Отдельные меню на каждую поверхность — три реализации контракта вместо
одной. Подтверждение удаления клипа диалогом — меняло бы существующую
семантику мгновенного Delete. Контекстное меню на шотах и кандидатах —
дублировало бы соседние кнопки без новых действий.

## Последствия

Новые точки входа не добавляют операций бэкенда: все пункты вызывают те же
мутации через те же revision/idempotency-контракты. Правый клик по клипу и
сцене меняет selection — это часть контракта меню.

## Как проверить

`npx vitest run src/components/ui/ContextMenu.test.tsx` из `apps/web`,
плюс интеграционные тесты сцен, клипов и дорожек в
`StoryboardEditor.test.tsx` и `TimelineEditor.test.tsx`.
