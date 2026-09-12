---
id: character-advertising-performance
title: Рекламная персонажная сцена объединяет acting, постановку и явный timebase
status: accepted
date: 2026-09-12
deciders: [unknown]
area: platform
applies_to:
  - packages/video/src/character.ts
  - packages/video/src/registry.ts
  - packages/video/src/character-acting.ts
  - packages/video/src/character-staging.ts
  - packages/video/src/character-cues.ts
  - packages/video/test/character-cues.test.ts
  - apps/worker/src/video/character-runtime.ts
  - apps/worker/src/video/character-scene.tsx
  - apps/worker/src/video/character-pack-view.tsx
  - apps/worker/src/video/character-presentation.tsx
  - apps/worker/test/character-presentation.test.ts
  - apps/web/src/dev/character-animation-lab/**
tags: [video, animation, acting, staging, quality]
refs:
  - запрос пользователя о готовности движка к рекламному качеству
supersedes: [native-character-animation-engine-v0-2]
superseded_by: []
---

## Контекст

Пользователь запросил реализацию улучшений самого движка после оценки acting,
переходов, постановки, контакта и рекламной графики. Farq служит тестовым
персонажем; качество не должно достигаться специальными ветками renderer-а.

## Решение

Развить общий data-driven renderer в новую revision персонажной сцены с явным
timebase, постановкой, мотивированным движением камеры и авторским окружением.
Acting компилируется в проверяемые действия с подготовкой, акцентом, удержанием
и завершением. Состояние вычисляется по абсолютному времени кадра, включая
переходы поз и владение предметами. Экранная рекламная графика отделяется от
преобразований камеры; пространственные цели учитывают систему координат.

Сохраняются общие character packs, фиксированное направление асимметричного
artwork и единый код для worker, Timeline preview и локального Storybook.
Новая схема заменяет предыдущую без compatibility renderer и автоматической
миграции сохранённых production-сцен. Внутренние примеры и проверки обновляются
в том же изменении.

## Обоснование

Разрозненные команды уже подтверждены прототипом. Следующий прирост качества
зависит от согласованного времени и постановки, а не количества пресетов.
Детерминизм нужен для покадровой настройки, воспроизводимых проверок и рендера.

## Отклонённые альтернативы

Подгонка одного ролика не улучшает общий движок. Отдельный preview renderer
создал бы расхождение с экспортом. Автоматический суммарный художественный балл
не заменяет наблюдаемые дефекты и визуальный просмотр.

## Последствия

Golden sequence и изолированные диагностические варианты служат регрессионным
стендом на нескольких packs. Прохождение технических тестов не означает
автоматического достижения рекламного качества. Полноценная ходьба, новые
пользовательские controls и сервис генерации звука не входят в эту итерацию.

## Как проверить

Проверить непрерывность переходов, прямой seek, временные масштабы, контакт и
разделение world/screen-space. Собрать worker, web и Storybook, просмотреть
ключевые кадры и последовательность в реальном времени. Зафиксировать
оставшиеся ограничения рядом с критериями в docs/character-advertising-readiness.md.
