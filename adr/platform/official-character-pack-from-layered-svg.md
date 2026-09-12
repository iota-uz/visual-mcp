---
id: official-character-pack-from-layered-svg
title: Официальный маскот хранится как immutable SVG asset и компилируется в Character Pack
status: accepted
date: 2026-09-12
deciders: [unknown]
area: platform
applies_to:
  - packages/video/src/character.ts
  - packages/video/src/character-packs.ts
  - packages/video/test/registry.test.ts
  - apps/worker/src/video/character-pack-view.tsx
  - apps/worker/test/character-pack-view.test.ts
tags: [video, characters, svg, assets, brand]
refs:
  - запрос пользователя
  - asset://shared/farq-official-layered-mascot@1
supersedes: []
superseded_by: []
---

## Контекст

Пользователь передал официальный layered SVG персонажа farq.uz и попросил
загрузить его в Assets и создать на его основе нового персонажа. Исходник уже
разделяет голову, лицо, конечности, перчатки, знак процента, обувь и акценты.

## Решение

Хранить авторский SVG без изменения байтов как shared immutable asset. Новый
`farq-official` Character Pack фиксирует asset ref, revision ID и SHA-256 как
provenance, а для исполнения содержит bounded declarative derivative: исходная
геометрия переводится в координаты normalized rig и поддержанные vector shapes.

Процедурные руки, взгляд, моргание и рот остаются ответственностью общего
character runtime. Цвет и обводка перчаток задаются данными pack независимо от
цвета конечностей. Renderer не ветвится по ID официального персонажа.

## Обоснование

Immutable asset сохраняет канонический брендовый исходник и позволяет проверить
происхождение производного pack. Встроенная bounded геометрия сохраняет
детерминированный Remotion render, frame-accurate rigging и отсутствие загрузки
удалённого SVG во время рендера.

## Отклонённые альтернативы

Плоское `<img>` не даёт независимо анимировать rig и лицо. Исполнение
произвольного SVG markup из timeline расширяет исполняемую поверхность и не
требуется: доверенный исходник остаётся доступен как asset, а runtime получает
строго проверенные данные.

## Последствия

Официальный персонаж доступен как отдельный pack и не меняет существующий
`farq-mascot`. Градиенты и blur исходника в первой rigged derivative сведены к
брендовым solid colors; канонические байты при этом не переписаны. Последующие
улучшения внешнего вида могут выпускать новую asset revision или обновлять pack
с новым зафиксированным provenance.

## Как проверить

Сверить asset hash с `sourceAsset.contentHash`, проверить schema tests и SSR
generic renderer, затем отрендерить `character-scene@2` с actor, который
ссылается на `farq-official`.
