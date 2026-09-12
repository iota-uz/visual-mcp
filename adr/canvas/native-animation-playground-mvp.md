---
id: native-animation-playground-mvp
title: Нативная анимация сначала проверяется в Canvas playground
status: accepted
date: 2026-09-12
deciders: [unknown]
area: canvas
applies_to:
  - packages/runtime/src/templates/animated-story-playground.ts
  - packages/runtime/src/templates/index.ts
  - packages/runtime/src/templates/metadata.ts
  - packages/runtime/src/types.ts
  - packages/runtime/test/templates.test.ts
tags: [canvas, animation, mvp, farq]
refs:
  - /tmp/codex-remote-attachments/01a09505-516a-7cc1-9dd3-6724edfb26a8/1A209399-2673-4F4E-9B84-EF569EFEFFCD/1-farq_agent_native_animation_engine_spec.docx
supersedes: []
superseded_by: []
---

## Контекст

Нужно проверить качество agent-native 2D анимации до появления отдельной
пользовательской студии, каталога персонажей и video-level authoring surface.
В репозитории уже есть Canvas с локальными iframe screen runtime, поэтому он
позволяет показать настоящий интерактивный SVG-renderer без нового UI.

## Решение

Первый MVP публикуется как Canvas template: один локальный HTML screen с
детерминированной SVG-сценой Farq. Он демонстрирует staging, взгляд, blink,
руки, squash/stretch, реакцию, price reveal и CTA через time-based scene
definition. Нет user-level controls, persisted character registry, загрузки
риг-пакетов, video job или автоматического approval.

Canvas playground является средством качественной проверки, а не canonical
форматом будущего animation engine. После visual pilot semantic AST, asset
manifest и renderer adapter вводятся отдельным решением; MVP не создаёт
временную совместимость или второй video workflow.

## Обоснование

Canvas уже безопасно хранит и изолированно запускает authored local screens,
а его MCP template catalog делает пример discoverable для агента. Такой срез
проверяет самое рискованное допущение — читаемость 2D acting — до затрат на
долговечную модель данных и UI.

## Отклонённые альтернативы

Сразу создавать Video Studio UI, библиотеку персонажей и import workflow.
Использовать Blender или внешний text-to-video renderer как базовый язык
анимации. Оба пути не дают быстро проверить выбранный программный 2D язык.

## Последствия

Изменение добавляет только template resource. Любой Canvas, созданный по
шаблону, остаётся обычным private draft/checkpoint и использует локальный
iframe sandbox. Рендер preview фиксирует один момент сцены; оценка движения
делается в интерактивном Canvas.

## Как проверить

Взять template из `canvas://templates/animated-story-playground`, создать
Canvas через `canvas_save`, открыть iframe и проверить всю 14-секундную
сцену: вход маскота, reveal двух цен, реакцию customer и CTA. Проверить
`prefers-reduced-motion`, отсутствие внешних запросов и успешный static
snapshot. Template unit test должен находить ресурс и сохранять точный
каталог.
