---
id: native-character-animation-video-mvp
title: MVP нативной персонажной анимации исполняется внутри Video Studio
status: superseded
date: 2026-09-12
deciders: [unknown]
area: platform
applies_to:
  - packages/video/src/registry.ts
  - packages/video/test/registry.test.ts
  - apps/worker/src/video/character-scene.tsx
  - apps/worker/src/video/components.tsx
  - apps/worker/test/character-scene.test.ts
tags: [video, animation, characters, remotion, mvp]
refs:
  - /tmp/codex-remote-attachments/01a09505-516a-7cc1-9dd3-6724edfb26a8/1A209399-2673-4F4E-9B84-EF569EFEFFCD/1-farq_agent_native_animation_engine_spec.docx
  - запрос пользователя
supersedes: [native-animation-playground-mvp]
superseded_by: [native-character-animation-engine-v0-2]
---

## Контекст

Первый пилот ошибочно был реализован как HTML/SVG template обычного Canvas.
Пользователь уточнил, что проверяемая анимация относится к video production и
должна завершаться настоящим Remotion/FFmpeg MP4. Пользовательские контролы и
полноценный character upload workflow пока не нужны.

## Решение

Добавить versioned trusted component `video/component/character-scene@1` как
сериализуемый semantic AST внутри существующего Video Studio timeline clip.
Компонент поддерживает встроенные риги Farq mascot и customer, deterministic
seed, semantic actions `enter`, `look`, `blink`, `talk`, `gesture`, `react` и
timed overlays. Worker вычисляет позу как чистую функцию props и local frame,
рисует repository-owned SVG и использует существующий checkpoint/render/job
pipeline без нового UI или отдельного Canvas workflow.

Первый срез намеренно не добавляет persisted character registry, загрузку SVG
rig bundles, TTS alignment, произвольный procedural code, новый project-level
AST или новые render jobs. Component revision и checkpoint фиксируют точный
исполняемый контракт пилота.

## Обоснование

Timeline уже является источником фактической длительности, trusted component
registry уже публикует строгие схемы через MCP, а worker уже рендерит их в MP4.
Новый компонент проверяет недостающий риск — читаемость персонажного acting —
не дублируя storage, CAS, job lifecycle и review surface.

## Отклонённые альтернативы

HTML/JavaScript внутри Canvas не проходит через video production pipeline.
Существующий generic scene graph требует низкоуровневых keyframes и не умеет
semantic rigs, gaze, visemes или gestures. Полный новый animation subsystem до
первого MP4 слишком велик для проверки визуального языка.

## Последствия

Агент может обнаружить схему компонента, поместить её в visual track, создать
checkpoint и получить настоящий draft MP4. Разные встроенные characters уже
выбираются по semantic ID; внешняя загрузка персонажей остаётся отдельным
последующим решением после оценки качества пилота.

## Как проверить

Создать RU Video Studio project, поместить `character-scene@1` в visual clip,
checkpoint точных revisions и запустить draft render. Проверить MP4 и кадры на
enter, constrained gaze, blink, talk visemes, distinct gestures, reaction,
timed price overlays и воспроизводимость одинакового seed/frame.
