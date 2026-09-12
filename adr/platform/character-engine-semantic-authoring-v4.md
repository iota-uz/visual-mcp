---
id: character-engine-semantic-authoring-v4
title: Персонажный движок v4 компилирует диалоги, композицию действий и ограниченные процедурные треки
status: accepted
date: 2026-09-12
deciders: [unknown]
area: platform
applies_to:
  - packages/video/src/character.ts
  - packages/video/src/character-choreography.ts
  - packages/video/src/character-procedural.ts
  - packages/video/src/character-action-library.ts
  - packages/video/src/character-dialogue.ts
  - packages/video/src/character-audio-plan.ts
  - packages/video/src/character-migrations.ts
  - packages/video/src/operations.ts
  - convex/characterLibrary.ts
  - convex/schema.ts
  - convex/lib/videoPurge.ts
  - convex/lib/videoProcessing.ts
  - apps/mcp/src/video/character.ts
  - apps/mcp/src/video/providers.ts
  - apps/worker/src/video/character-scene.tsx
  - apps/worker/src/video/character-render-cache.ts
  - apps/worker/src/video/render.ts
  - apps/worker/src/video/process.ts
tags: [video, animation, dsl, determinism, audio]
refs: ["исходная спецификация farq_agent_native_animation_engine_spec.docx", "запрос пользователя закрыть оставшиеся пункты"]
supersedes: []
superseded_by: []
---

## Контекст

Рекламная итерация добавила постановку и переходы, но не закрыла исходную
спецификацию: секундный DSL, составные действия, процедурное расширение,
автоматический диалог и расширяемые библиотеки отсутствовали.

## Решение

Канонический источник — строгий JSON AST `character-scene@4`. Размер stage
явный; renderer использует его для геометрии, целей и камеры. Секундный DSL
компилируется в кадры с явным timebase. `hold` продлевает якорь следующего
действия, а не саму анимацию. Составные действия связываются с актёром при
компиляции и раскрываются в обычные проверяемые действия.

Procedural escape hatch — ограниченные математические TypeScript arrow
expressions, разобранные parser-ом в bounded AST и запечённые в числовые tracks.
Это не произвольный JS: нет eval/Function, доступа к окружению, I/O, циклов и
неявной случайности. TypeScript parser остаётся в authoring-only subpath.

Определения действий immutable и content-addressed: SHA-256 canonical
`{id,label,content}`. Backend проверяет хеш, хранит project-local revision;
promotion создаёт workspace-shared snapshot без изменения байтов. Shared здесь
не означает общий каталог другой организации или другого workspace.

Диалог связывает текст с pinned audio и provider alignment, компилирует
visemes, gaze и реакции слушателя. Audio plan использует существующий Timeline
и audio_mix, а не параллельную звуковую систему. Синтетические timings не
являются доказательством качества lip-sync. Платная генерация требует
отдельного пользовательского разрешения.

Проверка формы аудио использует тот же pinned media job boundary: `get_waveform`
декодирует FFmpeg только явно ограниченный диапазон и канал, сохраняет PNG и
машиночитаемый отчёт. Амплитудная форма не считается alignment, транскрипцией,
измерением loudness или семантическим анализом.

Миграция `@3 → @4` — явная author-time операция с последующим CAS patch.
Старый renderer и автоматические миграции при чтении не добавляются.

Удаление проекта удаляет его локальные action definitions, но не продвинутые
workspace-shared revisions. Для native-character render worker использует
ограниченный локальный MP4 cache после проверки доступа и входных файлов.
Ключ включает AST, формат, диапазон, pinned asset hashes и build/engine identity.
Без известного build SHA cache выключен. Попадание в cache не отменяет проверки
байтов, нового probe, poster, receipt и авторизованной загрузки результата.

RenderMedia использует lossless PNG intermediate frames. Повторные локальные
проверки одинакового frozen bundle показали совпадение выбранных PNG stills,
но не побайтовое совпадение decoded MP4 даже с PNG intermediates. Поэтому
детерминизм принимается по заранее заданному визуальному codec tolerance, а не
по хешу контейнера или всех decoded frames. Это не обещание одинаковых байтов
на разных Chromium/FFmpeg/платформах: build и engine identity остаются частью
воспроизводимого input.

## Обоснование

Пользователь запросил закрытие исходной спецификации на уровне общего движка,
а не полировку отдельного Farq-ролика. Данные и pure compilation позволяют
повторять рендер, переиспользовать действия и менять renderer независимо от DSL.

## Отклонённые альтернативы

Неограниченное исполнение пользовательского TypeScript расширяет поверхность
исполнения сверх нужного для анимационных кривых. Отдельный аудиоконвейер
дублирует существующий. Неявное latest-разрешение действий ломает воспроизводимость.

## Последствия

Новая revision требует явного обновления сохранённых сцен. Техническая
валидация не заменяет motion/video review. 3D, физика, полноценная анатомия и
новые пользовательские controls остаются вне этой итерации.

## Как проверить

Unit и integration tests: секундная композиция, циклы/коллизии, adversarial
parser input, immutable registration/promotion, реальные старые AST,
multi-speaker timing и audio mix. Приёмка отдельно: 20–30 секунд видео,
прослушивание lip-sync, staged defect → scoped patch, повторный render и reuse
одного action revision в другой сцене. Статус фиксируется в
`docs/character-spec-completion.md`, без подмены visual acceptance unit-тестами.
