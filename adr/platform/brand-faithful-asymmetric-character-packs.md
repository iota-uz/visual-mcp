---
id: brand-faithful-asymmetric-character-packs
title: Асимметричные Character Packs фиксируют направление и сохраняют авторские детали
status: accepted
date: 2026-09-12
deciders: [unknown]
area: platform
applies_to:
  - packages/video/src/character.ts
  - packages/video/src/character-packs.ts
  - packages/video/test/registry.test.ts
  - apps/worker/src/video/character-pack-view.tsx
  - apps/worker/src/video/character-scene.tsx
  - apps/worker/test/character-pack-view.test.ts
  - apps/worker/test/character-scene.test.ts
tags: [video, characters, svg, assets, brand, animation]
refs:
  - запрос пользователя
  - asset://shared/farq-official-layered-mascot@1
supersedes: [official-character-pack-from-layered-svg]
superseded_by: []
---

## Контекст

Первая derivative официального маскота сохраняла крупные силуэты, но заменяла
лицо и перчатки универсальными примитивами и разрешала зеркалить весь знак
процента через actor `facing`. В результате персонаж в видео был отражён
относительно официального artwork и потерял заметные брендовые детали.

## Решение

Character Pack может объявить каноническое направление и запретить зеркальное
отражение асимметричного artwork. `facing` продолжает управлять обычными
персонажами, но fixed-orientation pack всегда рендерится в своём каноническом
направлении.

Декларативный стиль pack поддерживает authored gloves и параметризованные
детали процедурного лица: пропорции глаз и зрачков, блики, форму бровей,
постоянно открытый рот и цвет языка. Слои authored hands рендерятся общим
renderer'ом после held prop, поэтому сохраняют occlusion и следуют IK-матрицам.
Официальный pack также содержит отсутствовавшие детали тюбетейки и обуви.

## Обоснование

Направление знака процента и расположение головы являются частью узнаваемого
силуэта, а не взаимозаменяемой позой. Данные pack сохраняют брендовый вид и при
этом оставляют runtime универсальным: renderer не ветвится по ID персонажа,
а gaze, blink, talk, gestures и prop attachment продолжают работать.

## Отклонённые альтернативы

Простая замена `facing` только в одном timeline не защищает будущие ролики.
Плоский SVG `<img>` вернул бы точные пиксели, но убрал бы независимую анимацию
лица, рук и props. Специальная ветка renderer'а для `farq-official` связала бы
движок с одним брендовым персонажем.

## Последствия

Официальный маскот больше не отражается даже при ошибочном `facing: left`.
Другие packs остаются mirrorable по умолчанию. Градиенты и blur исходного SVG
по-прежнему сведены к solid colors; геометрические и лицевые детали, важные для
узнаваемости, сохраняются в rigged derivative.

## Как проверить

Проверить schema и SSR tests, сравнить знак матрицы fixed и mirrorable pack,
отрендерить официальный pack в обоих значениях actor `facing`, затем проверить
точный MP4 с движением рук, удержанием prop, blink и talk.
