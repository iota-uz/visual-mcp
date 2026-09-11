---
id: scene-reorder-drag-sort
title: Порядок сцен — drag-and-drop, контекстное меню сцен только для удаления
status: accepted
date: 2026-09-11
deciders: [unknown]
area: product
applies_to:
  - apps/web/src/components/video/StoryboardEditor.tsx
  - apps/web/src/components/video/VideoDraftStudio.tsx
  - apps/web/src/styles/surfaces/video-storyboard.css
tags: [product, video-studio, editor-ux, drag-and-drop]
refs: [studio-context-menu]
supersedes: [studio-context-menu]
superseded_by: []
---

## Контекст

Запись `studio-context-menu` ввела общее контекстное меню студии, и для сцен
в него попали Move earlier/later, а в шапке Storyboard жили кнопки
Earlier/Later. Пошаговые стрелки требуют нескольких действий на одну
перестановку и не показывают, куда сцена встанет, — при 7+ сценах это
медленно и вслепую. Дублировать один и тот же порядок тремя входами
(кнопки, два пункта меню) не нужно.

## Решение

Навигатор сцен — drag-and-drop sortable list на HTML5 DnD:

- карточки сцен перетаскиваются (обёртка с `draggable`), сброс на карточку
  ставит перетаскиваемую сцену на её место; источник гасится
  (`is-dragging`), цель подсвечивается (`is-drop-target`);
- порядок фиксируется через `onReorderScenes(sceneOrder)` — тот же
  `script.edit` документа, новой операции не появляется;
- клавиатурный дубль: Alt+↑/↓ на сфокусированной карточке, подписано
  `aria-keyshortcuts` и видимой подсказкой в навигаторе;
- из контекстного меню сцен остаётся только `Delete scene…` (staged через
  `ConfirmButton defaultArmed`); кнопки Earlier/Later в шапке Storyboard
  удалены.

Контракт контекстного меню из `studio-context-menu` — правый клик, долгий
тап, Shift+F10/ContextMenu, коллизионное позиционирование, возврат фокуса —
сохраняется вместе со всеми действиями клипов (Nudge/Split/Duplicate/Delete)
и дорожек (Lock/Hide/Mute); меняется только состав пунктов для сцен.

Сортировка недоступна, когда `scenesLocked` или сцена одна. HTML5 DnD не
работает на тач-устройствах — переупорядочение там недоступно; контекстное
меню и скролл списка остаются.

## Обоснование

Прямая манипуляция показывает результат до отпускания и убирает
дублирующие входы в одну операцию. `onReorderScenes` сохраняет единственный
источник правды порядка — `sceneOrder` документа — и существующий
цикл несохранённых правок.

## Отклонённые альтернативы

Оставить оба входа (кнопки/пункты меню и DnD) — два способа сделать одно и
лишний хром. Listbox-семантика APG вместо карточек-кнопок — ломает выделение
сцены кликом и контракт `aria-current`. Удерживать Move earlier/later в
меню для тача — возвращало бы удалённые контролы вместо честного
признания ограничения платформы.