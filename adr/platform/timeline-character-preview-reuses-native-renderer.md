---
id: timeline-character-preview-reuses-native-renderer
title: Timeline preview исполняет тот же native character renderer, что и worker
status: accepted
date: 2026-09-12
deciders: [unknown]
area: platform
applies_to:
  - apps/web/Dockerfile
  - apps/web/src/components/video/TimelinePreview.tsx
  - apps/web/src/components/video/TimelinePreview.test.tsx
  - apps/worker/src/video/character-scene.tsx
  - apps/worker/src/video/character-pack-view.tsx
  - apps/worker/src/video/character-runtime.ts
tags: [video, timeline, preview, characters, renderer]
refs:
  - запрос пользователя
supersedes: []
superseded_by: []
---

## Контекст

Timeline monitor умел приближённо показывать assets, text, scene graph и простые
registered components, но для `character-scene@2` отображал заглушку `Generated
graphic`. Это скрывало результат процедурной анимации до production render.

## Решение

Для `character-scene@2` Timeline preview валидирует props общей схемой и
исполняет browser-safe React/SVG renderer и frame evaluator, которыми пользуется
worker. Playhead передаётся как локальный frame клипа, а clip layout, motion и
effects по-прежнему применяются внешним preview shell.

## Обоснование

Повторная упрощённая реализация semantic actions, mixer, gaze и IK неизбежно
расходилась бы с финальным рендером. Существующий character renderer не зависит
от Node, Remotion или worker transport и может безопасно исполняться в браузере.

## Отклонённые альтернативы

Показывать последний MP4 недостаточно: он может относиться к устаревшему
checkpoint и не следует за playhead текущего draft. Генерировать server snapshot
на каждом перемещении playhead создаёт сетевую задержку и лишнюю render-нагрузку.

## Последствия

Timeline показывает детерминированную live approximation всех native character
сцен. Модули character renderer/runtime остаются browser-safe; добавление в них
Node-only или Remotion-only imports нарушит web build и закреплено тестом
production-сборки.

## Как проверить

Открыть Timeline с `character-scene@2`, перемещать playhead и запустить playback:
персонажи и semantic actions должны меняться, а `Generated graphic` отсутствует.
Запустить `TimelinePreview.test.tsx`, web typecheck и production build.
