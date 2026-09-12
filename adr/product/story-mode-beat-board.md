---
id: story-mode-beat-board
title: Story — доска битов, форма по запросу
status: accepted
date: 2026-09-12
deciders: [diyorkhaydarov]
area: product
applies_to:
  - apps/web/src/components/video/StoryboardEditor.tsx
  - apps/web/src/components/video/VideoDraftStudio.tsx
  - apps/web/src/routes/VideoStudio.tsx
  - apps/web/src/styles/surfaces/video-storyboard.css
  - apps/web/src/styles/surfaces/video-shell.css
tags: [product, video-studio, story, editor-ux]
refs: [video-studio-quiet-workbench, scene-reorder-drag-sort, video-studio-workbench]
supersedes: []
superseded_by: []
---

## Контекст

Режим Story был формой одной сцены: слева усечённый навигатор, в центре
purpose / narration / captions / visual / camera выбранного бита. На
проекте из пяти сцен дуга ролика не читалась — только поля сцены 1.
Пользователь не мог увидеть историю целиком и зайти в бит, если нужно
править.

## Решение

Story — доска битов, не документ-форма.

- Левый навигатор сцен в Story скрыт (как в Timeline). В Shots он остаётся.
- Все сцены видны сразу: 9:16-шахта с on-screen text (или visual, если
  титров нет), номер, purpose, narration, строка visual/framing/motion.
- Форма открывается по клику на бит, одна за раз; Esc и Done закрывают.
  Первый заход и возврат из Shots не раскрывают форму — только выделяют.
- Premise — логлайн в одну-две строки, textarea по клику.
- Add scene в конце доски. Reorder — HTML5 DnD за номерную плашку и
  Alt+↑/↓; контекстное меню по-прежнему только Delete scene…
- Inspector справа остаётся Version/render. Контракт скрипта не меняется.
- Язык — тихий инструмент: Manrope, бумага, чернила; шахта 9:16 — тот же
  материал, что в Review.

## Обоснование

Задача Story — прочитать дугу, затем править выбранный бит. Форма на весь
workbench прятала остальные сцены. Distinctiveness вертикального ролика —
кадр в шахте, не сериф и не CMS-лейблы.

## Отклонённые альтернативы

Оставить рельс и одну форму. Сетка мелких 9:16-тайлов — обрезает VO.
Модальный редактор — теряет дугу. Поля сцены в inspector версий —
смешение объектов. Новый костюм монтажной — reversed.

## Последствия

`scene-reorder-drag-sort` сохраняет контракт DnD, но в Story жест живёт на
доске (ручка — номер), в Shots — на навигаторе. Выбор сцены по-прежнему
общий для Story и Shots.

## Как проверить

Доска показывает purpose и narration всех сцен без раскрытия. Клик
открывает поля; Esc закрывает. DnD за номер, Alt+стрелки, delete, add.
Навигатор отсутствует в Story и есть в Shots. Disabled version — доска
без редакторов. Desktop и 390 px; без hover-lift и vs-rise.
