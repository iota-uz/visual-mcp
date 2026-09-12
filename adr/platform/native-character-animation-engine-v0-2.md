---
id: native-character-animation-engine-v0-2
title: Персонажная анимация использует data-driven packs и процедурный runtime
status: accepted
date: 2026-09-12
deciders: [unknown]
area: platform
applies_to:
  - packages/video/src/character.ts
  - packages/video/src/character-packs.ts
  - packages/video/src/registry.ts
  - packages/video/src/contracts.ts
  - packages/video/test/registry.test.ts
  - packages/video/test/contracts.test.ts
  - convex/video.ts
  - apps/worker/src/video/character-runtime.ts
  - apps/worker/src/video/character-pack-view.tsx
  - apps/worker/src/video/character-scene.tsx
  - apps/worker/test/character-runtime.test.ts
  - apps/worker/test/character-pack-view.test.ts
  - apps/worker/test/character-scene.test.ts
tags: [video, animation, characters, rig, ik, remotion]
refs:
  - запрос пользователя
supersedes: [native-character-animation-video-mvp]
superseded_by: []
---

## Контекст

Первый производственный MP4 подтвердил работоспособность semantic character
animation внутри Video Studio, но компонент `character-scene@1` выбирал два
встроенных renderer-а по ID, совмещал компиляцию и рисование и не имел общей
модели рига, смешивания действий, пространственных целей или долговечного
удержания предметов. Пользователь запросил реализацию этих возможностей без
user-level controls.

## Решение

Заменить компонент на breaking revision `character-scene@2`. Сцена содержит
bounded сериализуемые `CharacterPack`: normalized rig points, capabilities,
expressions, motion profile и типизированные vector layers. Actor ссылается на
pack ID, а один generic renderer рисует любой pack без ветвления по ID.

Semantic actions компилируются в числовые tracks. Animation mixer сочетает
слои по channel, priority, weight, blend windows и body masks. Пространственные
targets адресуют point, actor, prop или overlay; gaze и two-bone arm IK решаются
в системе координат персонажа с учётом facing, scale и rotation. Props имеют
grip anchor, могут прикрепляться к руке и сохраняют последнего владельца после
`showProp` при произвольном seek по frame.

В v0.2 artwork ограничен ellipse, rect и безопасным SVG path data. Произвольный
markup, код и remote URLs не исполняются. Packs передаются внутри immutable
timeline/checkpoint; отдельный persisted marketplace и GUI загрузки не входят в
это решение.

Breaking component revisions допускают атомарный repair patch: JSON Patch
применяется к сохранённому raw document, а строгая schema проверяет уже итог.
Это позволяет заменить больше не поддерживаемый `@1` на `@2` без временного
compatibility renderer; частично исправленный документ по-прежнему не сохраняется.

## Обоснование

Единый data-driven runtime отделяет внешний вид от поведения и позволяет
добавить третьего персонажа без нового React component. Typed vector data
сохраняет детерминированный Remotion render и строгую schema validation. Tracks
и procedural solvers устраняют конфликт «одно действие целиком заменяет другое»
и позволяют точно направлять взгляд, руку и удерживаемый предмет.

## Отклонённые альтернативы

Сохранение отдельных `FarqRig` и `CustomerRig` не масштабируется на новые
персонажи. Произвольный JSX или SVG markup в timeline расширяет исполняемую
поверхность и не требуется для текущего MVP. Compatibility renderer `@1`
отклонён согласно green-field posture; существующий пилот мигрируется на `@2`.

## Последствия

Новый character pack добавляется данными, пока его возможности укладываются в
normalized rig и поддержанные vector primitives. Действия разных каналов и
разных priorities могут выполняться одновременно; неоднозначное владение одним
channel на одном priority отклоняется до render. Для внешней asset-backed
загрузки pack bundles потребуется отдельное решение о хранении и authoring UX.

## Как проверить

Проверить schema tests с двумя встроенными и одним неизвестным pack, отказ на
невалидные capabilities/references/artwork, deterministic compiler/mixer,
reachable и unreachable IK, mirrored gaze, persistent prop attachment и SSR
generic renderer. Затем создать checkpoint с `character-scene@2` и получить
production MP4 через существующий Video Studio render pipeline.
