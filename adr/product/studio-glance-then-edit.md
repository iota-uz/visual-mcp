---
id: studio-glance-then-edit
title: Студия — взгляд, потом правка; версия в той же комнате
status: accepted
date: 2026-09-12
deciders: [diyorkhaydarov]
area: product
applies_to:
  - apps/web/src/components/video/ShotStudio.tsx
  - apps/web/src/components/video/VideoDraftStudio.tsx
  - apps/web/src/routes/VideoStudio.tsx
  - apps/web/src/styles/surfaces/video-shots.css
  - apps/web/src/styles/primitives/radio-cards.css
tags: [product, video-studio, shots, editor-ux]
refs: [story-mode-beat-board, video-studio-quiet-workbench, video-studio-workbench]
supersedes: []
superseded_by: []
---

## Контекст

После доски битов в Story остальные поверхности всё ещё прятали работу в
формах: Shots — дамп сцены и редактор одного шота; inspector «Version and
render» держал 320px для редкого чекпоинта; `?version=` выкидывал из
workbench в документ; камера жила и в сцене, и в шоте; RadioCards поднимались
на hover.

## Решение

- Shots — доска кадров выбранной сцены (9:16-шахта, purpose, action). Форма
  производства открывается по клику. Дамп narration/visual, внутренний рельс
  шотов и декоративный progress убраны.
- Камера сцены каноническая. Motion шота по умолчанию «Same as scene»;
  генерация наследует scene motion, пока шот не задал свой.
- Inspector по умолчанию свёрнут. Чекпоинт — коротко, без лекции. Список
  версий открывает снимок кнопкой «Open version».
- `?version=` остаётся в том же workbench: workflow на месте, документы
  read-only, Return to draft в status bar, Render в inspector.
- RadioCards без hover-lift. Status bar без kbd-шпаргалки и без счётчика
  scene briefs — дуга видна на доске Story.

## Обоснование

Тот же критерий, что у Story: объект виден целиком, правка по желанию.
Версия — режим комнаты, не другая страница.

## Отклонённые альтернативы

Оставить Shots формой. Держать inspector открытым на wide. Отдельный
документ версии. Дублировать камеру двумя тройками RadioCards.

## Последствия

`story-mode-beat-board` не меняется. Контракт скрипта не меняется: пустой
`shot.cameraMotion` значит «как у сцены».

## Как проверить

Shots: все шоты сцены видны без раскрытия; клик открывает method/action;
Camera по умолчанию Same as scene. Inspector закрыт на Story. `?version=`
сохраняет Story/Shots/Timeline; Return возвращает черновик. Нет translateY
на radio-card.
